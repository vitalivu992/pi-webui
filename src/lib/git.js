// Pure helpers of the Git tab and the viewer (components/GitPanel.jsx, Viewer.jsx).

/** The inline actions of each group, in VS Code's order (discard before stage). */
export const GROUP_OPS = { merge: ["stage"], staged: ["unstage"], changes: ["discard", "stage"] }

export const OPS = {
  stage: { verb: "Stage", icon: "fa-plus" },
  unstage: { verb: "Unstage", icon: "fa-minus" },
  discard: { verb: "Discard", icon: "fa-rotate-left" },
}

/** "Stage Changes" on a file or folder, "Stage All Changes" on a group; Stage marks a conflict resolved. */
export function opTitle(op, group, all) {
  if (group === "merge" && op === "stage") return all ? "Mark All Resolved" : "Mark Resolved"
  return `${OPS[op].verb} ${all ? "All " : ""}Changes`
}

/** An operation in progress → its badge. */
export const STATE_LABELS = { rebase: "Rebasing", merge: "Merging", "cherry-pick": "Cherry-picking", revert: "Reverting", bisect: "Bisecting" }

/** What the server needs to know of a change of a group. */
export const fileRef = (change, group) => ({ path: change.path, from: change.from || "", group, status: change.status })

/** A change's key: a file can be in two groups. */
export const fileKey = (group, path) => `${group}:${path}`

/**
 * The open change after a status reload: the same file in the same group, else
 * in another group (staged after a stage, changes after an unstage), else null.
 */
export function findChange(status, group, path) {
  if (!status?.repo) return null
  const order = [group, ...["staged", "changes", "merge"].filter((g) => g !== group)]
  for (const g of order) {
    const change = (status[g] || []).find((c) => c.path === path)
    if (change) return { group: g, change }
  }
  return null
}

/**
 * The folders of a group's files: { dirs: [{ name, path, dirs, files }], files }.
 * A chain of single-child folders is one row ("src/lib"), as VS Code shows it.
 */
export function buildTree(changes) {
  const root = { name: "", path: "", dirs: new Map(), files: [] }
  for (const c of changes) {
    const parts = c.path.split("/")
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.dirs.has(parts[i])) node.dirs.set(parts[i], { name: parts[i], path: parts.slice(0, i + 1).join("/"), dirs: new Map(), files: [] })
      node = node.dirs.get(parts[i])
    }
    node.files.push(c)
  }
  const finish = (node) => {
    const dirs = [...node.dirs.values()].map(finish).map((d) => {
      while (d.dirs.length === 1 && !d.files.length) d = { ...d.dirs[0], name: `${d.name}/${d.dirs[0].name}` }
      return d
    })
    dirs.sort((a, b) => a.name.localeCompare(b.name))
    const files = [...node.files].sort((a, b) => baseName(a.path).localeCompare(baseName(b.path)))
    return { name: node.name, path: node.path, dirs, files }
  }
  return finish(root)
}

/** Every file under a folder of buildTree. */
export const treeFiles = (node) => [...node.files, ...node.dirs.flatMap(treeFiles)]

export function baseName(p) {
  const i = p.lastIndexOf("/")
  return i < 0 ? p : p.slice(i + 1)
}

/** The confirmation of a discard, worded as VS Code's: untracked files are deleted. */
export function discardPrompt(changes) {
  const untracked = changes.filter((c) => c.status === "U").length
  if (changes.length === 1) {
    const [c] = changes
    return untracked
      ? { title: `Delete "${c.path}"?`, body: "The file is untracked: it is deleted (git clean -f). This cannot be undone.", confirm: "Delete file" }
      : { title: `Discard changes in "${c.path}"?`, body: "The file goes back to its staged version, or to HEAD (git restore). This cannot be undone.", confirm: "Discard changes" }
  }
  let body = `${changes.length - untracked} file(s) go back to their staged version (git restore).`
  if (untracked) body += ` ${untracked} untracked file(s) are deleted (git clean -f).`
  return { title: `Discard all changes in ${changes.length} files?`, body: `${body} This cannot be undone.`, confirm: "Discard all" }
}

