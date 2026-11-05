// Writes a fake home for e2e: one project with three pi sessions, an older session in a folder
// that no longer exists (hidden by default), a pi skill and prompt template, a fake `pi` CLI
// in bin/ (the server's LAUNCH_PATH) for the prompts sent from the UI and the setup view, and
// the stores of the pi-hermes-memory and agents-cron packages (installed per pi's settings). The
// project is a git repository with staged, changed and untracked files (the workspace panel).
// Run by playwright.config.js before it starts the server.
import { execFileSync } from "node:child_process"
import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

export const HOME = resolve(".e2e-home")
export const PROJECT = join(HOME, "work", "demo_app")
export const GONE = join(HOME, "work", "old_app")
export const BIN = join(HOME, "bin")
export const SESSIONS = join(HOME, ".pi", "agent", "sessions")
// Every argv the fake pi ran with, one JSON array per line.
export const PI_LOG = join(HOME, "pi-args.log")

export const HEALTH_ID = "11111111-aaaa-4bbb-8ccc-000000000001"
export const CRON_TASK = "task_0a1b2c3d"
export const CRON_RUN_OK = "run_20261104000000_aaaa0001"
export const CRON_RUN_FAILED = "run_20261103000000_aaaa0002"

/** pi's session folder for a cwd: "--home-me-app--". */
export const sessionDir = (cwd) => join(SESSIONS, `--${cwd.replace(/^\//, "").replace(/[^A-Za-z0-9]+/g, "-")}--`)

export function write(path, lines) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n")
}

/** A session's lines: the header, then the entries chained by parentId. */
export function session(id, cwd, at, entries) {
  let parent = null
  return [
    { type: "session", version: 3, id, timestamp: at, cwd },
    ...entries.map((e, i) => {
      const line = { id: `e${i + 1}`, parentId: parent, ...e }
      parent = line.id
      return line
    }),
  ]
}

export const user = (text, at) => ({ type: "message", timestamp: at, message: { role: "user", content: [{ type: "text", text }] } })
export const assistant = (content, at, { model = "claude-opus-5-5", stopReason = "stop", thinkingLevel, usage } = {}) => ({
  type: "message",
  timestamp: at,
  message: {
    role: "assistant",
    content,
    model,
    stopReason,
    ...(thinkingLevel ? { thinkingLevel } : {}),
    ...(usage ? { usage } : {}),
  },
})
export const toolCall = (id, name, args) => ({ type: "toolCall", id, name, arguments: args })
export const toolResult = (id, text, at) => ({
  type: "message",
  timestamp: at,
  message: { role: "toolResult", toolCallId: id, content: [{ type: "text", text }], isError: false },
})

