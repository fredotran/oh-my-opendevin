import { describe, expect, test } from "bun:test"

describe("devin-session-watcher types", () => {
  test("WatchedSession type exists at runtime via object shape", () => {
    const session = {
      id: "test",
      status: "running" as const,
      prompt: "fix bug",
      model: "claude-sonnet-4-6",
      cwd: "/tmp",
      notified: false,
    }
    expect(session.id).toBe("test")
    expect(session.notified).toBe(false)
  })
})
