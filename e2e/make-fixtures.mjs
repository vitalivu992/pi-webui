// Writes a fake home for e2e: one project with three pi sessions, an older session in a folder
// that no longer exists (hidden by default), a pi skill and prompt template, and a fake `pi` CLI
// in bin/ (the server's LAUNCH_PATH) for the prompts sent from the UI.
// Run by playwright.config.js before it starts the server.
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

export const HOME = resolve(".e2e-home")
export const PROJECT = join(HOME, "work", "demo_app")
export const GONE = join(HOME, "work", "old_app")
export const BIN = join(HOME, "bin")
export const SESSIONS = join(HOME, ".pi", "agent", "sessions")
// Every argv the fake pi ran with, one JSON array per line.
export const PI_LOG = join(HOME, "pi-args.log")

export const HEALTH_ID = "11111111-aaaa-4bbb-8ccc-000000000001"

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

export function makeTools() {
  mkdirSync(BIN, { recursive: true })
  // The repo's package.json says "module"; the fake is CommonJS.
  writeFileSync(join(BIN, "package.json"), '{"type":"commonjs"}\n')
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

if (import.meta.url === `file://${process.argv[1]}`) {
  makeFixtures()
  makeTools()
}