export function makeFixtures() {
  rmSync(HOME, { recursive: true, force: true })
  mkdirSync(PROJECT, { recursive: true })
  const dir = sessionDir(PROJECT)
  write(join(dir, `2026-10-20T10-00-00-000Z_${HEALTH_ID}.jsonl`), [
    ...session(HEALTH_ID, PROJECT, "2026-10-20T10:00:00Z", [
      { type: "model_change", timestamp: "2026-10-20T10:00:00Z", provider: "anthropic", modelId: "claude-opus-5-5" },
      user("Add a health endpoint", "2026-10-20T10:00:00Z"),
      assistant(
        [
          { type: "thinking", thinking: "Check main.go for the router." },
          toolCall("t1", "bash", { command: "go test ./..." }),
        ],
        "2026-10-20T10:00:03Z",
        { stopReason: "toolUse" }
      ),
      toolResult("t1", "ok  demo 0.01s", "2026-10-20T10:00:08Z"),
      assistant(
        [{ type: "text", text: "## Done\n\nAdded `GET /health`.\n\n| Route | Status |\n|---|---|\n| /health | 200 |" }],
        "2026-10-20T10:00:10Z",
        {
          thinkingLevel: "high",
          usage: { input: 900, output: 120, cacheRead: 2000, cacheWrite: 100, reasoning: 30, cost: { total: 0.0042 } },
        }
      ),
    ]),
    { type: "session_info", id: "i1", parentId: "e5", timestamp: "2026-10-20T10:00:11Z", name: "Health endpoint" },
  ])
  write(join(dir, "2026-10-19T09-05-00-000Z_pi-login.jsonl"), session("pi-login", PROJECT, "2026-10-19T09:05:00Z", [
    user("Fix the login form", "2026-10-19T09:05:00Z"),
    assistant(
      [
        toolCall("r1", "read", { path: `${PROJECT}/login.js` }),
        toolCall("w1", "edit", { path: `${PROJECT}/login.js`, edits: [{ oldText: "if (email)", newText: "if (isEmail(email))" }] }),
      ],
      "2026-10-19T09:05:02Z",
      { model: "gpt-5.6-luna", stopReason: "toolUse" }
    ),
    toolResult("r1", "if (email) submit()", "2026-10-19T09:05:03Z"),
    toolResult("w1", "Edited login.js", "2026-10-19T09:05:04Z"),
    assistant([{ type: "text", text: "The form now **validates** the email." }], "2026-10-19T09:05:06Z", { model: "gpt-5.6-luna" }),
  ]))
  write(join(dir, "2026-10-17T08-00-00-000Z_pi-1.jsonl"), session("pi-1", PROJECT, "2026-10-17T08:00:00Z", [
    user("Explain the router", "2026-10-17T08:00:01Z"),
    assistant(
      [{ type: "text", text: "It uses `http.ServeMux`.\n\n```mermaid\nflowchart LR\n  req[Request] --> mux[ServeMux] --> h[Handler]\n```" }],
      "2026-10-17T08:00:03Z",
      { model: "gpt-5.6-luna" }
    ),
  ]))
  write(join(sessionDir(GONE), "2026-10-10T08-00-00-000Z_pi-old.jsonl"), session("pi-old", GONE, "2026-10-10T08:00:00Z", [
    user("Tidy up", "2026-10-10T08:00:01Z"),
    assistant([{ type: "text", text: "Done." }], "2026-10-10T08:00:02Z"),
  ]))
}

// Like pi -p: appends the prompt to the session file (a new one in the folder it runs in, or the
// one it continues), then after a moment the answer "Echo: <prompt>". `--list-models` prints a
// model table. A prompt containing "please fail" fails instead.
const FAKE_PI = `#!${process.execPath}
const fs = require("fs")
const path = require("path")
const args = process.argv.slice(2)
const sessions = ${JSON.stringify(SESSIONS)}
if (args[0] === "--list-models") {
  console.log("provider   model            context  max-out  thinking  images")
  console.log("anthropic  claude-opus-5-5  1M       128K     yes       yes")
  console.log("local      tiny             8K       4K       no        no")
  process.exit(0)
}
fs.appendFileSync(${JSON.stringify(PI_LOG)}, JSON.stringify(args) + "\\n")
const sep = args.indexOf("--")
const prompt = args.slice(sep + 1).join(" ")
const flag = (name) => {
  const i = args.indexOf(name)
  return i >= 0 && i < sep ? args[i + 1] : ""
}
if (prompt.includes("please fail")) {
  console.error("Error: simulated failure")
  process.exit(2)
}
const cwd = process.cwd()
let file = ""
const id = flag("--session")
if (id) {
  for (const d of fs.readdirSync(sessions)) {
    for (const f of fs.readdirSync(path.join(sessions, d))) if (f.endsWith("_" + id + ".jsonl")) file = path.join(sessions, d, f)
  }
  if (!file) {
    console.error("No session found matching '" + id + "'")
    process.exit(1)
  }
} else {
  const dir = path.join(sessions, "--" + cwd.replace(/^\\//, "").replace(/[^A-Za-z0-9]+/g, "-") + "--")
  fs.mkdirSync(dir, { recursive: true })
  const now = new Date().toISOString()
  file = path.join(dir, now.replace(/[:.]/g, "-") + "_" + flag("--session-id") + ".jsonl")
  fs.writeFileSync(file, JSON.stringify({ type: "session", version: 3, id: flag("--session-id"), timestamp: now, cwd }) + "\\n")
}
const lines = fs.readFileSync(file, "utf8").trim().split("\\n").map((l) => JSON.parse(l))
let parent = lines.length > 1 ? lines[lines.length - 1].id : null
let n = 0
const add = (message) => {
  const entry = { type: "message", id: "x" + Date.now() + "-" + n++, parentId: parent, timestamp: new Date().toISOString(), message }
  parent = entry.id
  fs.appendFileSync(file, JSON.stringify(entry) + "\\n")
}
add({ role: "user", content: [{ type: "text", text: prompt }] })
setTimeout(() => {
  add({ role: "assistant", content: [{ type: "text", text: "Echo: " + prompt }], model: (flag("--model") || "claude-opus-5-5").split("/").pop(), stopReason: "stop" })
}, 1500)
`

