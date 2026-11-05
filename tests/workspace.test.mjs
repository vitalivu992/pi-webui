import { describe, expect, it } from "vitest"
import { changeCount, fileSize, gitGroups, joinPath, splitPath } from "../src/lib/workspace.js"

describe("gitGroups", () => {
  it("keeps the groups with files, conflicts first", () => {
    const status = { repo: true, merge: [], staged: [{ path: "a" }], changes: [{ path: "b" }] }
    expect(gitGroups(status).map((g) => g.id)).toEqual(["staged", "changes"])
    expect(gitGroups({ ...status, merge: [{ path: "c" }] }).map((g) => g.id)).toEqual(["merge", "staged", "changes"])
  })
  it("has none outside a repository", () => {
    expect(gitGroups({ repo: false })).toEqual([])
    expect(gitGroups(null)).toEqual([])
  })
})

describe("changeCount", () => {
  it("counts a file staged and changed once", () => {
    expect(changeCount({ repo: true, staged: [{ path: "a" }], changes: [{ path: "a" }, { path: "b" }] })).toBe(2)
    expect(changeCount(null)).toBe(0)
  })
})

describe("paths", () => {
  it("splits a path into name and folder", () => {
    expect(splitPath("src/lib/a.js")).toEqual({ name: "a.js", dir: "src/lib" })
    expect(splitPath("README.md")).toEqual({ name: "README.md", dir: "" })
  })
  it("joins a child to its folder", () => {
    expect(joinPath("", "src")).toBe("src")
    expect(joinPath("src", "lib")).toBe("src/lib")
  })
})

describe("fileSize", () => {
  it.each([
    [0, "0 B"],
    [1023, "1023 B"],
    [1536, "1.5 KB"],
    [20 * 1024 * 1024, "20 MB"],
    [undefined, ""],
  ])("%s → %s", (bytes, label) => expect(fileSize(bytes)).toBe(label))
})
