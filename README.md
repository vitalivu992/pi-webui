# pi WebUI

A web UI for the [pi coding agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent): it browses
your local pi sessions and displays their conversation content, including prompts, answers, tool
calls, and thinking. It reads pi's session files without writing to them. The open conversation
and both lists refresh by themselves while a session is live. You can also send a message to a
conversation or start a new one: the server runs `pi -p` in the conversation's folder, and the
conversation shows its work as pi writes the session file.

A fork of Awesome Harnesses (same stack and deployment) that keeps only pi: no harness
filter, no per-harness settings.

## Run

```bash
make up          # start the background service (builds + installs it the first time)
make down        # stop it
make install     # rebuild and restart after pulling changes
make status      # is it running?
make logs        # follow the service log
# or in the foreground:
make run         # build, then run bin/server with .env applied
```

The Makefile targets call `./ctl.sh` (`./ctl.sh help`), which you can also run directly. The
service is per-user: a systemd user unit on Linux (`~/.config/systemd/user/pi-webui.service`,
log in the journal) and a launchd agent on macOS (`~/Library/LaunchAgents/dev.pi-webui.plist`,
log in `~/Library/Logs/pi-webui.log`), both generated with this checkout's path — after
moving the checkout, run `make install` again. Both start
at login and restart after a crash. `make install` creates `.env` from `.env.example` the
first time; the service reads it at every start, so edit it and `make restart`.

`make` alone lists every target.

Open http://127.0.0.1:8777 and log in with the username and password of your computer
account (the ones of your desktop session).

Building:

| OS | Password check | Needs to build |
|---|---|---|
| Linux | PAM | cgo + PAM headers (`sudo apt install libpam0g-dev` on Debian/Ubuntu) |
| macOS | PAM (OpenPAM / Open Directory) | cgo: Xcode command line tools (`xcode-select --install`) |
| Windows | `LogonUserW` | nothing extra (pure Go) |

`make up` / `install` use systemd on Linux and launchd on macOS; on Windows run
`go build -o bin/server.exe ./cmd/server` after `pnpm build`, and start `bin\server.exe`.

| Setting (env or `.env`) | Default | |
|---|---|---|
| `HOST` | `127.0.0.1` | Sessions hold code, prompts and secrets: keep it on loopback. |
| `PORT` | `8777` | |
| `PAM_SERVICE` | `login` | Linux, macOS: PAM service that checks the password (`/etc/pam.d/<name>`). |
| `AUTH_DISABLED` | off | `1` turns the login off (local testing, agents driving a browser). Anyone who reaches the port then also gets a shell. |
| `PI_DIR` | `~/.pi` | Sessions (`agent/sessions`), prompt templates and skills. `.agents/skills` is looked for next to it (`~/.agents/skills` by default). |
| `LAUNCH_PATH` | your login shell's `PATH` | Where `pi` is looked up for prompts sent from the UI. By default the server asks `$SHELL -l -i` once every few minutes, so a pi installed with nvm or into `~/.local/bin` is found from the service too. |

## Login

Every API call needs a login. The server asks the OS to check the password, like a console
or desktop login: PAM on Linux and macOS, `LogonUserW` on Windows. It lets in only the user
it runs as, because the sessions are that user's files. A wrong password takes 2–3 s to
answer, and the server checks one password at a time.

- macOS: use the short account name (`whoami`), not the full name.
- Windows: `name`, `DOMAIN\name` or `name@domain` all work. Windows Hello (PIN, fingerprint)
  can't be checked: use the account password — for a Microsoft account, its email and online
  password. Failed logins count towards the Windows account lockout policy.

The session is a cookie (`pw_session`) with no expiry: it ends when you quit the browser, when
you click **Log out** (the ⋮ menu at the bottom of the projects panel, after a confirmation), or
when the server restarts (sessions are kept in memory). A browser that restores the last session
on start also restores this cookie.

## The UI