// pi's package API that internal/setup/resolve.mjs imports, answering from the fake home: the
// packages in settings.json (installed when agent/npm/node_modules has them), their extensions and
// skills folders, the builtin extensions, and pi's own skills and prompts folders.
const FAKE_PI_API = `import { existsSync, readFileSync, readdirSync } from "node:fs"
import { basename, dirname, join } from "node:path"
const desc = (file) => (readFileSync(file, "utf8").match(/description: (.*)/) || [])[1] || ""
export const SettingsManager = { create: (cwd, agentDir) => ({ cwd, agentDir }) }
export class DefaultPackageManager {
  constructor(o) { this.o = o }
  packages() {
    const { packages = [] } = JSON.parse(readFileSync(join(this.o.agentDir, "settings.json"), "utf8"))
    return packages.map((source) => {
      const dir = join(this.o.agentDir, "npm", "node_modules", source.slice(4).replace(/@[^@]*$/, ""))
      return { source, scope: "user", filtered: false, installedPath: existsSync(dir) ? dir : undefined }
    })
  }
  listConfiguredPackages() { return this.packages() }
  async resolve() {
    const out = { extensions: [], skills: [], prompts: [], themes: [], installFailures: [] }
    for (const p of this.packages()) {
      if (!p.installedPath) continue
      const metadata = { source: p.source, scope: "user", origin: "package", packageRoot: p.installedPath }
      const pi = JSON.parse(readFileSync(join(p.installedPath, "package.json"), "utf8")).pi || {}
      for (const e of pi.extensions || []) out.extensions.push({ path: join(p.installedPath, e), enabled: true, metadata })
      for (const d of pi.skills || []) out.skills.push({ path: join(p.installedPath, d), enabled: true, metadata })
    }
    for (const n of this.o.builtinExtensions) out.extensions.push({ path: "builtin:" + n, enabled: true, metadata: { source: "builtin", scope: "user", origin: "top-level" } })
    const auto = { source: "auto", scope: "user", origin: "top-level" }
    const skills = join(this.o.agentDir, "skills")
    for (const d of existsSync(skills) ? readdirSync(skills) : []) out.skills.push({ path: join(skills, d, "SKILL.md"), enabled: true, metadata: auto })
    const prompts = join(this.o.agentDir, "prompts")
    for (const f of existsSync(prompts) ? readdirSync(prompts) : []) out.prompts.push({ path: join(prompts, f), enabled: true, metadata: auto })
    return out
  }
}
export function loadSkills({ skillPaths }) {
  const files = skillPaths.flatMap((p) => (p.endsWith("SKILL.md") ? [p] : readdirSync(p).map((d) => join(p, d, "SKILL.md"))))
  return { skills: files.map((f) => ({ name: basename(dirname(f)), description: desc(f), filePath: f, disableModelInvocation: false })) }
}
`

const FAKE_PI_PROMPTS = `import { readFileSync } from "node:fs"
import { basename } from "node:path"
export function loadPromptTemplates({ promptPaths }) {
  return { templates: promptPaths.map((f) => ({ name: basename(f, ".md"), description: (readFileSync(f, "utf8").match(/description: (.*)/) || [])[1] || "", filePath: f })) }
}
`

