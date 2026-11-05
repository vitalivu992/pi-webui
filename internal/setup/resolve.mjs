// Asks pi's own package manager what it loads in a folder, without installing
// anything or running an extension: node resolve.mjs <pi package dir> <agent dir> <cwd>.
// Prints { version, packages, items, failures } as JSON (see setup.go).
import { readFileSync } from "node:fs"
import { basename, dirname, extname, join, relative, sep } from "node:path"
import { pathToFileURL } from "node:url"

const [pkgDir, agentDir, cwd] = process.argv.slice(-3)
const pi = await import(pathToFileURL(join(pkgDir, "dist", "index.js")).href)

// Not exported from the package's index.
const { loadPromptTemplates } = await import(pathToFileURL(join(pkgDir, "dist", "core", "prompt-templates.js")).href)

let builtins = []
try {
  const mod = await import(pathToFileURL(join(pkgDir, "dist", "extensions", "index.js")).href)
  builtins = (mod.builtInExtensions || []).map((e) => e.name)
} catch {}

const settings = pi.SettingsManager.create(cwd, agentDir)
const pm = new pi.DefaultPackageManager({ cwd, agentDir, settingsManager: settings, builtinExtensions: builtins })
// "skip": a configured package that isn't installed yet stays so.
const resolved = await pm.resolve(async () => "skip")

function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return null
  }
}

function homepage(pkg) {
  const repo = typeof pkg?.repository === "string" ? pkg.repository : pkg?.repository?.url
  return pkg?.homepage || (repo ? repo.replace(/^git\+/, "").replace(/\.git$/, "") : "")
}

// A package that isn't installed: "@scope/tools" for npm:@scope/tools@1, "tools" for git:…/tools@v1 or ./tools.
function sourceName(source) {
  if (source.startsWith("npm:")) return source.slice(4).replace(/(.)@[^@]*$/, "$1")
  return basename(source.replace(/@[^@/]*$/, "").replace(/[/\\]+$/, "").replace(/\.git$/, ""))
}

const packages = pm.listConfiguredPackages().map((p) => {
  const pkg = p.installedPath ? readJSON(join(p.installedPath, "package.json")) : null
  return {
    source: p.source,
    scope: p.scope,
    name: pkg?.name || sourceName(p.source),
    version: pkg?.version || "",
    description: pkg?.description || "",
    homepage: homepage(pkg),
    path: p.installedPath || "",
    enabled: Boolean(p.installedPath),
    filtered: p.filtered,
  }
})

// A top-level extension's package.json: in its folder or one or two above, not past pi's own folders.
function nearestPackage(file) {
  const stops = new Set([agentDir, join(agentDir, "extensions"), join(cwd, ".pi"), join(cwd, ".pi", "extensions")])
  let dir = dirname(file)
  for (let i = 0; i < 3 && !stops.has(dir); i++, dir = dirname(dir)) {
    const pkg = readJSON(join(dir, "package.json"))
    if (pkg) return { root: dir, pkg }
  }
  return null
}

const items = []
const perRoot = new Map()
for (const r of resolved.extensions) {
  const root = r.metadata.packageRoot
  if (root) perRoot.set(root, (perRoot.get(root) || 0) + 1)
}
for (const r of resolved.extensions) {
  const m = r.metadata
  const item = { kind: "extension", source: m.source, scope: m.scope, path: r.path, enabled: r.enabled }
  if (m.source === "builtin") {
    item.name = r.path.slice("builtin:".length)
    item.description = "Built into pi"
    item.path = ""
  } else {
    const found = m.packageRoot ? { root: m.packageRoot, pkg: readJSON(join(m.packageRoot, "package.json")) } : nearestPackage(r.path)
    const stem = basename(r.path, extname(r.path))
    if (found) {
      const name = found.pkg?.name || basename(found.root)
      item.name = perRoot.get(found.root) > 1 ? `${name}/${relative(found.root, r.path).split(sep).join("/")}` : name
      item.description = found.pkg?.description || ""
      item.root = found.root
    } else {
      item.name = stem === "index" ? basename(dirname(r.path)) : stem
      item.description = ""
    }
  }
  if (m.origin === "package") item.package = m.source
  items.push(item)
}

// Skills and prompts by pi's own loaders (names from frontmatter, collisions dropped like pi does),
// the enabled ones first so a disabled duplicate doesn't hide them.
function load(kind, list, loader) {
  for (const enabled of [true, false]) {
    const picked = list.filter((r) => r.enabled === enabled)
    if (!picked.length) continue
    // A resolved path is the file or a folder holding it.
    const meta = (path) => picked.find((r) => path === r.path || path.startsWith(r.path + sep))?.metadata
    for (const x of loader(picked.map((r) => r.path))) {
      const m = meta(x.path) || x.sourceInfo || {}
      const item = { kind, name: x.name, description: x.description || "", source: m.source || "local", scope: m.scope || "user", path: x.path, enabled }
      if (m.origin === "package") item.package = m.source
      if (x.manual) item.manual = true
      items.push(item)
    }
  }
}
load("skill", resolved.skills, (paths) =>
  pi.loadSkills({ cwd, agentDir, skillPaths: paths, includeDefaults: false }).skills.map((s) => ({
    name: s.name,
    description: s.description,
    path: s.filePath,
    sourceInfo: s.sourceInfo,
    manual: s.disableModelInvocation,
  }))
)
load("prompt", resolved.prompts, (paths) =>
  loadPromptTemplates({ cwd, agentDir, promptPaths: paths, includeDefaults: false }).templates.map((t) => ({
    name: t.name,
    description: t.description,
    path: t.filePath,
    sourceInfo: t.sourceInfo,
  }))
)
for (const r of resolved.themes) {
  const theme = readJSON(r.path)
  const item = { kind: "theme", name: theme?.name || basename(r.path, extname(r.path)), description: "", source: r.metadata.source, scope: r.metadata.scope, path: r.path, enabled: r.enabled }
  if (r.metadata.origin === "package") item.package = r.metadata.source
  items.push(item)
}

const version = readJSON(join(pkgDir, "package.json"))?.version || ""
process.stdout.write(JSON.stringify({ version, packages, items, failures: resolved.installFailures || [] }))
// pi's modules may keep timers alive.
process.exit(0)
