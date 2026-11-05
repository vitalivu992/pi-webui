// The setup view's pure helpers: what pi loads, grouped by kind (internal/setup).

/** In list order. */
export const KINDS = [
  { id: "package", label: "Packages", one: "Package", icon: "fa-solid fa-box" },
  { id: "extension", label: "Extensions", one: "Extension", icon: "fa-solid fa-puzzle-piece" },
  { id: "skill", label: "Skills", one: "Skill", icon: "fa-solid fa-wand-magic-sparkles" },
  { id: "prompt", label: "Prompts", one: "Prompt template", icon: "fa-solid fa-terminal" },
  { id: "theme", label: "Themes", one: "Theme", icon: "fa-solid fa-palette" },
]

export function kindMeta(id) {
  return KINDS.find((k) => k.id === id) || { id, label: id, one: id, icon: "fa-regular fa-file" }
}

/** "agents-cron" for "npm:agents-cron@1.2", the repo's name for git sources, a path's last folder. */
export function packageLabel(source) {
  let s = String(source || "")
  if (s.startsWith("npm:")) {
    s = s.slice(4)
    const at = s.lastIndexOf("@")
    return at > 0 ? s.slice(0, at) : s
  }
  s = s.replace(/^git:/, "").replace(/[/\\]+$/, "").replace(/\.git$/, "")
  return s.split(/[/\\]/).pop() || s
}

/** The badge: `{ label, title, tone }` (tone: project, memory, package or ""). */
export function sourceBadge(item) {
  const scope = item.scope === "project" ? "the project's" : "your"
  if (item.source === "memory") return { label: "memory", title: "Saved by pi-hermes-memory", tone: "memory" }
  if (item.source === "builtin") return { label: "built-in", title: "Built into pi", tone: "" }
  if (item.kind === "package") {
    return { label: item.scope, title: `Listed in ${scope} pi settings (${item.source})`, tone: item.scope === "project" ? "project" : "" }
  }
  if (item.package) return { label: packageLabel(item.package), title: `Shipped by the package ${item.package}`, tone: "package" }
  if (item.source === "local") return { label: item.scope, title: `A path in ${scope} pi settings`, tone: item.scope === "project" ? "project" : "" }
  return { label: item.scope, title: item.scope === "project" ? "From the project's .pi or .agents folder" : "From ~/.pi/agent or ~/.agents", tone: item.scope === "project" ? "project" : "" }
}

/** What to type in the prompt box to use it, "" for kinds that aren't typed. */
export function insertFor(item) {
  if (item.kind === "skill") return `/skill:${item.name}`
  if (item.kind === "prompt") return `/${item.name}`
  return ""
}

/** Items matching `text` in their name, description or package, grouped in KINDS order (empty groups left out). */
export function groupItems(items, text = "") {
  const needle = String(text).trim().toLowerCase()
  const match = (it) => !needle || [it.name, it.description, it.package, it.source].some((f) => String(f || "").toLowerCase().includes(needle))
  return KINDS.map((k) => ({ ...k, items: (items || []).filter((it) => it.kind === k.id && match(it)) })).filter((g) => g.items.length)
}

/** The package item behind `item.package`, and a package's own items. */
export function packageOf(items, item) {
  return item.package ? (items || []).find((it) => it.kind === "package" && it.source === item.package) || null : null
}

export function packageItems(items, pkg) {
  return (items || []).filter((it) => it.kind !== "package" && it.package === pkg.source)
}
