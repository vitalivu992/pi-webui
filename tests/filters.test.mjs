import { describe, expect, it } from "vitest"
import { filterConversations } from "../src/components/ConversationList.jsx"
import { filterProjects, listedProjects, liveLabel, projectLive } from "../src/components/ProjectsPanel.jsx"
import { workSummary } from "../src/components/ConversationView.jsx"

const convs = [
  { id: "a", title: "Health endpoint", models: ["anthropic/claude-opus-5-5"] },
  { id: "b", title: "Fix login", gitBranch: "feat/x", models: ["openai/gpt-5.6-luna"] },
]

describe("filters", () => {
  it("filters conversations by text (title, id, branch, model label)", () => {
    expect(filterConversations(convs, "opus 5.5").map((c) => c.id)).toEqual(["a"])
    expect(filterConversations(convs, "FEAT/").map((c) => c.id)).toEqual(["b"])
    expect(filterConversations(convs, "gpt 5.6").map((c) => c.id)).toEqual(["b"])
    expect(filterConversations(convs, "").length).toBe(2)
  })
  it("gives a project's live state and label, working first", () => {
    expect(projectLive({ running: 1, finished: 2 })).toBe("running")
    expect(projectLive({ finished: 2 })).toBe("finished")
    expect(projectLive({})).toBe("")
    expect(liveLabel({ running: 1, finished: 2 })).toBe("1 working, 2 just finished")
    expect(liveLabel({ finished: 1 })).toBe("1 just finished")
    expect(liveLabel({})).toBe("")
  })
  it("filters projects by name or path", () => {
    const projects = [{ key: "/w/app", name: "app", path: "/w/app" }, { key: "/x/tool", name: "tool", path: "/x/tool" }]
    expect(filterProjects(projects, "/x").map((p) => p.name)).toEqual(["tool"])
  })
  it("hides projects whose folder is gone, except the selected one", () => {
    const projects = [
      { key: "/w/app", path: "/w/app", exists: true },
      { key: "/w/old", path: "/w/old", exists: false },
      { key: "/w/gone", path: "/w/gone", exists: false },
      { key: "no-workspace", path: "", exists: false },
    ]
    const keys = (opts) => listedProjects(projects, opts).map((p) => p.key)
    expect(keys({})).toEqual(["/w/app", "no-workspace"])
    expect(keys({ selectedKey: "/w/old" })).toEqual(["/w/app", "/w/old", "no-workspace"])
    expect(keys({ showMissing: true })).toHaveLength(4)
  })
  it("summarizes a turn's work", () => {
    expect(workSummary([{ kind: "tool" }, { kind: "tool" }, { kind: "thinking" }])).toBe("2 tool calls · 1 thought")
    expect(workSummary([])).toBe("")
  })
})
