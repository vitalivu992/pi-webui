import { describe, expect, it } from "vitest"
import { configuredModels, effortsFor, launchRequest, normalizeSettings } from "../src/lib/settings.js"

describe("normalizeSettings", () => {
  it("fills the defaults and drops what isn't a setting", () => {
    const s = normalizeSettings({ models: [{ id: "anthropic/opus" }, null, { x: 1 }], effort: 3, fast: true })
    expect(s).toEqual({ models: [{ id: "anthropic/opus", effort: "" }], effort: "" })
    expect(normalizeSettings(null)).toEqual({ models: [], effort: "" })
  })
})

describe("launchRequest", () => {
  const settings = normalizeSettings({
    models: [{ id: " anthropic/opus ", effort: "high" }, { id: "", effort: "" }],
    effort: "low",
  })

  it("uses the model's thinking level, or the default model's", () => {
    expect(launchRequest(settings, { model: "anthropic/opus", prompt: "hi", cwd: "/w" })).toEqual({
      session: "",
      cwd: "/w",
      prompt: "hi",
      model: "anthropic/opus",
      effort: "high",
    })
    expect(launchRequest(settings, { prompt: "hi", session: "s1" })).toEqual({
      session: "s1",
      cwd: "",
      prompt: "hi",
      model: "",
      effort: "low",
    })
  })

  it("offers only the models with an id", () => {
    expect(configuredModels(settings).map((m) => m.id)).toEqual([" anthropic/opus "])
  })
})

describe("effortsFor", () => {
  const pi = { efforts: ["low", "medium", "high"] }
  it("prefers what the model supports", () => {
    expect(effortsFor(pi, { efforts: ["low"] })).toEqual(["low"])
    expect(effortsFor(pi, { efforts: [] })).toEqual([])
    expect(effortsFor(pi, { efforts: null })).toEqual(["low", "medium", "high"])
    expect(effortsFor(pi, undefined)).toEqual(["low", "medium", "high"])
    expect(effortsFor(null, undefined)).toEqual([])
  })
})
