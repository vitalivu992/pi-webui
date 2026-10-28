# Security

## Reporting a vulnerability

Report privately through GitHub's [private vulnerability reporting](https://github.com/vitalivu992/pi-webui/security/advisories/new)
rather than a public issue. Include the version or commit, what you did, and what happened.

Expect an initial reply within a few days. This is a personal project without a support
commitment; fixes are best effort.

## What this server is

pi WebUI reads your local pi sessions and can start prompts and terminal shells as the user
it runs as. It is built to sit on loopback next to that user's data. It is not hardened for
exposure to a network.

Things to know before you deploy it:

- **Keep `HOST` on `127.0.0.1`.** Sessions hold code, prompts and secrets. Anyone who can
  reach the port after logging in gets all of it, plus a shell.
- **`AUTH_DISABLED=1` turns the login off.** Every request then runs as the server's user.
  It exists for local testing and for agents driving a browser. Never combine it with a
  non-loopback `HOST`.
- **The login is your OS account password.** PAM on Linux and macOS, `LogonUserW` on Windows.
  It admits only the user the server runs as. Failed logins count towards the OS account
  lockout policy.
- **The terminal panel gives a real login shell** with the server's environment. Do not run
  the service as a user whose shell access you would not hand out.
- **Runs started from the UI execute `pi` with the prompt you type.** The browser sends
  structured fields and the prompt goes after `--`, so it cannot inject flags, but `pi` itself
  acts with your permissions.

## Scope

In scope: auth bypass, session fixation, command or flag injection through the API, path
traversal in the session reader, XSS in rendered markdown or terminal output.

Out of scope: anything that requires `AUTH_DISABLED=1` or a non-loopback `HOST` to reach,
and prompt-injection behaviour inside the agent itself.
