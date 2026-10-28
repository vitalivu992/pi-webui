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

## Develop

```bash
make dev         # build the web app, run the Go server on :8777
make dev-web     # Vite with HMR on :5173, proxies /api to :8777
make test        # go test + vitest + playwright (e2e runs over generated fixtures, not your real data)
```