/**
 * The git side (--ours / --theirs) behind "Take mine" and "Take theirs" for a
 * conflict during `state`. In a merge, cherry-pick or revert, ours is HEAD. In
 * a rebase, ours is the branch rebased onto and theirs is your commit being
 * replayed. With no operation (a stash apply), theirs is the stashed changes.
 * Only content conflicts (both sides have the file) get them: null otherwise.
 */
export function conflictSides(xy, state) {
  if (xy !== "UU" && xy !== "AA") return null
  if (state === "rebase") return { mine: { op: "theirs", hint: "your commit being replayed" }, theirs: { op: "ours", hint: "the branch you rebase onto" } }
  if (!state) return { mine: { op: "theirs", hint: "your stashed changes" }, theirs: { op: "ours", hint: "HEAD" } }
  const incoming = { "cherry-pick": "the picked commit", revert: "the reverted commit" }[state] || "the merged branch"
  return { mine: { op: "ours", hint: "HEAD, your branch" }, theirs: { op: "theirs", hint: incoming } }
}

/** A conflict's two letters in words (git's "us" = HEAD). */
export const CONFLICT_KINDS = {
  UU: "both modified",
  AA: "both added",
  DD: "both deleted",
  DU: "deleted by us",
  UD: "deleted by them",
  AU: "added by us",
  UA: "added by them",
}

/** Delete/modify conflicts: one side has no file, so they resolve by keeping or removing it. */
export const isDeleteConflict = (xy) => ["DU", "UD", "DD", "AU", "UA"].includes(xy)

/**
 * Parses `git diff` output into files of hunks with numbered lines:
 * [{ header: [lines before the first hunk], hunks: [{ header, lines: [{ kind, text, old, new }] }] }].
 * kind: add | del | ctx | meta. A combined diff (diff --cc, a conflict) has one
 * marker column per parent; a line is add / del when any column says so.
 */
export function parseDiff(text) {
  const files = []
  let file = null
  let hunk = null
  let cols = 1
  let oldNo = 0
  let newNo = 0
  const lines = String(text || "").split("\n")
  if (lines.length && lines[lines.length - 1] === "") lines.pop()
  for (const line of lines) {
    if (line.startsWith("diff ")) {
      file = { header: [line], hunks: [] }
      files.push(file)
      hunk = null
      continue
    }
    if (!file) {
      file = { header: [], hunks: [] }
      files.push(file)
    }
    const m = /^(@{2,}) -(\d+)(?:,\d+)?(?: -\d+(?:,\d+)?)* \+(\d+)(?:,\d+)? @{2,}(.*)$/.exec(line)
    if (m) {
      cols = m[1].length - 1
      oldNo = Number(m[2])
      newNo = Number(m[3])
      hunk = { header: line, lines: [] }
      file.hunks.push(hunk)
      continue
    }
    if (!hunk) {
      file.header.push(line)
      continue
    }
    if (line.startsWith("\\")) {
      hunk.lines.push({ kind: "meta", text: line })
      continue
    }
    const marks = line.slice(0, cols)
    const body = line.slice(cols)
    if (marks.includes("+")) hunk.lines.push({ kind: "add", text: body, new: newNo++ })
    else if (marks.includes("-")) hunk.lines.push({ kind: "del", text: body, old: oldNo++ })
    else hunk.lines.push({ kind: "ctx", text: body, old: oldNo++, new: newNo++ })
  }
  return files
}

/** Lines added and removed in a parsed diff. */
export function diffStats(files) {
  let add = 0
  let del = 0
  for (const f of files) {
    for (const h of f.hunks) {
      for (const l of h.lines) {
        if (l.kind === "add") add++
        else if (l.kind === "del") del++
      }
    }
  }
  return { add, del }
}

const marker = (line, ch) => line.startsWith(ch.repeat(7)) && (line.length === 7 || /^[ \r\n]/.test(line.slice(7)))
const label = (line) => line.slice(7).trim()

/**
 * Splits a file with conflict markers into segments: { kind: "text", lines }
 * and { kind: "conflict", index, ours, base, theirs, oursLabel, theirsLabel, raw }
 * (base: the diff3 / zdiff3 section, null without one; raw: the block's lines, markers included). Lines keep their
 * line endings, so joining them gives the file back. An unclosed block stays text.
 */