export function makeTools() {
  mkdirSync(BIN, { recursive: true })
  // The repo's package.json says "module"; the fake is CommonJS. bin/ doubles as pi's package
  // (its ESM API in dist/), and node is where pi's installer keeps it.
  writeFileSync(join(BIN, "package.json"), '{"name":"@earendil-works/pi-coding-agent","version":"0.0.0-e2e","type":"commonjs"}\n')
  text(join(BIN, "dist", "package.json"), '{"type":"module"}\n')
  text(join(BIN, "dist", "index.js"), FAKE_PI_API)
  text(join(BIN, "dist", "core", "prompt-templates.js"), FAKE_PI_PROMPTS)
  text(join(BIN, "dist", "extensions", "index.js"), 'export const builtInExtensions = [{ name: "mcp" }]\n')
  const node = join(HOME, ".local", "share", "pi-node", "current", "bin", "node")
  mkdirSync(dirname(node), { recursive: true })
  rmSync(node, { force: true })
  symlinkSync(process.execPath, node)
  writeFileSync(join(BIN, "pi"), FAKE_PI)
  chmodSync(join(BIN, "pi"), 0o755)
  writeFileSync(PI_LOG, "")
  const skill = join(HOME, ".pi", "agent", "skills", "review-code", "SKILL.md")
  mkdirSync(dirname(skill), { recursive: true })
  writeFileSync(skill, "---\nname: review-code\ndescription: Review the changed code for bugs\n---\nReview it.\n")
  const template = join(HOME, ".pi", "agent", "prompts", "commit.md")
  mkdirSync(dirname(template), { recursive: true })
  writeFileSync(template, "---\ndescription: Create grouped commits\n---\nCommit the changes.\n")
}

const text = (path, content) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

