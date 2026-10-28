// Pure helpers for the terminal panel (components/Shells.jsx, Terminal.jsx).

/** The last folder of a POSIX or Windows path: "/a/b/" → "b", "C:\\x" → "x", "/" → "/". */
export function folderName(path) {
  const s = String(path || "")
  const trimmed = s.replace(/[\\/]+$/, "")
  if (!trimmed) return s ? s[0] : ""
  const parts = trimmed.split(/[\\/]/)
  return parts[parts.length - 1] || trimmed
}

/** Tooltip of a shell's tab: "Shell 2 · ~/x/app · npm test", or "… · exited (1)". */
export function shellTitle(shell) {
  const parts = [`Shell ${shell.n}`, shell.cwd]
  if (shell.exited) parts.push(`exited (${shell.exitCode})`)
  else if (shell.command) parts.push(shell.command)
  return parts.filter(Boolean).join(" · ")
}

/** The WebSocket URL that attaches to shell `id`, for the page at `loc`. */
export function attachURL(id, loc = window.location) {
  const scheme = loc.protocol === "https:" ? "wss:" : "ws:"
  return `${scheme}//${loc.host}/api/shells/${encodeURIComponent(id)}/attach`
}

/** The next tab to show when `id` closes: the one after it, else the one before. */
export function neighbourId(shells, id) {
  const i = shells.findIndex((s) => s.id === id)
  if (i < 0) return shells[0]?.id || ""
  return (shells[i + 1] || shells[i - 1])?.id || ""
}

// xterm.js colours per colour mode (pi.dev's warm palette).
const THEMES = {
  light: {
    background: "#f3f2f0",
    foreground: "#252f3d",
    cursor: "#4b607c",
    selectionBackground: "#4b607c44",
    black: "#252f3d",
    red: "#a5483a",
    green: "#47764d",
    yellow: "#96690f",
    blue: "#4b607c",
    magenta: "#7d5f9e",
    cyan: "#3d7d80",
    white: "#8b847d",
    brightBlack: "#5c5752",
    brightRed: "#b86b52",
    brightGreen: "#6a9955",
    brightYellow: "#b07d18",
    brightBlue: "#6a9fcc",
    brightMagenta: "#9a7ab8",
    brightCyan: "#4d9499",
    brightWhite: "#5c5752",
  },
  dark: {
    background: "#1b1916",
    foreground: "#e9e5df",
    cursor: "#8fa9c6",
    selectionBackground: "#8fa9c644",
    black: "#45403a",
    red: "#e08a76",
    green: "#7fb886",
    yellow: "#d8a53f",
    blue: "#8fa9c6",
    magenta: "#c9a3e8",
    cyan: "#6db1b5",
    white: "#a49b91",
    brightBlack: "#8f867c",
    brightRed: "#cf8a6a",
    brightGreen: "#8ec49a",
    brightYellow: "#e1b06e",
    brightBlue: "#6a9fcc",
    brightMagenta: "#d4b3ec",
    brightCyan: "#7fc3c7",
    brightWhite: "#f3f2f0",
  },
}

export function terminalTheme(mode) {
  return THEMES[mode] || THEMES.light
}