export function parseConflicts(text) {
  const lines = String(text).split(/(?<=\n)/)
  const segments = []
  let plain = []
  let count = 0
  for (let i = 0; i < lines.length; i++) {
    if (!marker(lines[i], "<")) {
      plain.push(lines[i])
      continue
    }
    const block = { kind: "conflict", index: count, ours: [], base: null, theirs: [], oursLabel: label(lines[i]), theirsLabel: "" }
    let part = "ours"
    let j = i + 1
    for (; j < lines.length; j++) {
      const l = lines[j]
      if (part === "ours" && marker(l, "|")) {
        part = "base"
        block.base = []
      } else if (part !== "theirs" && marker(l, "=")) {
        part = "theirs"
      } else if (part === "theirs" && marker(l, ">")) {
        block.theirsLabel = label(l)
        break
      } else {
        block[part].push(l)
      }
    }
    if (j >= lines.length) {
      // No closing marker: not a conflict block.
      plain.push(lines[i])
      continue
    }
    if (plain.length) segments.push({ kind: "text", lines: plain })
    plain = []
    block.raw = lines.slice(i, j + 1)
    segments.push(block)
    count++
    i = j
  }
  if (plain.length) segments.push({ kind: "text", lines: plain })
  return segments
}

/** How many conflict blocks a file has. */
export const conflictCount = (text) => parseConflicts(text).filter((s) => s.kind === "conflict").length

/**
 * The file with conflict block `index` replaced by a choice: ours (current),
 * theirs (incoming), both (current then incoming) or none.
 */
export function resolveConflict(text, index, choice) {
  return parseConflicts(text)
    .map((s) => {
      if (s.kind === "text") return s.lines.join("")
      if (s.index !== index) return s.raw.join("")
      const pick = { ours: s.ours, theirs: s.theirs, both: [...s.ours, ...s.theirs], none: [] }[choice]
      if (!pick) throw new Error(`unknown choice ${choice}`)
      return pick.join("")
    })
    .join("")
}

/** The hljs language of a file name, "" when unknown. */
export function languageOf(path) {
  const name = baseName(path).toLowerCase()
  if (name === "dockerfile") return "dockerfile"
  if (name === "makefile") return "makefile"
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : ""
  return (
    {
      js: "javascript",
      mjs: "javascript",
      cjs: "javascript",
      jsx: "javascript",
      ts: "typescript",
      tsx: "typescript",
      go: "go",
      py: "python",
      rb: "ruby",
      rs: "rust",
      java: "java",
      kt: "kotlin",
      c: "c",
      h: "c",
      cpp: "cpp",
      cc: "cpp",
      hpp: "cpp",
      cs: "csharp",
      php: "php",
      swift: "swift",
      sh: "bash",
      bash: "bash",
      zsh: "bash",
      json: "json",
      yml: "yaml",
      yaml: "yaml",
      toml: "ini",
      ini: "ini",
      md: "markdown",
      html: "xml",
      xml: "xml",
      svg: "xml",
      css: "css",
      scss: "scss",
      less: "less",
      sql: "sql",
      lua: "lua",
      pl: "perl",
      r: "r",
      diff: "diff",
      patch: "diff",
    }[ext] || ""
  )
}

/**
 * hljs HTML of a whole file → one HTML string per line: the spans open at a
 * line break are closed at its end and opened again on the next line, so
 * multi-line comments and strings keep their colour. A final newline adds no line.
 */
export function splitHighlighted(html) {
  const lines = []
  const open = []
  let cur = ""
  for (const m of String(html).matchAll(/(<span[^>]*>)|(<\/span>)|(\n)|([^<\n]+)/g)) {
    if (m[1]) {
      open.push(m[1])
      cur += m[1]
    } else if (m[2]) {
      open.pop()
      cur += m[2]
    } else if (m[3]) {
      lines.push(cur + "</span>".repeat(open.length))
      cur = open.join("")
    } else {
      cur += m[4]
    }
  }
  if (cur !== open.join("") || !lines.length) lines.push(cur + "</span>".repeat(open.length))
  return lines
}