- **Projects** (left, collapsible to a rail of initials): every directory pi ran in, with its
  number of conversations and the last activity. Projects whose folder is gone are hidden:
  click the count next to **Projects** to show them (greyed out) or hide them again. The
  footer greets you by the time of day ("Good morning, <user>") and has a ⋮ menu with
  **Settings**, the theme (system, light, dark) and **Log out**.
- **Conversations**: title, status icon, model, prompt and tool-call counts, last update.
  Filter by text (title, id, model, branch). The ✎ button in the header starts a **new
  conversation** in the project.
- **Views** (the icon row under the second column's header, which reads "<project> · <view>";
  the selected view shows its name and count, another project keeps the view): **Sessions**
  (the conversations above), **Setup**, and — when pi's settings list the package (asked
  once after login) — **Cron jobs** (`agents-cron`) and **Memory** (`pi-hermes-memory`).
  The main column shows what is selected:
  - **Cron jobs**: the project's scheduled tasks (schedule, next run, last outcome); a task
    shows its prompt, settings, counters and run history, and a run its status, duration,
    summary or error and the run's pi transcript (read-only, **Show work** as usual).
  - **Memory**: the project's memory and failures, then the global memory, user profile,
    failures (each tagged with the project it came from) and standing instructions; each entry
    with its category and dates, filterable.
  - **Setup**: what pi loads in the project, grouped into **Packages**, **Extensions**,
    **Skills**, **Prompts** and **Themes**: pi's built-in extensions, its own folders
    (`~/.pi/agent/…`, `.pi/…`, `.agents/skills`), the paths in its settings, the resources
    each package ships (`npm:agents-cron` → its extension and its `scheduler` skill) and the
    skills pi-hermes-memory saved. Each row says where it comes from; disabled ones (`pi
    config`) and packages that aren't installed yet are greyed. A skill or prompt shows its
    rendered markdown and what to type (`/skill:name`, `/name`); a package its version,
    homepage, what it ships and its README; an extension its package's README. pi's own
    package manager answers (see below); without it only the skills and prompts in pi's
    folders are listed.
