import { expect, test } from "@playwright/test"
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { assistant, sessionDir, session, user, write } from "./make-fixtures.mjs"

// The Git tab's changes run real git in a repository of their own (with a bare
// remote), so demo_app's status, which the workspace spec reads, stays as it is.
// It has its own Playwright project: its conversation makes it the newest project.
const HOME = resolve(".e2e-home")
const PROJECT = join(HOME, "work", "git_app")
const REMOTE = join(HOME, "remotes", "git_app.git")
const DIR = sessionDir(PROJECT)
const url = `/?project=${encodeURIComponent(PROJECT)}`

// No global or system config (signing, hooks) for the repository the server's git works in.
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }
const git = (...args) => execFileSync("git", args, { cwd: PROJECT, env }).toString()
const text = (name, body) => {
  mkdirSync(join(PROJECT, name, ".."), { recursive: true })
  writeFileSync(join(PROJECT, name), body)
}

test.describe.configure({ mode: "serial" })

test.beforeEach(async ({ page }) => {
  rmSync(PROJECT, { recursive: true, force: true })
  rmSync(REMOTE, { recursive: true, force: true })
  rmSync(DIR, { recursive: true, force: true })
  mkdirSync(PROJECT, { recursive: true })
  write(join(DIR, "2026-11-01T10-00-00-000Z_git-1.jsonl"), session("git-1", PROJECT, "2026-11-01T10:00:00Z", [user("Fix the app", "2026-11-01T10:00:00Z"), assistant([{ type: "text", text: "Done." }], "2026-11-01T10:00:05Z")]))
  execFileSync("git", ["init", "-q", "--bare", REMOTE], { env })
  git("init", "-q", "-b", "main")
  for (const [k, v] of Object.entries({ "user.name": "e2e", "user.email": "e2e@example.com", "commit.gpgsign": "false", "core.hooksPath": "/dev/null" })) git("config", k, v)
  text("app.js", "const a = 1\nconst b = 2\n")
  text("src/util.js", "export const x = 1\n")
  git("add", ".")
  git("commit", "-q", "-m", "init")
  git("remote", "add", "origin", REMOTE)
  git("push", "-q", "-u", "origin", "main")
  const res = await page.request.post("/api/auth/login", { data: { username: "demo", password: "demo-password" } })
  expect(res.ok()).toBeTruthy()
  // The Git tab open, the panel expanded.
  await page.addInitScript(() => localStorage.setItem("pw_prefs", JSON.stringify({ workspaceCollapsed: false, workspaceTab: "git" })))
})

test.afterAll(() => {
  rmSync(DIR, { recursive: true, force: true })
  rmSync(PROJECT, { recursive: true, force: true })
  rmSync(REMOTE, { recursive: true, force: true })
})

test("stages, views the diff, discards, commits and pushes", async ({ page }) => {
  text("app.js", "const a = 1\nconst b = 3\n")
  text("src/util.js", "export const x = 2\n")
  text("notes.md", "# notes\n")
  await page.goto(url)
  const gitTab = page.locator("#pwGit")
  const row = (group, path) => gitTab.locator(`[data-group="${group}"] [data-path="${path}"]`)
  await expect(gitTab.locator('[data-group="changes"] [data-path]')).toHaveCount(3)

  // A click opens the diff in the viewer; it expands over the page and closes with Esc.
  await row("changes", "app.js").locator(".pw-git__main").click()
  const viewer = page.locator("#pwViewer")
  await expect(viewer).toHaveAttribute("data-mode", "diff")
  await expect(viewer.locator(".pw-diff__line.is-del .pw-diff__code")).toHaveText("-const b = 2")
  await expect(viewer.locator(".pw-diff__line.is-add .pw-diff__code")).toHaveText("+const b = 3")
  await viewer.locator("#pwViewerExpand").click()
  await expect(page.locator(".pw-side__view.is-expanded")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.locator(".pw-side__view.is-expanded")).toHaveCount(0)
  await viewer.locator("#pwViewerMode").click()
  await expect(viewer).toHaveAttribute("data-mode", "file")
  await expect(viewer.locator(".pw-diff__code").nth(1)).toHaveText("const b = 3")
  await page.keyboard.press("Escape")
  await expect(viewer).toHaveCount(0)

  // Stage one file from its row; the open diff follows it into Staged.
  await row("changes", "app.js").locator(".pw-git__main").click()
  await row("changes", "app.js").hover()
  await row("changes", "app.js").locator('[data-op="stage"]').click()
  await expect(row("staged", "app.js")).toBeVisible()
  await expect(row("staged", "app.js")).toHaveClass(/is-active/)
  await expect(page.locator("#pwViewer .pw-viewer__badge")).toHaveText("Staged")

  // Discard asks first; an untracked file is deleted.
  await row("changes", "notes.md").hover()
  await row("changes", "notes.md").locator('[data-op="discard"]').click()
  await expect(page.locator("#pwConfirmTitle")).toHaveText('Delete "notes.md"?')
  await page.locator("#pwConfirmOk").click()
  await expect(row("changes", "notes.md")).toHaveCount(0)
  expect(() => readFileSync(join(PROJECT, "notes.md"))).toThrow()

  // Stage a whole folder from its row, then commit and push.
  const folder = gitTab.locator('[data-group="changes"] [data-dir="src"]')
  await folder.hover()
  await folder.locator('[data-op="stage"]').click()
  await expect(gitTab.locator('[data-group="staged"] [data-path]')).toHaveCount(2)
  await expect(page.locator("#pwCommit")).toBeDisabled()
  await page.locator("#pwCommitMsg").fill("Bump b and x")
  await page.locator("#pwCommitMore").click()
  await page.locator('[data-item="commit-push"]').click()
  await expect(gitTab.locator(".pw-empty")).toHaveText("No changes.")
  await expect(page.locator("#pwCommitMsg")).toHaveValue("")
  expect(execFileSync("git", ["log", "-1", "--format=%s", "main"], { cwd: REMOTE, env }).toString().trim()).toBe("Bump b and x")
  await expect(page.locator("#pwViewer")).toHaveCount(0)
})

