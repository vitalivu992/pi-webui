import { expect, test } from "@playwright/test"
import { resolve } from "node:path"

const PROJECT = resolve(".e2e-home/work/demo_app")
const TASK = "task_0a1b2c3d"

test.beforeEach(async ({ page }) => {
  const res = await page.request.post("/api/auth/login", { data: { username: "demo", password: "demo-password" } })
  expect(res.ok()).toBeTruthy()
})

test("shows the views of the installed pi packages as icons", async ({ page }) => {
  await page.goto(`/?project=${encodeURIComponent(PROJECT)}`)
  const tabs = page.locator("#pwViewTabs [data-view]")
  await expect(tabs).toHaveCount(4)
  await expect(page.locator('#pwViewTabs [data-view="sessions"]')).toContainText("Sessions3")
  // Only the selected view spells out its name.
  await expect(page.locator('#pwViewTabs [data-view="cron"]')).toHaveText("")
  await expect(page.locator("#pwColumnView")).toHaveText("Sessions")

  await page.locator('#pwViewTabs [data-view="skills"]').click()
  await expect(page).toHaveURL(/view=skills/)
  await expect(page.locator("#pwColumnView")).toHaveText("Skills")
  // pi's user skill and the one pi-hermes-memory saved.
  await expect(page.locator("#pwSkills [data-skill]")).toHaveCount(2)
  await page.locator('#pwSkills [data-skill="debug-go-tests"]').click()
  await expect(page.locator("#pwSkill .pw-view__title")).toHaveText("debug-go-tests")
  await expect(page.locator("#pwSkill .markdown-body h2")).toHaveText("Procedure")
  await expect(page.locator("#pwSkill .pw-view__meta")).toContainText("memory")

  await page.locator('#pwViewTabs [data-view="sessions"]').click()
  await expect(page).not.toHaveURL(/view=/)
  await expect(page.locator("#pwConversations [data-conversation]")).toHaveCount(3)
})

test("lists a project's cron jobs and their runs", async ({ page }) => {
  await page.goto(`/?project=${encodeURIComponent(PROJECT)}&view=cron`)
  await expect(page.locator("#pwColumnView")).toHaveText("Cron jobs")
  const task = page.locator(`#pwCronTasks [data-task="${TASK}"]`)
  await expect(task).toContainText("Nightly audit")
  await expect(task).toContainText("Cron 0 0 * * *")
  await task.click()

  const view = page.locator("#pwCronTask")
  await expect(view.locator(".pw-view__title")).toHaveText("Nightly audit")
  await expect(view.locator(".pw-doc__prompt")).toHaveText("Audit the dependencies and report outdated ones.")
  const runs = page.locator("#pwCronRuns [data-run]")
  await expect(runs).toHaveCount(2)
  await expect(runs.nth(1)).toContainText("no network")

  await runs.first().click()
  await expect(page).toHaveURL(/run=run_20261104000000_aaaa0001/)
  const run = page.locator("#pwCronRun")
  await expect(run.locator(".pw-view__meta")).toContainText("Succeeded")
  await expect(run.locator(".markdown-body strong")).toHaveText("3")
  await expect(run.locator(".pw-msg--agent")).toContainText("nothing is outdated")

  await page.locator("#pwCronBack").click()
  await expect(page.locator("#pwCronRuns [data-run]")).toHaveCount(2)
  await runs.nth(1).click()
  await expect(page.locator("#pwCronRun .pw-code--output")).toHaveText("pi exited with code 1: no network")
})

test("reads the project's and the global memory", async ({ page }) => {
  await page.goto(`/?project=${encodeURIComponent(PROJECT)}&view=memory`)
  const stores = page.locator("#pwMemoryStores [data-store]")
  await expect(stores).toHaveCount(6)
  await expect(stores.first()).toContainText("Project memory")
  await expect(stores.first()).toContainText("project demo_app")

  await stores.first().click()
  await expect(page.locator("#pwMemoryEntries li")).toHaveCount(1)
  await expect(page.locator("#pwMemoryEntries code")).toHaveText("main.go")

  // The global failures written from this project show under the project.
  await page.locator('#pwMemoryStores [data-store="project-failures"]').click()
  const entry = page.locator("#pwMemoryEntries li")
  await expect(entry).toHaveCount(1)
  await expect(entry.locator(".pw-memory__cat")).toHaveText("correction")
  await expect(entry).toContainText("created 2026-11-02")

  await page.locator('#pwMemoryStores [data-store="failures"]').click()
  await expect(page.locator("#pwMemoryEntries li")).toHaveCount(2)
  await expect(page.locator("#pwMemoryEntries li").first()).toContainText("project demo_app")
})
