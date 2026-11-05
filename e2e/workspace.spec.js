import { expect, test } from "@playwright/test"
import { resolve } from "node:path"

const PROJECT = resolve(".e2e-home/work/demo_app")

test.beforeEach(async ({ page }) => {
  const res = await page.request.post("/api/auth/login", { data: { username: "demo", password: "demo-password" } })
  expect(res.ok()).toBeTruthy()
})

test("the workspace panel shows the project's files and git status", async ({ page }) => {
  await page.goto(`/?project=${encodeURIComponent(PROJECT)}`)
  const panel = page.locator("#pwWorkspace")
  // Collapsed by default: a rail whose git icon counts the changed files.
  await expect(panel.locator('[data-tab="git"] .pw-side__badge')).toHaveText("4")

  await panel.locator('[data-tab="files"]').click()
  const files = panel.locator("#pwFiles")
  await expect(files.locator('[data-folder=""] > li > [data-path]')).toHaveText([".agents", "docs", ".gitignore", "main.go", "todo.md"])
  await files.locator('[data-path="docs"]').click()
  await expect(files.locator('[data-path="docs"]')).toHaveAttribute("aria-expanded", "true")
  await expect(files.locator('[data-path="docs/notes.txt"]')).toBeVisible()
  await files.locator('[data-path="docs"]').click()
  await expect(files.locator('[data-path="docs/notes.txt"]')).toHaveCount(0)

  await panel.locator('[role="tab"][data-tab="git"]').click()
  const git = panel.locator("#pwGit")
  await expect(git.locator(".pw-git__head")).toHaveText("main")
  const row = (group, path) => git.locator(`[data-group="${group}"] [data-path="${path}"]`)
  await expect(git.locator('[data-group="staged"] [data-path]')).toHaveCount(2)
  await expect(row("staged", "main.go").locator(".pw-git__status")).toHaveText("M")
  await expect(row("staged", "main.go").locator(".pw-git__lines")).toHaveText("+3−1")
  await expect(row("staged", "docs/notes.txt").locator(".pw-git__status")).toHaveText("R")
  await expect(row("changes", "main.go").locator(".pw-git__lines")).toHaveText("+1")
  await expect(row("changes", "old.txt").locator(".pw-git__status")).toHaveText("D")
  await expect(row("changes", "old.txt").locator(".pw-git__lines")).toHaveText("−3")
  await expect(row("changes", "todo.md").locator(".pw-git__status")).toHaveText("U")
  await expect(row("changes", "todo.md").locator(".pw-git__lines")).toHaveText("+2")

  // Collapsing a group hides its files; the panel's state survives a reload.
  await git.locator('[data-group="staged"] .pw-git__group-head').click()
  await expect(git.locator('[data-group="staged"] [data-path]')).toHaveCount(0)
  await page.reload()
  await expect(page.locator("#pwGit .pw-git__head")).toHaveText("main")
  await page.locator("#pwWorkspace").getByRole("button", { name: "Collapse workspace" }).click()
  await expect(page.locator("#pwWorkspace.pw-side--collapsed")).toBeVisible()
})
