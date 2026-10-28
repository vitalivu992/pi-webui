import { describe, expect, it } from "vitest"
import { editPairs, shellCommand, toolIcon, toolLabel, toolSummary } from "../src/lib/tools.js"

describe("tool calls", () => {
  it("summarizes the telling input of pi's tools", () => {
    expect(toolSummary("bash", { command: "go test ./...\nmore" })).toBe("go test ./...")
    expect(toolSummary("read", { path: "/home/me/p/src/lib/a.js", offset: 40 })).toBe("…/src/lib/a.js (from line 40)")
    expect(toolSummary("edit", { path: "/w/a.go", edits: [{ oldText: "a", newText: "b" }] })).toBe("/w/a.go")
    expect(toolSummary("edit", { path: "/w/a.go", edits: [{ oldText: "a", newText: "b" }, { oldText: "c", newText: "d" }] })).toBe(
      "/w/a.go (2 edits)"
    )
    expect(toolSummary("write", { path: "/w/b.md", content: "x" })).toBe("/w/b.md")
    expect(toolSummary("grep", { pattern: "RCA", path: "/w/src", glob: "*.go" })).toBe("RCA in /w/src (*.go)")
    expect(toolSummary("find", { pattern: "*.md" })).toBe("*.md")
    expect(toolSummary("ls", { path: "/w" })).toBe("/w")
    expect(toolSummary("mcp__x__y", { query: "q" })).toBe("q")
    expect(toolSummary("weird", null)).toBe("")
    expect(toolSummary("weird", "raw text\nmore")).toBe("raw text")
  })
  it("reads shell commands and edit pairs", () => {
    expect(shellCommand({ command: "git status" })).toBe("git status")
    expect(shellCommand({ command: ["git", "status"] })).toBe("")
    expect(editPairs({ edits: [{ oldText: "a", newText: "b" }, { oldText: 1 }] })).toEqual([{ oldText: "a", newText: "b" }])
    expect(editPairs({ oldText: "a", newText: "b" })).toEqual([{ oldText: "a", newText: "b" }])
    expect(editPairs(null)).toEqual([])
  })
  it("labels MCP tools by server and tool", () => expect(toolLabel("mcp__playwright__browser_click")).toBe("playwright · browser_click"))
  it("picks icons", () => {
    expect(toolIcon("bash")).toBe("fa-terminal")
    expect(toolIcon("edit")).toBe(toolIcon("write"))
    expect(toolIcon("grep")).toBe(toolIcon("find"))
    expect(toolIcon("mcp__a__b")).toBe("fa-plug")
    expect(toolIcon("unknown")).toBe("fa-wrench")
  })
})
