// One-line descriptions and icons for pi's tool calls: the built-in bash,
// read, edit, write, grep, find and ls, plus whatever extensions and MCP
// servers add (mcp__server__tool).

const ICONS = [
  [/^(bash|shell)$/i, "fa-terminal"],
  [/^(read)$/i, "fa-file-lines"],
  [/^(edit|write|multi_edit|patch)$/i, "fa-pen-to-square"],
  [/^(grep|glob|find|ls|search)$/i, "fa-magnifying-glass"],
  [/^(web_?fetch|web_?search|fetch)$/i, "fa-globe"],
  [/^(task|agent|subagent)$/i, "fa-robot"],
  [/^(todo|todo_?write|todo_?read)$/i, "fa-list-check"],
  [/^(skill)$/i, "fa-wand-magic-sparkles"],
  [/^(question|ask_?user|ask_?question)$/i, "fa-circle-question"],
  [/^mcp/i, "fa-plug"],
]

export function toolIcon(name) {
  for (const [re, icon] of ICONS) if (re.test(String(name || ""))) return icon
  return "fa-wrench"
}

function shortPath(path) {
  const s = String(path || "")
  const parts = s.split("/").filter(Boolean)
  return parts.length > 3 ? `…/${parts.slice(-3).join("/")}` : s
}

function firstLine(s, max = 160) {
  const line = String(s || "").trim().split("\n")[0]
  return line.length > max ? `${line.slice(0, max)}…` : line
}

/** The shell command of a bash tool input, or "". */
export function shellCommand(input) {
  const cmd = input && typeof input === "object" ? input.command : undefined
  return typeof cmd === "string" ? cmd : ""
}

/** An edit input's replacements: `[{ oldText, newText }]` (pi's `edits`, or one pair). */
export function editPairs(input) {
  const i = input && typeof input === "object" ? input : {}
  const pairs = Array.isArray(i.edits) ? i.edits : [i]
  return pairs
    .filter((e) => e && typeof e.oldText === "string" && typeof e.newText === "string")
    .map((e) => ({ oldText: e.oldText, newText: e.newText }))
}

/** The most telling part of a tool call's input, e.g. the command or file. */
export function toolSummary(name, input) {
  const tool = String(name || "").toLowerCase()
  if (typeof input === "string") return firstLine(input)
  const i = input && typeof input === "object" ? input : {}
  const path = i.path || i.file_path || i.filePath
  switch (tool) {
    case "bash":
      return firstLine(shellCommand(i) || i.description)
    case "read":
      return shortPath(path) + (i.offset ? ` (from line ${i.offset})` : "")
    case "edit": {
      const n = editPairs(i).length
      return shortPath(path) + (n > 1 ? ` (${n} edits)` : "")
    }
    case "grep":
      return `${i.pattern ?? ""}${path ? ` in ${shortPath(path)}` : ""}${i.glob ? ` (${i.glob})` : ""}`
    case "find":
      return `${i.pattern ?? ""}${path ? ` in ${shortPath(path)}` : ""}`
  }
  if (path) return shortPath(path)
  for (const key of ["command", "pattern", "query", "url", "description", "prompt", "name"]) {
    if (typeof i[key] === "string" && i[key]) return firstLine(i[key])
  }
  return ""
}

/** "bash", or "playwright · browser_click" for an MCP tool (mcp__server__tool). */
export function toolLabel(name) {
  const m = String(name || "").match(/^mcp__(.+?)__(.+)$/)
  return m ? `${m[1]} · ${m[2]}` : String(name || "tool")
}
