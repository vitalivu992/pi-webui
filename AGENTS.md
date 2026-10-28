# AGENTS.md

User-facing features and what data is read: [README.md](README.md).

## Commands

```bash
make build                  # pnpm build → web/dist (go:embed) + go build -o bin/server
make dev | make dev-web     # Go server on :8777 | Vite HMR on :5173 proxying /api
make run                    # build, then bin/server in the foreground with .env applied
make up|down|install|logs   # per-user service via ctl.sh: systemd user unit pi-webui (Linux),
                            # launchd agent dev.pi-webui (macOS), both generated with the checkout path
go test ./...               # Go tests (parser, catalog, launch, runs, api)
pnpm test:unit              # vitest (tests/*.test.mjs; JSX helpers import fine)
pnpm test:e2e               # playwright: e2e/make-fixtures.mjs writes a fake home to .e2e-home/,
                            # then the config starts the server on :8778 over it (PI_DIR there,
                            # LAUNCH_PATH at its bin/: a fake `pi` that echoes prompts).
                            # It runs `go run -tags e2e`: the login accepts demo / demo-password
```

The server needs cgo on Linux (PAM headers, `libpam0g-dev`) and macOS (Xcode CLT); Windows
is pure Go (`GOOS=windows go build ./cmd/server` cross-compiles). JS tooling is **pnpm**. `@playwright/test` is pinned to 1.60.0 to match the browsers installed
on this machine. `web/dist/.gitkeep` keeps the embed pattern valid on a fresh clone; run
`make web` before building for real pages.

This is the pi-only fork of awesome-harness: same stack, service and API shape, minus the
harness dimension (no harness ids in URLs or the API, no per-harness settings). Ports differ
(8777, e2e 8778) and so do the cookie and storage keys (`pw_session`, `pw_prefs`,
`pw_settings`): cookies aren't per port, so both apps can be logged in on one host.

## Architecture

Read-only Go server + React SPA, one binary, plus the terminal panel's shells (`internal/shell`)
and the prompt runs (`internal/runs`), which start `pi -p` headless. No database: session files
are read on request and summaries cached in memory by file size + mtime.

- `internal/conv` — the conversation model: `Conversation` = `Summary` + `Entries`; an entry
  is a `turn` (prompt, steps, final answer, status) or an `event` (`!` command output, extension
  message). `Entry.SplitFinal` moves the trailing text steps of a turn into `Final`, so "final
  answer" means the text after the last tool call or thought. `Finish` derives counts, models,
  status and a fallback title. Long tool inputs/outputs are capped (`MaxText`).
- `internal/pi` — pi sessions (`~/.pi/agent/sessions/--<slug>--/<time>_<id>.jsonl`): the first
  line is the header (`ReadHeader`: id, cwd); entries form a tree via `parentId` and
  `activeBranch` walks from the last entry to the root. `toolCall` ↔ `toolResult` by id; status
  from `stopReason`; `bashExecution` and `custom_message` become events; title from the last
  `session_info.name`.
- `internal/catalog` — lists the session files, project = header `cwd` (memoized in `heads`;
  none → `no-workspace`). Projects carry `count`, and `Running` / `Finished` count conversations
  that are active with an `incomplete` / ended last turn (only active items are summarized, so
  listing stays cheap). `enrich` sets the active flag and cwd = project dir when the header has
  none. Sessions with zero turns are hidden. `Conversation(id)` looks the id up among the listed
  files (ids validated first).