- **Workspace** (right, collapsed by default to a rail of two icons; the git icon counts the
  changed files): **Files** is the project's folder as a tree (folders open on click; `.git`
  hidden, symlinks listed but not followed; a click on a file opens it). **Git** works like VS
  Code's Source Control:
  - the branch, its upstream and **Pull** (↓behind) / **Push** (↑ahead; a branch without
    upstream is published) buttons, and a `…` menu with Fetch, Pull, Pull (rebase), Push and
    the tree / list view;
  - the commit box: a message and **Commit** (Ctrl+Enter, the staged files), with
    **Commit & Push** and **Commit (Amend)** (no message: keep the last one) in its `…` menu;
  - the files in VS Code's groups, **Merge changes**, **Staged changes** and **Changes**, as a
    tree of folders or a list, each with its letter (U untracked, A added, M modified,
    D deleted, R renamed, C copied, T type changed, ! conflict) and the lines it adds and
    removes (`+12 −3`; an untracked file's lines all count as added);
  - on hover over a file, a folder or a group: **Open file**, **Stage**, **Unstage**,
    **Discard** (back to the staged version; an untracked file is deleted; asks first) and,
    in Merge changes, **Mark resolved**;
  - a merge, rebase, cherry-pick or revert in progress shows a banner with **Continue**
    (once no conflict is left), **Skip** (rebase, cherry-pick) and **Abort** (asks first);
  - a failed command shows its output until dismissed.

  Refreshed every 4 s while the Git tab or a diff is open, and after each action.
- **Viewer** (left of the workspace panel, opened by a click on a file): a change's diff, with
  a button to see the whole file instead; a file of the tree with line numbers and colours.
  Its left edge (and the panel's) drags wider; ⤢ expands it over the page; × or Esc closes it.
  A conflicted file opens as the file: each conflict block has **Accept current**,
  **Accept incoming** and **Accept both** (the file is saved, unless it changed on disk
  meanwhile); the bar on top has **Take mine** / **Take theirs** for the whole file,
  **Delete file** / **Keep file** for a delete/modify conflict, and **Mark resolved**.
- **Conversation**: header with the model, start time, session id; **Show work** expands every
  answer's work details (pi's `edit` calls show each replacement as removed and added text);
  **Resume** opens `cd <cwd> && pi --session <id>` with a copy button and **Run in shell**
  (opens a terminal tab in the conversation's folder and runs the command).
- **Prompt box** (under the conversation, and on the new-conversation page): the model list
  comes from the settings (**Default model** = pi's own), and a chip shows the thinking level
  that applies. Enter sends, Shift+Enter is a new line. Typing `/` at the start lists pi's
  prompt templates and skills for the folder (`.pi/prompts`, `~/.pi/agent/prompts`,
  `.pi/skills`, `~/.pi/agent/skills`, `.agents/skills`, `~/.agents/skills`) with descriptions;
  ↑/↓ and Enter or Tab insert one, and a known one is highlighted in the text (templates
  violet, skills orange), with "Uses the skill …" under the box. pi expands both itself.
  **Command** shows the exact command line. While the prompt runs, it shows as sent until the
  session file has it, the view polls fast, and **Stop** interrupts pi (then kills it after
  5 s). If pi fails, its last error lines show in the chat. A conversation another window is
  working on can't be sent to.
- **Settings** (⋮ menu → Settings): a panel on the right (⤢ makes it wider, over the
  conversation; Esc or × closes it), saved in this browser: the models the prompt box offers,
  in order (suggestions from `pi --list-models`), each with its thinking level (none for a
  model without thinking); the thinking level of the default model; and a **command preview**
  of what a new conversation would run with those settings. pi has no fast mode and doesn't
  ask for permissions, so there is nothing else to set.
- **Live sessions**: an open conversation refreshes by itself (every 2 s while its session
  file changed in the last 2 minutes, every 15 s otherwise) and new messages appear as pi
  writes them. While pi is working, the work is shown, a word ("Pondering…", "Brewing…"
  — a new one per prompt) sits under its latest text and the chat follows the newest step;
  when the turn ends the work collapses and the final answer is left.
- **Running sessions**: a project or conversation pi is working on (session file changed
  in the last 2 minutes, last turn not finished) shows a flashing blue dot; once the turn
  ends it turns into a green check until the 2 minutes pass (a dot on the collapsed rail's
  badges). The open conversation's header carries a Windows 11-style progress bar while pi
  works (its **Live** chip shows once the turn has ended). Both lists reload by themselves:
  every 4 s while something in them is live, every 15 s otherwise.
- **Terminal** (bottom of the conversation column): any number of shell tabs. Open one with the
  terminal button on a project row (hover), **+** in the terminal bar (current project's
  folder) or **Run in shell**. Each tab shows its number (counting up from the server's
  start) and the current folder; the tooltip adds the running command. Click a tab to switch, **×** to end the shell, the chevron (or the active tab) to
  minimize the panel to its status bar. Drag the top edge to resize. Shells are login shells
  (`$SHELL -l`; PowerShell on Windows) that keep running when the page reloads (the last
  512 KB of output is replayed) and end on **Log out**. Ctrl+Shift+C copies the selection.
  The folder and command are read from `/proc` on Linux and libproc on macOS; Windows tabs
  show the starting folder only.

Status icons: ✓ completed, ✗ ended with an error, ■ interrupted by the user, ◐ unfinished
(the session stops mid-turn), pulsing dot = file changed in the last 2 minutes.

Prompts sent from the UI (the server builds the command; the preview shows it):

| | Command |
|---|---|
| New conversation | `cd <project> && pi -p --session-id <new uuid> [--model <id>] [--thinking <level>] -- <prompt>` |
| Continue one | `cd <cwd> && pi -p --session <id> [--model <id>] [--thinking <level>] -- <prompt>` |

The new conversation's id is made by the server, so the page opens it as soon as pi starts.

## What is read

| | |
|---|---|
| Where | `~/.pi/agent/sessions/--<slug>--/<time>_<id>.jsonl` |
| Project path | the session header's `cwd` (none: **No workspace**) |
| Title | the last `/name` (`session_info`), else the first prompt |
| Model | per message (`model_change`, assistant `model`) |
| Timestamps | every entry |
| Status | the last assistant `stopReason` (`stop` done, `error`, `aborted`, else unfinished) |
| Events | `!` commands (`bashExecution`) and extension messages (`custom_message`) between turns |

pi sessions are trees (rewinds and forks branch them): the branch ending at the last entry is
shown. Sessions with no prompt are left out.

The views beside the conversations read (only the Git tab writes, see below):

| | |
|---|---|
| Installed packages | `~/.pi/agent/settings.json` `packages` (`npm:pi-hermes-memory`, `npm:agents-cron`, git or path sources) |
| Memory | `~/.pi/agent/pi-hermes-memory/{MEMORY,USER,failures,STANDING}.md`; the project's `~/.pi/agent/projects-memory/<name>/{MEMORY,failures}.md` (name: the git repository's folder, as the package picks it). Entries are `§`-separated, with `<!-- created=…, last=…, project64=… -->`. The SQLite index (`sessions.db`) isn't read |
| Cron jobs | `~/.agents/cron/tasks.json` (tasks bound to the project's folder); `<project>/.agents/cron/runs/<run>.json`, `reports/<task>/<run>.md` and the transcript `sessions/<task>/<run>.jsonl` (or pi's session store) |
| Setup | what pi's package manager (`DefaultPackageManager.resolve`, imported from pi's own npm package next to the `pi` executable and run with node, offline, nothing installed and no extension run) reports for the project; skills' and prompts' frontmatter and markdown; packages' `package.json` and `README.md`; pi-hermes-memory's `skills/` (global and the project's). Cached 30 s per project; the refresh button asks again |
| Files | one folder of the project at a time, and one file (up to 2 MB; binary files aren't shown), only in listed projects' folders |
| Git | `git status --porcelain=v2`, `git diff [--cached] --numstat` and one file's `git diff` in the project's repository, run with `--no-optional-locks` so they never take the index lock |

The Git tab and the conflict resolver change the repository with these commands (in its root,
paths after `--literal-pathspecs … --`, one action at a time per repository):

| Action | Command |
|---|---|
| Stage / Mark resolved | `git add -A -- <files>` |
| Unstage | `git reset -q -- <files>` (a rename's old path too) |
| Discard | `git restore -- <files>`; untracked: `git clean -f -q -- <files>` |
| Take mine / theirs | `git checkout --ours\|--theirs -- <file>`, then `git add` ("mine" is HEAD in a merge, your commit in a rebase, your stash in a stash apply) |
| Delete file (a conflict) | `git rm -q --ignore-unmatch -- <file>` |
| Accept current / incoming / both | writes the file with that block replaced (refused when the file changed since it was shown) |
| Commit | `git commit -m <message>` [`--amend`; `--amend --no-edit` without a message], then `git push` for Commit & Push |
| Fetch / Pull / Pull (rebase) | `git fetch --all --prune` / `git pull` / `git pull --rebase` |
| Push | `git push`; without an upstream `git push --set-upstream <origin or the first remote> <branch>` |
| Continue / Skip / Abort | `git <merge\|rebase\|cherry-pick\|revert> --continue\|--skip\|--abort` |

Git runs without a terminal: no credential or ssh prompts (`GIT_TERMINAL_PROMPT=0`, ssh
`BatchMode` unless `GIT_SSH_COMMAND` is set), and `GIT_EDITOR=true`, so continuing a merge or
rebase keeps git's message. A push or pull that needs a password fails instead of waiting;
credential helpers and ssh agents work. The changes are `POST /api/git` with a JSON body, behind
the login, so another site can't send them.

## Develop

```bash
make dev         # build the web app, run the Go server on :8777
make dev-web     # Vite with HMR on :5173, proxies /api to :8777
make test        # go test + vitest + playwright (e2e runs over generated fixtures, not your real data)
```

## License

MIT — see `LICENSE`. Bundled and linked third-party components are listed in
`THIRD_PARTY_NOTICES.md`. Report security issues as described in `SECURITY.md`.
