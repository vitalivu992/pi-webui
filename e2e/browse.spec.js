import { expect, test } from "@playwright/test"
import { resolve } from "node:path"

const PROJECT = resolve(".e2e-home/work/demo_app")
const HEALTH = "11111111-aaaa-4bbb-8ccc-000000000001"

// page.request shares the page's cookies, so the session cookie applies to the page.
test.beforeEach(async ({ page }) => {
  const res = await page.request.post("/api/auth/login", { data: { username: "demo", password: "demo-password" } })
  expect(res.ok()).toBeTruthy()
})

test("browses a project's pi sessions", async ({ page }) => {
  await page.goto("/")
  // The most recent project opens by itself, with no harness filter.
  await expect(page.locator("#pwProjects [data-project]").first()).toContainText("demo_app")
  await expect(page.locator("#pwProjects [data-project]").first()).toContainText("3")
  const list = page.locator("#pwConversations")
  await expect(list.locator("[data-conversation]")).toHaveCount(3)
  await expect(page.getByRole("group", { name: "Harness" })).toHaveCount(0)
  await expect(list).toContainText("Health endpoint")
  await expect(list).toContainText("Fix the login form")
  await expect(list.locator(`[data-conversation="${HEALTH}"] .pw-conv__agent`)).toHaveText("Opus 5.5")

  await list.getByText("Health endpoint").click()
  await expect(page).toHaveURL(new RegExp(`c=${HEALTH}`))
  const chat = page.locator("#pwChat")
  await expect(chat.locator(".pw-msg--user")).toContainText("Add a health endpoint")
  await expect(chat.locator(".pw-msg--agent .pw-msg__who")).toHaveText("pi - Opus 5.5")
  // The final answer is rendered markdown; the work is collapsed.
  await expect(chat.locator(".markdown-body table")).toContainText("/health")
  await expect(chat.locator(".pw-steps")).toHaveCount(0)
  await chat.locator(".pw-work__toggle").click()
  await expect(chat.locator(".pw-step-row")).toHaveCount(2)
  await expect(chat.locator(".pw-step--thinking")).toContainText("Check main.go")
  await chat.locator(".pw-step--tool .pw-step__head").click()
  await expect(chat.locator(".pw-code--shell")).toHaveText("go test ./...")
  await expect(chat.locator(".pw-code--output")).toContainText("ok  demo")

  await list.getByText("Fix the login form").click()
  await expect(chat.locator(".pw-msg--agent .pw-msg__who")).toHaveText("pi - GPT 5.6 Luna")
  await expect(chat.locator(".markdown-body strong")).toHaveText("validates")
})

test("shows pi's edits as removed and added text", async ({ page }) => {
  await page.goto(`/?project=${encodeURIComponent(PROJECT)}&c=pi-login`)
  const chat = page.locator("#pwChat")
  await chat.locator(".pw-work__toggle").click()
  const edit = chat.locator(".pw-step--tool").nth(1)
  await expect(edit.locator(".pw-step__summary")).toHaveText(`…/work/demo_app/login.js`)
  await edit.locator(".pw-step__head").click()
  await expect(edit.locator(".pw-code--del")).toHaveText("if (email)")
  await expect(edit.locator(".pw-code--add")).toHaveText("if (isEmail(email))")
})

test("copies the resume command", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  await page.goto(`/?project=${encodeURIComponent(PROJECT)}&c=${HEALTH}`)
  await page.locator("#pwResume").click()
  const command = page.locator("#pwResumeCommand")
  await expect(command).toHaveText(`cd ${PROJECT} && pi --session ${HEALTH}`)
  await page.locator("#pwResumeCopy").click()
  await expect(page.locator("#pwResumeCopy")).toContainText("Copied")
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`cd ${PROJECT} && pi --session ${HEALTH}`)
})

test("copies the final answer as markdown from its footer", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  await page.goto(`/?project=${encodeURIComponent(PROJECT)}&c=${HEALTH}`)
  const copy = page.locator("#pwChat .pw-copy-btn")
  await expect(copy).toHaveCSS("opacity", "0")
  await page.locator("#pwChat .pw-msg__foot").hover()
  await expect(copy).toHaveCSS("opacity", "1")
  await copy.click()
  await expect(copy).toContainText("Copied")
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("## Done\n\nAdded `GET /health`.\n\n| Route | Status |\n|---|---|\n| /health | 200 |")
})

test("copies a mermaid diagram as a PNG image", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  await page.goto(`/?project=${encodeURIComponent(PROJECT)}&c=pi-1`)
  const diagram = page.locator("#pwChat .pw-diagram")
  await expect(diagram.locator("svg")).toBeVisible()
  const copy = diagram.locator(".pw-diagram__copy")
  await diagram.hover()
  await expect(copy).toHaveCSS("opacity", "1")
  await copy.click()
  await expect(copy).toContainText("Copied")
  const image = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read()
    const bitmap = await createImageBitmap(await item.getType("image/png"))
    return { types: item.types, width: bitmap.width, height: bitmap.height }
  })
  expect(image.types).toContain("image/png")
  expect(image.width).toBeGreaterThan(image.height)
})

test("collapses the projects panel and filters by text", async ({ page }) => {
  await page.goto(`/?project=${encodeURIComponent(PROJECT)}`)
  await page.getByRole("button", { name: "Collapse projects" }).click()
  await expect(page.locator(".pw-rail__item")).toHaveCount(1)
  await page.getByRole("button", { name: "Expand projects" }).click()
  await expect(page.locator("#pwProjects")).toBeVisible()

  await page.getByLabel("Filter conversations").fill("luna")
  await expect(page.locator("#pwConversations [data-conversation]")).toHaveCount(2)
  await page.getByLabel("Filter conversations").fill("login")
  await expect(page.locator("#pwConversations [data-conversation]")).toHaveCount(1)
  await expect(page.locator("#pwConversations")).toContainText("Fix the login form")
})

test("hides projects whose folder is gone until the count is clicked", async ({ page }) => {
  await page.goto("/")
  const rows = page.locator("#pwProjects [data-project]")
  await expect(rows).toHaveCount(1)
  const count = page.locator("#pwProjectsCount")
  await expect(count).toHaveText("1")
  await count.click()
  await expect(count).toHaveText("2")
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(1)).toContainText("old_app")
  await expect(rows.nth(1)).toHaveClass(/is-missing/)
  await count.click()
  await expect(rows).toHaveCount(1)
})