/** pi-hermes-memory's markdown stores and agents-cron's registry and runs, for the demo project. */
export function makeExtras() {
  const agent = join(HOME, ".pi", "agent")
  text(join(agent, "settings.json"), JSON.stringify({ packages: ["npm:pi-extmgr", "npm:pi-hermes-memory", "npm:agents-cron@0.16.1"] }))
  const mem = join(agent, "pi-hermes-memory")
  const demo64 = Buffer.from("demo_app").toString("base64url")
  text(join(mem, "MEMORY.md"), "Uses pnpm, not npm <!-- created=2026-11-01, last=2026-11-04 -->\n§\nCI runs on GitHub Actions")
  text(join(mem, "USER.md"), "Prefers short answers <!-- created=2026-11-01, last=2026-11-01 -->")
  text(
    join(mem, "failures.md"),
    `[correction] Run \`go test\` before committing — Failed: committed a broken build <!-- created=2026-11-02, last=2026-11-02, project64=${demo64} -->\n§\n[failure] Elsewhere <!-- created=2026-11-02, last=2026-11-02 -->`
  )
  text(join(mem, "skills", "debug-go-tests", "SKILL.md"), "---\nname: debug-go-tests\ndescription: Find why a Go test fails\n---\n\n## Procedure\n\n1. Run `go test -run X -v`\n")
  // Installed packages: agents-cron ships an extension and a skill; pi-extmgr isn't installed.
  const cron = join(agent, "npm", "node_modules", "agents-cron")
  text(join(cron, "package.json"), JSON.stringify({ name: "agents-cron", version: "0.16.1", description: "Cron-driven scheduled prompt tasks", pi: { extensions: ["./index.mjs"], skills: ["./skills"] } }))
  text(join(cron, "README.md"), "# agents-cron\n\nSchedules prompts.\n")
  text(join(cron, "index.mjs"), "export default () => {}\n")
  text(join(cron, "skills", "scheduler", "SKILL.md"), "---\nname: scheduler\ndescription: Create cron-driven prompt tasks\n---\n\n## Schedule\n")
  const hermes = join(agent, "npm", "node_modules", "pi-hermes-memory")
  text(join(hermes, "package.json"), JSON.stringify({ name: "pi-hermes-memory", version: "0.10.0", description: "Persistent memory", pi: { extensions: ["./src/index.ts"] } }))
  text(join(hermes, "src", "index.ts"), "export default () => {}\n")
  text(join(agent, "projects-memory", "demo_app", "MEMORY.md"), "The health endpoint lives in `main.go` <!-- created=2026-11-03, last=2026-11-03 -->")

  const task = {
    id: CRON_TASK,
    projectDir: PROJECT,
    name: "Nightly audit",
    prompt: "Audit the dependencies and report outdated ones.",
    schedule: { kind: "cron", expression: "0 0 * * *" },
    enabled: true,
    nextRunAt: "2026-11-06T00:00:00.000Z",
    lastRunAt: "2026-11-04T00:00:00.000Z",
    lastStatus: "success",
    successCount: 1,
    errorCount: 1,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-04T00:00:00.000Z",
  }
  text(join(HOME, ".agents", "cron", "tasks.json"), JSON.stringify({ version: 2, tasks: [task] }))
  const store = join(PROJECT, ".agents", "cron")
  const sessionFile = join(store, "sessions", CRON_TASK, `${CRON_RUN_OK}.jsonl`)
  const runs = [
    { runId: CRON_RUN_OK, taskId: CRON_TASK, trigger: "scheduled", startedAt: "2026-11-04T00:00:00.000Z", finishedAt: "2026-11-04T00:01:05.000Z", status: "success", exitCode: 0, agent: "pi", sessionFile, summary: "All **3** dependencies are current." },
    { runId: CRON_RUN_FAILED, taskId: CRON_TASK, trigger: "manual", startedAt: "2026-11-03T00:00:00.000Z", finishedAt: "2026-11-03T00:00:02.000Z", status: "error", exitCode: 1, agent: "pi", error: "pi exited with code 1: no network" },
  ]
  for (const r of runs) text(join(store, "runs", `${r.runId}.json`), JSON.stringify(r))
  write(sessionFile, session("cron-session-1", PROJECT, "2026-11-04T00:00:00Z", [
    user("Audit the dependencies and report outdated ones.", "2026-11-04T00:00:01Z"),
    assistant([{ type: "text", text: "Checked go.mod: nothing is outdated." }], "2026-11-04T00:01:00Z"),
  ]))
}

/**
 * The demo project as a git repository: main.go staged (+3 −1) and changed again (+1),
 * notes.txt renamed to docs/notes.txt (staged), old.txt deleted, todo.md untracked (2 lines).
 */
export function makeRepo() {
  // No global or system config: the user's signing, hooks or diff settings stay out.
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }
  const git = (...args) => execFileSync("git", ["-c", "user.name=e2e", "-c", "user.email=e2e@example.com", ...args], { cwd: PROJECT, env })
  text(join(PROJECT, ".gitignore"), ".agents/\n")
  text(join(PROJECT, "main.go"), "package main\n\nfunc main() {}\n")
  text(join(PROJECT, "notes.txt"), "keep\n")
  text(join(PROJECT, "old.txt"), "one\ntwo\nthree\n")
  git("init", "-q", "-b", "main")
  git("add", ".")
  git("commit", "-q", "-m", "init")
  text(join(PROJECT, "main.go"), "package main\n\nimport \"net/http\"\n\nfunc main() { http.ListenAndServe() }\n")
  git("add", "main.go")
  text(join(PROJECT, "main.go"), "package main\n\nimport \"net/http\"\n\nfunc main() { http.ListenAndServe() }\n// health\n")
  mkdirSync(join(PROJECT, "docs"), { recursive: true })
  git("mv", "notes.txt", "docs/notes.txt")
  rmSync(join(PROJECT, "old.txt"))
  text(join(PROJECT, "todo.md"), "- health\n- tests\n")
}

if (import.meta.url === `file://${process.argv[1]}`) {
  makeFixtures()
  makeTools()
  makeExtras()
  makeRepo()
}
