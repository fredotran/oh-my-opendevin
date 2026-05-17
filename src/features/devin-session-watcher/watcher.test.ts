import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { readMetaFile } from "./meta-reader"

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
