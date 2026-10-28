import { expect, test } from "@playwright/test"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { PI_LOG, assistant, session, sessionDir, user } from "./make-fixtures.mjs"

// Prompts sent from the UI run the fake `pi` of e2e/make-fixtures.mjs (the server's
// LAUNCH_PATH): it appends the prompt and "Echo: <prompt>" to the session file. This spec has its
// own project, which is the newest while it runs: it runs after the specs that expect demo_app first.
const PROJECT = resolve(".e2e-home/work/prompt_app")
const DIR = sessionDir(PROJECT)
const ID = "33333333-aaaa-4bbb-8ccc-000000000003"
const project = encodeURIComponent(PROJECT)

const lines = (...l) => l.map((x) => JSON.stringify(x)).join("\n") + "\n"
// The argv of the fake pi's last run.
const lastArgs = () => JSON.parse(readFileSync(PI_LOG, "utf8").trim().split("\n").pop())

test.describe.configure({ mode: "serial" })

test.beforeEach(async ({ page }) => {
  rmSync(DIR, { recursive: true, force: true })
  mkdirSync(PROJECT, { recursive: true })
  mkdirSync(DIR, { recursive: true })
  writeFileSync(
    join(DIR, `2026-10-21T10-00-00-000Z_${ID}.jsonl`),
    lines(
      ...session(ID, PROJECT, "2026-10-21T10:00:00Z", [
        user("Plan the release", "2026-10-21T10:00:00Z"),
        assistant([{ type: "text", text: "Here is the plan." }], "2026-10-21T10:00:05Z"),
      ])
    )
  )
  const res = await page.request.post("/api/auth/login", { data: { username: "demo", password: "demo-password" } })
  expect(res.ok()).toBeTruthy()
})

// The project goes away again, so the specs after this one see demo_app first.
test.afterAll(() => rmSync(DIR, { recursive: true, force: true }))

test("sends a message with a skill to a conversation and shows the answer", async ({ page }) => {
  await page.goto(`/?project=${project}&c=${ID}`)
  const chat = page.locator("#pwChat")
  await expect(chat).toContainText("Here is the plan.")

  // "/" offers pi's prompt templates and skills; Enter picks one.
  const prompt = page.locator("#pwPrompt")
  await prompt.fill("/")
  const options = page.getByRole("listbox", { name: "Commands and skills" }).getByRole("option")
  await expect(options).toHaveText([/\/commit/, /\/skill:review-code/])
  await prompt.fill("/skill:rev")
  await expect(options).toHaveCount(1)
  await expect(options.first()).toContainText("Review the changed code for bugs")
  await prompt.press("Enter")
  await expect(prompt).toHaveValue("/skill:review-code ")
  await prompt.pressSequentially("the diff")
  // The skill is highlighted and named under the box.
  await expect(page.locator(".pw-prompt__cmd--skill")).toHaveText("/skill:review-code")
  await expect(page.locator(".pw-composer__uses")).toContainText("Uses the skill /skill:review-code")

  await prompt.press("Enter")
  await expect(prompt).toHaveValue("")
  await expect(chat.locator(".pw-msg--agent").last()).toContainText("Echo: /skill:review-code the diff")
  await expect(page.locator("#pwSend")).toBeVisible()
  await expect(page.locator("#pwPending")).toHaveCount(0)
  // pi expands the skill itself: the prompt goes as typed.
  expect(lastArgs()).toEqual(["-p", "--session", ID, "--", "/skill:review-code the diff"])
})

test("starts a conversation with the model and thinking level from the settings", async ({ page }) => {
  await page.goto(`/?project=${project}`)

  // Settings: the right panel, from the account menu; pi's models are suggested.
  await page.locator("#pwUserMenu").click()
  await page.locator("#pwOpenSettings").click()
  const settings = page.locator("#pwSettings")
  await expect(settings.locator(".pw-hset__suggest")).toContainText("2 models to pick from")
  await settings.getByRole("button", { name: "Add model" }).click()
  await settings.getByLabel("Model 1", { exact: true }).fill("anthropic/claude-opus-5-5")
  await settings.getByLabel("Thinking for model 1").selectOption("high")
  await settings.getByLabel("Preview with model").selectOption("anthropic/claude-opus-5-5")
  await expect(page.locator("#pwPreview")).toContainText(
    `cd ${PROJECT} && pi -p --session-id new-session-uuid --model anthropic/claude-opus-5-5 --thinking high -- 'Your prompt'`
  )
  await page.locator("#pwSettingsWide").click()
  await expect(settings).toHaveClass(/is-wide/)
  await page.locator("#pwSettingsClose").click()
  await expect(settings).toHaveCount(0)

  // New: the second column's button.
  await page.locator("#pwNewConversationBtn").click()
  await expect(page).toHaveURL(/new=1/)
  const view = page.locator("#pwNewConversation")
  await expect(view).toContainText("What should pi do in prompt_app?")
  await expect(page.locator("#pwComposerModel")).toHaveValue("anthropic/claude-opus-5-5")
  await expect(view.locator(".pw-composer__chips")).toContainText("High thinking")
  await page.locator("#pwPrompt").fill("Write the docs")
  await page.locator("#pwComposerCommand").click()
  await expect(page.locator("#pwComposerPreview")).toContainText("--model anthropic/claude-opus-5-5 --thinking high")
  await expect(page.locator("#pwComposerPreview")).toContainText("'Write the docs'")

  await page.locator("#pwSend").click()
  // The new conversation opens at once (pi takes its id), and fills in.
  await expect(page).toHaveURL(/c=[0-9a-f-]{36}/)
  await expect(page.locator("#pwChat .pw-msg--agent")).toContainText("Echo: Write the docs")
  await expect(page.locator("#pwConversations")).toContainText("Write the docs")
  const args = lastArgs()
  expect(args.slice(0, 2)).toEqual(["-p", "--session-id"])
  expect(args.slice(3)).toEqual(["--model", "anthropic/claude-opus-5-5", "--thinking", "high", "--", "Write the docs"])
  expect(page.url()).toContain(args[2])

  await page.locator("#pwNewConversationBtn").click()
  await page.locator("#pwNewConversation").getByRole("button", { name: "Cancel" }).click()
  await expect(page).not.toHaveURL(/new=/)
})

test("shows why a prompt failed", async ({ page }) => {
  await page.goto(`/?project=${project}&c=${ID}`)
  await page.locator("#pwPrompt").fill("please fail")
  await page.locator("#pwSend").click()
  const error = page.locator("#pwRunError")
  await expect(error).toContainText("The prompt failed (exit code 2)")
  await expect(error).toContainText("Error: simulated failure")
  await error.getByRole("button", { name: "Dismiss" }).click()
  await expect(error).toHaveCount(0)
})
