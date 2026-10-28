import { describe, expect, it } from "vitest"
import { resumeCommand, shellQuote } from "../src/lib/resume.js"

describe("resumeCommand", () => {
  it("cds into the session's directory and resumes it", () => {
    expect(resumeCommand({ id: "9e7b-1", cwd: "/home/me/app" })).toBe("cd /home/me/app && pi --session 9e7b-1")
    expect(resumeCommand({ id: "e95b-2", projectPath: "/home/me/My App" })).toBe(
      "cd '/home/me/My App' && pi --session e95b-2"
    )
  })

  it("skips the cd without a directory", () => {
    expect(resumeCommand({ id: "x" })).toBe("pi --session x")
    expect(resumeCommand(null)).toBe("")
    expect(resumeCommand({})).toBe("")
  })

  it("quotes for a POSIX shell", () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`)
    expect(shellQuote("")).toBe("''")
  })
})
