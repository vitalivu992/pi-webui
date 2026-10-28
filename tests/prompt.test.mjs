import { describe, expect, it } from "vitest"
import { applyCompletion, completionAt, highlightSegments, matchCommands, usedCommands } from "../src/lib/prompt.js"

const commands = [
  { name: "commit", insert: "/commit", kind: "command", description: "Create grouped commits" },
  { name: "llm-wiki", insert: "/skill:llm-wiki", kind: "skill", description: "Keep the wiki" },
  { name: "review", insert: "/review", kind: "command", description: "Review the diff" },
]

describe("completionAt", () => {
  it("finds a slash command only at the start of the prompt", () => {
    expect(completionAt("/sk", 3)).toEqual({ start: 0, end: 3, query: "/sk" })
    expect(completionAt("  /skill more", 5)).toEqual({ start: 2, end: 8, query: "/sk" })
    expect(completionAt("run /re", 7)).toBeNull()
    expect(completionAt("use $pla", 8)).toBeNull()
    expect(completionAt("plain", 3)).toBeNull()
  })
})

describe("matchCommands", () => {
  it("lists prefix matches before matches inside the name or description", () => {
    expect(matchCommands(commands, "/").map((c) => c.insert)).toEqual(["/commit", "/skill:llm-wiki", "/review"])
    expect(matchCommands(commands, "/r").map((c) => c.insert)).toEqual(["/review", "/commit"])
    expect(matchCommands(commands, "/wiki").map((c) => c.insert)).toEqual(["/skill:llm-wiki"])
    expect(matchCommands(commands, "$")).toEqual([])
  })
})

describe("applyCompletion", () => {
  it("replaces the token and adds a space", () => {
    expect(applyCompletion("/sk", { start: 0, end: 3 }, "/skill:llm-wiki")).toEqual({ text: "/skill:llm-wiki ", caret: 16 })
    expect(applyCompletion("/sk now", { start: 0, end: 3 }, "/skill:llm-wiki")).toEqual({ text: "/skill:llm-wiki now", caret: 16 })
  })
})

describe("highlightSegments", () => {
  it("marks the known command the prompt starts with", () => {
    const segs = highlightSegments("  /skill:llm-wiki ingest it", commands)
    expect(segs.map((s) => [s.text, s.command?.name || null])).toEqual([
      ["  ", null],
      ["/skill:llm-wiki", "llm-wiki"],
      [" ingest it", null],
    ])
    expect(usedCommands("/commit", commands).map((c) => c.insert)).toEqual(["/commit"])
  })

  it("marks nothing for an unknown command, a longer name or a command later on", () => {
    for (const text of ["/commits x", "/nope", "run /commit", ""]) {
      const segs = highlightSegments(text, commands)
      expect(segs.every((s) => !s.command)).toBe(true)
      expect(segs.map((s) => s.text).join("")).toBe(text)
    }
  })
})
