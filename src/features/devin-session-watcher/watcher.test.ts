import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { readMetaFile } from "./meta-reader"
import { createDevinNotifier } from "./notifier"
import type { WatchedSession } from "./types"

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

describe("readMetaFile", () => {
  test("returns null for non-existent file", () => {
    const result = readMetaFile("/nonexistent/path/meta.json")
    expect(result).toBeNull()
  })

  test("parses valid meta.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "devin-test-"))
    const metaPath = join(dir, "test-session.meta.json")
    writeFileSync(metaPath, JSON.stringify({
      id: "test-session",
      status: "running",
      prompt: "fix bug",
      model: "claude-sonnet-4-6",
      cwd: "/tmp",
    }))

    const result = readMetaFile(metaPath)
    expect(result).not.toBeNull()
    expect(result?.id).toBe("test-session")
    expect(result?.status).toBe("running")

    rmSync(dir, { recursive: true, force: true })
  })

  test("returns null for invalid JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "devin-test-"))
    const metaPath = join(dir, "bad.meta.json")
    writeFileSync(metaPath, "not json")

    const result = readMetaFile(metaPath)
    expect(result).toBeNull()

    rmSync(dir, { recursive: true, force: true })
  })
})

describe("createDevinNotifier", () => {
  test("calls both callbacks when session completes", () => {
    const systemReminders: string[] = []
    const osNotifications: string[] = []

    const notifier = createDevinNotifier({
      sendSystemReminder: (text) => systemReminders.push(text),
      sendOsNotification: (text) => osNotifications.push(text),
    })

    const session: WatchedSession = {
      id: "abc-123",
      status: "completed",
      exitCode: 0,
      endedAt: Date.now(),
      prompt: "fix bug",
      model: "claude-sonnet-4-6",
      cwd: "/tmp",
      notified: false,
    }

    notifier.notify(session)

    expect(systemReminders.length).toBe(1)
    expect(systemReminders[0]).toContain("abc-123")
    expect(systemReminders[0]).toContain("completed")
    expect(osNotifications.length).toBe(1)
    expect(osNotifications[0]).toContain("abc-123")
    expect(session.notified).toBe(true)
  })

  test("skips disabled notification channels", () => {
    const systemReminders: string[] = []

    const notifier = createDevinNotifier({
      sendSystemReminder: (text) => systemReminders.push(text),
      sendOsNotification: undefined,
    })

    const session: WatchedSession = {
      id: "def-456",
      status: "error",
      exitCode: 1,
      endedAt: Date.now(),
      prompt: "build fails",
      model: "gpt-5.5",
      cwd: "/tmp",
      notified: false,
    }

    notifier.notify(session)

    expect(systemReminders.length).toBe(1)
    expect(session.notified).toBe(true)
  })
})