test("opens a file from the Files tab", async ({ page }) => {
  await page.goto(url)
  await page.locator('#pwWorkspace [role="tab"][data-tab="files"]').click()
  await page.locator('#pwFiles [data-path="src"]').click()
  await page.locator('#pwFiles [data-path="src/util.js"]').click()
  const viewer = page.locator("#pwViewer")
  await expect(viewer).toHaveAttribute("data-path", "src/util.js")
  await expect(viewer.locator(".pw-diff__code")).toHaveText("export const x = 1")
  await expect(page.locator('#pwFiles [data-path="src/util.js"]')).toHaveClass(/is-active/)
  await viewer.locator("#pwViewerClose").click()
  await expect(viewer).toHaveCount(0)
})

test("resolves a merge conflict block by block and continues", async ({ page }) => {
  git("checkout", "-q", "-b", "topic")
  text("app.js", "const a = 1\nconst b = 'theirs'\n")
  git("commit", "-q", "-am", "topic")
  git("checkout", "-q", "main")
  text("app.js", "const a = 1\nconst b = 'mine'\n")
  git("commit", "-q", "-am", "main")
  expect(() => git("merge", "topic")).toThrow()

  await page.goto(url)
  await expect(page.locator("#pwGitState")).toContainText("1 conflict left")
  await expect(page.locator('#pwGitState [data-op="continue"]')).toBeDisabled()
  await expect(page.locator("#pwCommit")).toBeDisabled()
  await page.locator('#pwGit [data-group="merge"] [data-path="app.js"] .pw-git__main').click()
  const viewer = page.locator("#pwViewer")
  await expect(viewer).toHaveAttribute("data-mode", "file")
  await expect(viewer.locator(".pw-viewer__kind")).toHaveText("both modified")
  const block = viewer.locator('[data-conflict="0"]')
  await expect(block.locator(".is-ours .pw-diff__code")).toHaveText("const b = 'mine'")
  await expect(block.locator(".is-theirs .pw-diff__code")).toHaveText("const b = 'theirs'")
  await block.locator('[data-accept="both"]').click()
  await expect(viewer.locator("#pwConflictCount")).toHaveText("No conflict markers left: mark the file resolved.")
  expect(readFileSync(join(PROJECT, "app.js"), "utf8")).toBe("const a = 1\nconst b = 'mine'\nconst b = 'theirs'\n")

  await viewer.locator('#pwResolve [data-op="stage"]').click()
  await expect(page.locator("#pwGitState")).toContainText("No conflicts left")
  await page.locator('#pwGitState [data-op="continue"]').click()
  await expect(page.locator("#pwGitState")).toHaveCount(0)
  expect(git("log", "-1", "--format=%s")).toMatch(/^Merge branch 'topic'/)
})

test("takes one side of a conflict, and aborts a merge", async ({ page }) => {
  git("checkout", "-q", "-b", "topic")
  text("app.js", "theirs\n")
  git("commit", "-q", "-am", "topic")
  git("checkout", "-q", "main")
  text("app.js", "mine\n")
  git("commit", "-q", "-am", "main")
  expect(() => git("merge", "topic")).toThrow()

  await page.goto(url)
  await page.locator('#pwGit [data-group="merge"] [data-path="app.js"] .pw-git__main').click()
  await page.locator('#pwResolve [data-take="theirs"]').click()
  await expect(page.locator("#pwConfirmTitle")).toHaveText('Take theirs for "app.js"?')
  await page.locator("#pwConfirmOk").click()
  await expect(page.locator('#pwGit [data-group="staged"] [data-path="app.js"]')).toBeVisible()
  expect(readFileSync(join(PROJECT, "app.js"), "utf8")).toBe("theirs\n")

  await page.locator('#pwGitState [data-op="abort"]').click()
  await page.locator("#pwConfirmOk").click()
  await expect(page.locator("#pwGitState")).toHaveCount(0)
  expect(readFileSync(join(PROJECT, "app.js"), "utf8")).toBe("mine\n")
})

test("shows the output of a failed command", async ({ page }) => {
  // The remote is gone: the push fails.
  rmSync(REMOTE, { recursive: true, force: true })
  text("app.js", "x\n")
  git("commit", "-q", "-am", "local")
  await page.goto(url)
  await page.locator("#pwGitPush").click()
  const fail = page.locator("#pwGitFail")
  await expect(fail.locator("code")).toHaveText("git push")
  await expect(fail.locator("pre")).toContainText("does not appear to be a git repository")
  await fail.getByRole("button", { name: "Dismiss the error" }).click()
  await expect(fail).toHaveCount(0)
})