- `internal/auth` — login in front of the API. `Handler.Guard` answers 401 to `/api/*` without
  a session (except `/api/auth/*`; the bundle and `/health` stay public). `POST /api/auth/login`
  (JSON only, a CSRF guard) runs the `Authenticator` one at a time, then sets `pw_session`:
  HttpOnly, SameSite=Strict, no expiry (gone when the browser exits); sessions are an in-memory
  map keyed by the token's sha256. `System(service)` is the OS password check, one file per OS:
  `pam.go` (Linux + macOS: cgo, a C conversation function, no Go callbacks; `PAM_SERVICE`,
  default `login`; only the server's user, compared after PAM so timing is the same) and
  `logon_windows.go` (`LogonUserW` network logon via advapi32, same account compared by SID,
  2 s delay on failure). `system_e2e.go` (build tag `e2e`) replaces both with
  demo / demo-password for Playwright. `AUTH_DISABLED=1` (`Handler.NoLogin`) turns the login off:
  every request is the server's user — for agents driving a browser against the running service.
- `internal/shell` — the terminal panel: login shells in PTYs (`aymanbagabas/go-pty`: creack/pty
  on Unix, ConPTY on Windows), kept in a server-wide `Manager` (tab numbers count up from the server's start, never reused).
  `GET/POST /api/shells`, `DELETE /api/shells/{id}`, WebSocket `GET /api/shells/{id}/attach`
  (`coder/websocket`; its Origin check stops other sites/ports): binary = terminal bytes, text =
  JSON (`resize` in; `status`/`exit` with the shell's info out). 512 KB scrollback replayed on
  attach; a slow WebSocket is dropped and the browser reattaches. `run` is typed at the first
  prompt (first output + 250 ms quiet). Every second the foreground process group (TIOCGPGRP
  via `Control`, never `Fd()`, which makes the master blocking) gives the tab's folder and
  command: `/proc` on Linux, libproc + sysctl on macOS (cgo), nothing on Windows. The server
  drops its slave fd after start; exit = `Wait` + 300 ms drain, then close. Stop = SIGHUP to
  the group, close, SIGKILL after 3 s. Logout (`auth.Handler.OnLogout`) ends all shells, so
  the e2e shell spec runs in its own project after the others. `cmd/server` strips its own
  settings (`serverVars`) from the shells' environment, skips gzip for upgrades, and
  `statusWriter.Unwrap` lets the upgrade hijack.
- `internal/launch` — pure: `Build(Request, newID)` → `Plan` (argv, cwd, session, display
  `Command`) for `pi -p --session-id <new> | --session <id> [--model] [--thinking] -- <prompt>`.
  The browser sends only structured fields (model validated as a token, never a leading `-`;
  thinking level from `Efforts`; the prompt goes after `--`). The new id is made here, so a run
  always knows its session. pi expands `/template` and `/skill:` in `-p` itself, so prompts go as
  typed. `Commands(cwd, Dirs)` lists prompt templates (`.pi/prompts`, `~/.pi/agent/prompts`) and
  skills (`.pi/skills`, `.agents/skills`, `~/.pi/agent/skills`, `~/.agents/skills`; project ones
  win). `Models` parses `pi --list-models` (thinking column `no` → no efforts).
- `internal/runs` — `Manager`: `POST /api/runs` (JSON only — no CORS preflight answer = no
  cross-site runs) checks a continued conversation in the catalog (its cwd wins; one running
  prompt per conversation → 409), builds the plan and starts pi in its own process group, stdin
  null. Output tails (stderr first, else stdout) become the error when pi fails. `DELETE` =
  SIGINT to the group, SIGKILL after 5 s. Ended runs stay listed 15 min. pi is looked up in
  `LAUNCH_PATH`, else the login shell's PATH (`$SHELL -l -i -c`, cached 5 min) — a systemd
  service's PATH lacks nvm and `~/.local/bin`; found paths are made absolute (`cmd.Dir` would
  resolve a relative one). Also `GET /api/pi` (cli, efforts, `found`), `/api/models` (cached
  10 min, `?refresh=1`), `/api/commands?cwd=`, `POST /api/runs/preview` (a new session shows
  `new-session-uuid`; no cwd → home). Runs survive logout.
- `internal/api` — `GET /api/projects`, `GET /api/conversations?project=<key>`,
  `GET /api/conversations/{id}` (ETag = `Catalog.ConversationIfChanged` version: size +
  mtime + active flag, so it also changes when the active window passes; `If-None-Match` → 304
  without parsing). `cmd/server` adds gzip for `/api/*` and an access log,
  and listens on `HOST` (default `127.0.0.1`). `~/.agents` is looked for next to `PI_DIR`.
- `web/` — `go:embed` of `web/dist` + SPA fallback handler (404s unknown `/api/*` and `/health`).

### Frontend (`src/`)

- `App.jsx` — `AuthGate` asks `/api/auth/session`, shows `LoginScreen` or the browser; a 401 from
  any API call (`LOGGED_OUT_EVENT` in `lib/api.js`) returns to the login. Right after a login the
  browser mounts under `LoginScreen`, which plays the unlock sequence (redaction bars from
  `lib/redaction.js` peel away, welcome line, aperture via the `--pw-hole` `@property`; click or
  key skips; reduced motion = fade) — `UNLOCK_MS` matches the CSS timings.
  A logout runs it the other way: `LoginScreen locking` mounts over the still-mounted browser
  (backdrop blurs and turns opaque, then the form fades in; `LOCK_MS`), the browser unmounts
  once both the logout request and `LOCK_MS` are done; `LOGGED_OUT_EVENT`s are ignored meanwhile.
- `App.jsx` (browser) — three columns (a fourth while Settings is open); the selection is in the URL
  (`?project=<key>&c=<id>`, `&new=1` for the new-conversation page).
  `useFetch` aborts stale loads; its `poll(data)` option reloads quietly (no spinner, errors
  keep the data, paused while hidden): both lists use `listPollDelay` (4 s while something is
  running/active, else 15 s). `components/Running.jsx`: `RunningBar` (WinUI indeterminate
  ProgressBar timing and accent on the view header's bottom border; static under reduced motion;
  replaces the title's status icon and the Live chip while working), `LiveIcon` on project /
  conversation rows (`lib/live.js` `liveState`: flashing blue dot = working, green check = active
  but the last turn ended; projects from `running` / `finished`; a dot on rail badges) and
  `WorkingWord` (a random `WORKING_WORDS` entry every 3 s, shimmering).
  `hooks/useLiveConversation.js` loads the open conversation and
  polls it with its ETag (`lib/live.js` `pollDelay`: 2 s while active, 15 s otherwise, paused
  while the page is hidden). `isWorking` = active + last turn `incomplete`: `ConversationView`
  then shows the work, marks the last turn with a `WorkingWord` and keeps the chat at the bottom if it was
  there; when it flips back the work collapses. `e2e/live.spec.js` appends to a session file
  mid-test, in its own Playwright project (chromium → live → prompts → shells) because it adds the newest project.
- Prompts: `components/Runs.jsx` `RunsProvider` (`/api/runs`, polled 1.5 s while one runs;
  `start` remembers the conversation's turn count, so `ConversationView` shows the prompt as
  sent until the session file has more turns; `runFor(session)`). `useLiveConversation(…,
  {running})` polls fast and treats a 404 as "not written yet". `Composer.jsx` (prompt box +
  model select from the settings + thinking chip + `CommandPreview` from
  `/api/runs/preview` + Send/Stop) sits under the chat and on `NewConversation.jsx`, which opens
  the conversation once the run has started. `PromptBox.jsx`: a transparent textarea
  over a mirror that draws the text with the known command `<mark>`ed (same font metrics —
  no padding or weight on marks), completion listbox from `lib/prompt.js` (pure, tested).
  `Settings.jsx`: right panel (`is-wide` = fixed overlay) from the account menu; settings
  (`{ models: [{id, effort}], effort }`) in localStorage `pw_settings` via `lib/settings.js`
  (`launchRequest` maps them onto a run request) and `hooks/useSettings.js` (same-tab event +
  `storage`); pi info, commands and models via `hooks/usePiData.js` (cached per page).
  `e2e/prompts.spec.js` has its own Playwright project and project folder, removed afterwards.
- `components/Shells.jsx` — `ShellProvider` (shell list restored from `/api/shells`, active tab,
  open/minimized; `useShells().openShell({cwd, run})` from the project rows and the Resume
  popover) and `ShellPanel` (tab bar = status bar, drag-to-resize, height in prefs).
  `Terminal.jsx` (lazy: xterm.js + fit addon) keeps one xterm per shell mounted while hidden,
  resets before a reattach's scrollback replay; `lib/shells.js` holds its pure helpers.
- `components/` — `ProjectsPanel` (collapsible rail; projects whose folder is gone hidden until
  the header count is clicked; footer = `UserMenu`: `greeting` (format.js, by hour) + user + kebab menu with Settings, theme radio
  items and **Log out**, which asks in a `<dialog>`), `ConversationList` (text filter; ✎ = new
  conversation), `ConversationView`
  (user bubble right, agent left with `agentLabel` "pi - Opus 5.5", `Work details`
  collapsed by default, global Show/Hide work; "Copy as markdown" under a final answer, shown while
  its footer is hovered — `lib/clipboard.js` `copyText`, shared with the Resume popover), `Step` (thinking/note/tool rows; tool input shown
  as shell / removed + added text (pi's `edit` `edits`, `write` content) / JSON, output on click), `ResumeButton`
  (`pi --session`), `PiIcon`, `Markdown` (markdown-it + hljs + GitHub
  alerts; mermaid lazy-loaded, `securityLevel: "strict"`, `html: false`; a drawn diagram gets a
  "Copy image" button on hover: the SVG is drawn on a canvas at 2x over the nearest opaque
  background, HTML labels get their computed font inlined, `clipboard.js` `copyImage` writes the PNG).
- `lib/` — pure helpers with unit tests: `format.js` (`modelLabel`, dates, durations),
  `resume.js` (`cd <cwd> && pi --session <id>`, POSIX quoting), `tools.js` (tool icon/summary
  for pi's bash/read/edit/write/grep/find/ls plus extension and MCP tools; `editPairs`),
  `markdown.js`, `theme.js`, `prefs.js` (localStorage `pw_prefs`: theme,
  collapsed panel, missing projects shown, last composer model — UI prefs only, reads/writes never throw).
- Styling: Primer CSS tokens + Font Awesome; classes and ids are prefixed `pw-` / `pw…`; app
  colours are `--pw-*` variables in `src/styles/app.css` with dark values under
  `[data-color-mode="dark"]` (set on `<html>` by `theme.js` and the inline script in `index.html`).
