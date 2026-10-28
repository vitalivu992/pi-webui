# Third-party notices

pi WebUI is MIT licensed (see `LICENSE`). It bundles or depends on the following.

## Bundled into the web bundle and the server binary

- **Font Awesome Free 6.5.2** — Copyright Fonticons, Inc.
  - Icons: CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/
  - Fonts: SIL OFL 1.1 — https://scripts.sil.org/OFL
  - Code: MIT — https://opensource.org/licenses/MIT
  - Full license: https://fontawesome.com/license/free
  - Imported at `src/main.jsx` (`@fortawesome/fontawesome-free/css/all.min.css`), so the icon
    webfonts ship inside the release binaries.

- **Primer CSS** — Copyright GitHub, Inc. MIT.
  - Only design tokens and base styles are used (`src/styles/app.css`).

- **xterm.js** (`@xterm/xterm`, `@xterm/addon-fit`) — MIT.

- **markdown-it**, **markdown-it-footnote**, **markdown-it-github-alerts** — MIT.

- **markdown-it-task-lists** — ISC.

- **highlight.js** — BSD-3-Clause.

- **mermaid** — MIT.

- **React**, **React DOM**, **React Router** — MIT.

## Go dependencies

Linked into the server binary; licenses are in each module's own repository.

- **github.com/aymanbagabas/go-pty** — MIT
- **github.com/coder/websocket** — ISC
- **github.com/creack/pty** — MIT
- **github.com/u-root/u-root** — BSD-3-Clause
- **golang.org/x/crypto**, **golang.org/x/sys** — BSD-3-Clause

## Not included

pi itself is a separate program and is not distributed with this project. See
https://github.com/earendil-works/pi for its license.
