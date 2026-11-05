import { describe, expect, it } from "vitest"
import { groupItems, insertFor, packageItems, packageLabel, packageOf, sourceBadge } from "../src/lib/setup.js"

const items = [
  { id: "skill:wiki", kind: "skill", name: "wiki", source: "auto", scope: "user", description: "Keep notes" },
  { id: "package:agents-cron", kind: "package", name: "agents-cron", source: "npm:agents-cron", scope: "user" },
  { id: "skill:scheduler", kind: "skill", name: "scheduler", source: "npm:agents-cron", scope: "user", package: "npm:agents-cron" },
  { id: "extension:agents-cron", kind: "extension", name: "agents-cron", source: "npm:agents-cron", scope: "user", package: "npm:agents-cron" },
  { id: "prompt:ship", kind: "prompt", name: "ship", source: "auto", scope: "project" },
]

describe("packageLabel", () => {
  it.each([
    ["npm:agents-cron", "agents-cron"],
    ["npm:@scope/pkg@1.2.0", "@scope/pkg"],
    ["git:github.com/x/pi-tools@v1", "pi-tools@v1"],
    ["https://github.com/x/pi-tools.git", "pi-tools"],
    ["../local/pkg/", "pkg"],
  ])("%s → %s", (src, want) => expect(packageLabel(src)).toBe(want))
})

describe("groupItems", () => {
  it("groups by kind in order and drops empty groups", () => {
    expect(groupItems(items).map((g) => [g.id, g.items.map((i) => i.name)])).toEqual([
      ["package", ["agents-cron"]],
      ["extension", ["agents-cron"]],
      ["skill", ["wiki", "scheduler"]],
      ["prompt", ["ship"]],
    ])
  })
  it("filters by name, description and package", () => {
    expect(groupItems(items, "notes").flatMap((g) => g.items.map((i) => i.id))).toEqual(["skill:wiki"])
    expect(groupItems(items, "cron").flatMap((g) => g.items.map((i) => i.id))).toEqual([
      "package:agents-cron",
      "extension:agents-cron",
      "skill:scheduler",
    ])
    expect(groupItems(null)).toEqual([])
  })
})

describe("sourceBadge", () => {
  it("names the package, the scope, memory or built-in", () => {
    expect(sourceBadge(items[2])).toMatchObject({ label: "agents-cron", tone: "package" })
    expect(sourceBadge(items[4])).toMatchObject({ label: "project", tone: "project" })
    expect(sourceBadge(items[0])).toMatchObject({ label: "user", tone: "" })
    expect(sourceBadge({ kind: "skill", source: "memory", scope: "user" }).label).toBe("memory")
    expect(sourceBadge({ kind: "extension", source: "builtin", scope: "user" }).label).toBe("built-in")
  })
})

describe("packages", () => {
  it("links an item and its package both ways", () => {
    expect(packageOf(items, items[2]).id).toBe("package:agents-cron")
    expect(packageOf(items, items[0])).toBeNull()
    expect(packageItems(items, items[1]).map((i) => i.id)).toEqual(["skill:scheduler", "extension:agents-cron"])
  })
  it("knows what to type", () => {
    expect(insertFor(items[0])).toBe("/skill:wiki")
    expect(insertFor(items[4])).toBe("/ship")
    expect(insertFor(items[1])).toBe("")
  })
})
