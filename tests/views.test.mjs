import { describe, expect, it } from "vitest"
import { filterBy, runStatusMeta, scheduleLabel, viewOf, viewsFor } from "../src/lib/views.js"

describe("viewsFor", () => {
  const ids = (f) => viewsFor(f).map((v) => v.id)
  it("shows a package's view only when it is installed", () => {
    expect(ids({})).toEqual(["sessions", "setup"])
    expect(ids({ cron: true })).toEqual(["sessions", "cron", "setup"])
    expect(ids({ cron: true, memory: true })).toEqual(["sessions", "cron", "memory", "setup"])
    expect(ids(null)).toEqual(["sessions", "setup"])
  })
  it("falls back to the sessions", () => {
    expect(viewOf("memory", { memory: true })).toBe("memory")
    expect(viewOf("memory", {})).toBe("sessions")
    expect(viewOf("", {})).toBe("sessions")
  })
})

describe("scheduleLabel", () => {
  it.each([
    [{ kind: "interval", everyMs: 300000 }, "Every 5m"],
    [{ kind: "interval", everyMs: 108000000 }, "Every 1d 6h"],
    [{ kind: "interval", everyMs: 30000 }, "Every 30s"],
    [{ kind: "cron", expression: "0 0 * * *" }, "Cron 0 0 * * *"],
    [{ kind: "cron", expression: "@daily", timezone: "UTC" }, "Cron @daily (UTC)"],
  ])("%o → %s", (s, label) => expect(scheduleLabel(s)).toBe(label))
  it("dates a one-time task", () => expect(scheduleLabel({ kind: "once", runAt: "2026-11-05T09:00:00" })).toMatch(/^Once, .*Nov 5, 2026/))
})

describe("runStatusMeta", () => {
  it("labels the statuses", () => {
    expect(runStatusMeta("error").label).toBe("Failed")
    expect(runStatusMeta(undefined).label).toBe("Not run yet")
  })
})

describe("filterBy", () => {
  const items = [{ name: "deploy", description: "Ship it" }, { name: "review" }]
  it("matches any field, ignoring case", () => {
    expect(filterBy(items, "SHIP", ["name", "description"])).toEqual([items[0]])
    expect(filterBy(items, "", ["name"])).toBe(items)
    expect(filterBy(null, "x", ["name"])).toEqual([])
  })
})
