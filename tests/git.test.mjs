import { describe, expect, it } from "vitest"
import {
  buildTree,
  conflictCount,
  conflictSides,
  diffStats,
  discardPrompt,
  findChange,
  languageOf,
  opTitle,
  parseConflicts,
  parseDiff,
  resolveConflict,
  splitHighlighted,
  treeFiles,
} from "../src/lib/git.js"

describe("buildTree", () => {
  it("compacts single-child folders and sorts", () => {
    const tree = buildTree([{ path: "src/lib/b.js" }, { path: "src/lib/a.js" }, { path: "README.md" }, { path: "docs/x/y.md" }])
    expect(tree.files.map((f) => f.path)).toEqual(["README.md"])
    expect(tree.dirs.map((d) => [d.name, d.path])).toEqual([
      ["docs/x", "docs/x"],
      ["src/lib", "src/lib"],
    ])
    expect(tree.dirs[1].files.map((f) => f.path)).toEqual(["src/lib/a.js", "src/lib/b.js"])
    expect(treeFiles(tree).length).toBe(4)
  })
})

describe("findChange", () => {
  const status = { repo: true, merge: [], staged: [{ path: "a" }], changes: [{ path: "b" }] }
  it("follows a file to another group", () => {
    expect(findChange(status, "changes", "a").group).toBe("staged")
    expect(findChange(status, "changes", "b").group).toBe("changes")
    expect(findChange(status, "staged", "gone")).toBeNull()
  })
})

describe("opTitle", () => {
  it("words the actions as VS Code", () => {
    expect(opTitle("stage", "changes", false)).toBe("Stage Changes")
    expect(opTitle("discard", "changes", true)).toBe("Discard All Changes")
    expect(opTitle("stage", "merge", true)).toBe("Mark All Resolved")
  })
})

describe("discardPrompt", () => {
  it("warns that untracked files are deleted", () => {
    expect(discardPrompt([{ path: "a", status: "U" }]).confirm).toBe("Delete file")
    expect(discardPrompt([{ path: "a", status: "M" }]).confirm).toBe("Discard changes")
    expect(discardPrompt([{ path: "a", status: "M" }, { path: "b", status: "U" }]).body).toMatch(/1 untracked file\(s\) are deleted/)
  })
})

describe("conflictSides", () => {
  it("swaps the sides in a rebase", () => {
    expect(conflictSides("UU", "merge").mine.op).toBe("ours")
    expect(conflictSides("UU", "rebase").mine.op).toBe("theirs")
    expect(conflictSides("UU", "").mine.op).toBe("theirs")
    expect(conflictSides("UD", "merge")).toBeNull()
  })
})

describe("parseDiff", () => {
  it("numbers the lines of a hunk", () => {
    const files = parseDiff("diff --git a/x b/x\nindex 1..2\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n\\ No newline at end of file\n")
    expect(files).toHaveLength(1)
    expect(files[0].hunks[0].lines).toEqual([
      { kind: "ctx", text: "a", old: 1, new: 1 },
      { kind: "del", text: "b", old: 2 },
      { kind: "add", text: "B", new: 2 },
      { kind: "meta", text: "\\ No newline at end of file" },
    ])
    expect(diffStats(files)).toEqual({ add: 1, del: 1 })
  })
  it("reads a combined diff", () => {
    const files = parseDiff("diff --cc x\n@@@ -1,1 -1,1 +1,5 @@@\n++<<<<<<< HEAD\n +mine\n++=======\n+ theirs\n++>>>>>>> topic\n")
    expect(files[0].hunks[0].lines.map((l) => [l.kind, l.text])).toEqual([
      ["add", "<<<<<<< HEAD"],
      ["add", "mine"],
      ["add", "======="],
      ["add", "theirs"],
      ["add", ">>>>>>> topic"],
    ])
  })
})

describe("conflict markers", () => {
  const text = "a\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> topic\nb\n<<<<<<< HEAD\nx\n||||||| base\no\n=======\ny\n>>>>>>> topic\n"
  it("splits a file into text and blocks", () => {
    const segs = parseConflicts(text)
    expect(segs.map((s) => s.kind)).toEqual(["text", "conflict", "text", "conflict"])
    expect(segs[1]).toMatchObject({ index: 0, ours: ["mine\n"], theirs: ["theirs\n"], base: null, oursLabel: "HEAD", theirsLabel: "topic" })
    expect(segs[3]).toMatchObject({ index: 1, ours: ["x\n"], base: ["o\n"], theirs: ["y\n"] })
    expect(conflictCount(text)).toBe(2)
  })
  it("resolves one block and keeps the others", () => {
    const once = resolveConflict(text, 0, "theirs")
    expect(once.startsWith("a\ntheirs\nb\n<<<<<<< HEAD\nx\n")).toBe(true)
    expect(conflictCount(once)).toBe(1)
    // The kept block is written back unchanged (base section included).
    expect(once).toBe("a\ntheirs\n" + text.slice(text.indexOf("b\n")))
    expect(resolveConflict(once, 0, "both")).toBe("a\ntheirs\nb\nx\ny\n")
    expect(resolveConflict(text, 1, "none")).toBe(text.slice(0, text.indexOf("<<<<<<< HEAD\nx")))
  })
  it("leaves an unclosed block as text", () => {
    expect(conflictCount("<<<<<<< HEAD\na\n=======\n")).toBe(0)
    expect(conflictCount("<<<<<<<<< not a marker\n")).toBe(0)
  })
})

describe("languageOf", () => {
  it("maps extensions to hljs languages", () => {
    expect(languageOf("src/App.jsx")).toBe("javascript")
    expect(languageOf("Makefile")).toBe("makefile")
    expect(languageOf("notes")).toBe("")
  })
})

describe("splitHighlighted", () => {
  it("closes and reopens spans across lines", () => {
    expect(splitHighlighted('a <span class="c">/* x\ny */</span> b\nc\n')).toEqual(['a <span class="c">/* x</span>', '<span class="c">y */</span> b', "c"])
    expect(splitHighlighted("one")).toEqual(["one"])
    expect(splitHighlighted("")).toEqual([""])
  })
})
