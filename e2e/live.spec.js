import { expect, test } from "@playwright/test"
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { assistant, session, sessionDir, toolCall, toolResult, user } from "./make-fixtures.mjs"

// A session the agent is still working on, in its own project so the other
// specs' project order and counts don't change (this project runs after them).
const LIVE = resolve(".e2e-home/work/live_app")
const DIR = sessionDir(LIVE)
const ID = "22222222-aaaa-4bbb-8ccc-000000000002"
const FILE = join(DIR, `2026-10-20T10-00-00-000Z_${ID}.jsonl`)

const lines = (...l) => l.map((x) => JSON.stringify(x)).join("\n") + "\n"
// Entries appended later continue the chain session() started (e1…e3).
const next = (id, parentId, entry) => ({ id, parentId, ...entry })
const bash = (id, command, at) => assistant([toolCall(id, "bash", { command })], at, { stopReason: "toolUse" })

test.beforeEach(async ({ page }) => {
  mkdirSync(LIVE, { recursive: true })
  mkdirSync(DIR, { recursive: true })
  writeFileSync(
    FILE,
    lines(
      ...session(ID, LIVE, "2026-10-20T10:00:00Z", [
        user("Run the test suite", "2026-10-20T10:00:00Z"),
        bash("t1", "go test ./...", "2026-10-20T10:00:02Z"),
        toolResult("t1", "ok  live 0.01s", "2026-10-20T10:00:04Z"),
      ])
    )
  )
  const res = await page.request.post("/api/auth/login", { data: { username: "demo", password: "demo-password" } })
  expect(res.ok()).toBeTruthy()
})

test.afterEach(() => rmSync(FILE, { force: true }))

test("follows a working session and collapses its work when it ends", async ({ page }) => {
  await page.goto(`/?project=${encodeURIComponent(LIVE)}&c=${ID}`)
  const chat = page.locator("#pwChat")
  // Working: the work is shown, no Live chip or status icon in the title (the header's progress
  // bar says it), and a working word ("Pondering…") under the answer.
  await expect(page.locator("#pwExpandAll")).toHaveText(/Hide work/)
  await expect(page.locator(".pw-chip--live")).toHaveCount(0)
  await expect(page.locator(".pw-view__title .pw-status")).toHaveCount(0)
  await expect(chat.locator(".pw-turn-status--live .pw-working-word")).toHaveText(/^[A-Z][a-z]+…$/)
  await expect(chat.locator(".pw-step-row")).toHaveCount(1)
  // The header carries the progress bar; the project and the conversation the working icon.
  await expect(page.locator(".pw-view__head .pw-progress")).toHaveCount(1)
  const projectRow = page.locator(`.pw-project[data-project="${LIVE}"]`)
  const convRow = page.locator(`.pw-conv[data-conversation="${ID}"]`)
  await expect(projectRow).toHaveClass(/is-running/)
  await expect(projectRow.locator(".pw-live--running")).toHaveAttribute("aria-label", "1 working")
  await expect(projectRow.locator(".pw-live--running > i")).toHaveClass(/fa-circle-dot/)
  await expect(convRow).toHaveClass(/is-running/)
  await expect(convRow.locator(".pw-live--running")).toHaveCount(1)
  await expect(page.locator(".pw-progress")).toHaveCount(1)

  // The agent writes another tool call: it shows up without a reload.
  appendFileSync(
    FILE,
    lines(next("e4", "e3", bash("t2", "go vet ./...", "2026-10-20T10:00:06Z")), next("e5", "e4", toolResult("t2", "", "2026-10-20T10:00:07Z")))
  )
  await expect(chat.locator(".pw-step-row")).toHaveCount(2)

  // The turn ends: the work collapses and the final answer is left.
  appendFileSync(
    FILE,
    lines(next("e6", "e5", assistant([{ type: "text", text: "All **green**." }], "2026-10-20T10:00:09Z")))
  )
  await expect(chat.locator(".markdown-body strong")).toHaveText("green")
  await expect(chat.locator(".pw-steps")).toHaveCount(0)
  await expect(chat.locator(".pw-turn-status--live")).toHaveCount(0)
  await expect(page.locator("#pwExpandAll")).toHaveText(/Show work/)
  await expect(page.locator(".pw-chip--live")).toHaveText(/Live/)
  await expect(page.locator(".pw-view__head .pw-progress")).toHaveCount(0)
  // The lists reload by themselves: the working icons turn into "just finished" checks.
  await expect(convRow).toHaveClass(/is-finished/, { timeout: 10_000 })
  await expect(convRow.locator(".pw-live--finished")).toHaveCount(1)
  await expect(projectRow).toHaveClass(/is-finished/, { timeout: 20_000 })
  await expect(projectRow.locator(".pw-live--finished")).toHaveAttribute("aria-label", "1 just finished")
})
