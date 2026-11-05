// Pure helpers of the right-hand panel (components/WorkspacePanel.jsx).

/** VS Code's Source Control letters → what they mean and their colour. */
export const GIT_STATUS = {
  M: { label: "Modified", tone: "modified" },
  A: { label: "Added", tone: "added" },
  D: { label: "Deleted", tone: "deleted" },
  R: { label: "Renamed", tone: "renamed" },
  C: { label: "Copied", tone: "renamed" },
  T: { label: "Type changed", tone: "modified" },
  U: { label: "Untracked", tone: "added" },
  "!": { label: "Conflict", tone: "conflict" },
}

/** The groups of a git status that have files, in VS Code's order. */
export function gitGroups(status) {
  if (!status?.repo) return []
  return [
    { id: "merge", label: "Merge changes", changes: status.merge || [] },
    { id: "staged", label: "Staged changes", changes: status.staged || [] },
    { id: "changes", label: "Changes", changes: status.changes || [] },
  ].filter((g) => g.changes.length)
}

/** Changed files, a file both staged and changed counted once. */
export function changeCount(status) {
  const paths = new Set()
  for (const g of gitGroups(status)) for (const c of g.changes) paths.add(c.path)
  return paths.size
}

/** "src/lib/a.js" → { name: "a.js", dir: "src/lib" }. */
export function splitPath(path) {
  const i = String(path).lastIndexOf("/")
  return i < 0 ? { name: path, dir: "" } : { name: path.slice(i + 1), dir: path.slice(0, i) }
}

/** A child's path in the tree: slash-separated from the project's root. */
export function joinPath(dir, name) {
  return dir ? `${dir}/${name}` : name
}

/** "1.2 KB": a file's size for its tooltip. */
export function fileSize(bytes) {
  if (!(bytes >= 0)) return ""
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB", "TB"]
  let n = bytes / 1024
  let u = 0
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024
    u++
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[u]}`
}
