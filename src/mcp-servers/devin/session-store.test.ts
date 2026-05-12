import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { snapshotDevinSession, cancelDevinSession, cancelDevinSessions, readSessionLogSince, shutdownAllSessions, registerTestSession, clearTestSessions } from "./session-store"
import type { DevinSession } from "./types"

// @allow - minimal mock subprocess for testing cache logic without spawning
const mockSubprocess = {
  exited: Promise.resolve(0),
  kill: () => {},
  pid: -1,
} as unknown as DevinSession["proc"]

async function createMockSession(logContent: string): Promise<{ session: DevinSession; logPath: string; tmpDir: string }> {
  const tmpDir = await mkdtemp(join(tmpdir(), "devin-cache-test-"))
  const logPath = join(tmpDir, "test.log")
  await writeFile(logPath, logContent)
  const session: DevinSession = {
    id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    proc: mockSubprocess,
    logPath,
    startedAt: Date.now(),
    cwd: tmpDir,
    prompt: "test prompt",
    status: "running",
  }
  return { session, logPath, tmpDir }
}

describe("snapshotDevinSession cache", () => {
  let cleanupDirs: string[] = []

  afterEach(async () => {
    clearTestSessions()
    for (const dir of cleanupDirs) {
      try { await rmdir(dir, { recursive: true }) } catch { /* ignore */ }
    }
    cleanupDirs = []
  })

  it("returns correct output on first read", async () => {
    // given
    const { session, tmpDir } = await createMockSession("hello world\nline two")
    cleanupDirs.push(tmpDir)

    // when
    const snap = await snapshotDevinSession(session, 100)

    // then
    expect(snap.output).toContain("hello world")
    expect(snap.outputBytes).toBe(20)
  })

  it("returns identical output from cache on second read with unchanged file", async () => {
    // given
    const { session, tmpDir } = await createMockSession("cached content here")
    cleanupDirs.push(tmpDir)

    // when
    const first = await snapshotDevinSession(session, 100)
    const second = await snapshotDevinSession(session, 100)

    // then
    expect(second.output).toBe(first.output)
    expect(second.outputBytes).toBe(first.outputBytes)
  })

  it("returns new output after file changes", async () => {
    // given
    const { session, logPath, tmpDir } = await createMockSession("original content")
    cleanupDirs.push(tmpDir)

    // when
    const first = await snapshotDevinSession(session, 100)
    await writeFile(logPath, "modified content now")
    const second = await snapshotDevinSession(session, 100)

    // then
    expect(first.output).toContain("original")
    expect(second.output).toContain("modified")
    expect(second.output).not.toBe(first.output)
  })

  it("respects different tailBytes limits with separate cache entries", async () => {
    // given
    const lines = "a\n".repeat(20)
    const { session, tmpDir } = await createMockSession(lines)
    cleanupDirs.push(tmpDir)

    // when
    const small = await snapshotDevinSession(session, 10)
    const large = await snapshotDevinSession(session, 50)

    // then
    expect(small.outputBytes).toBe(large.outputBytes)
    // small tail triggers truncation prefix, but cached separately from large
    expect(small.output).toContain("truncated")
    expect(large.output).not.toContain("truncated")
  })

  it("evicts cache on cancel", async () => {
    // given
    const { session, tmpDir } = await createMockSession("evict me")
    cleanupDirs.push(tmpDir)

    // when
    const first = await snapshotDevinSession(session, 100)
    await cancelDevinSession(session.id)
    // After cancel, cache is cleared; reading again should still work (file exists)
    const second = await snapshotDevinSession(session, 100)

    // then
    expect(second.output).toBe(first.output)
  })
})

describe("cancelDevinSessions batch", () => {
  let cleanupDirs: string[] = []

  afterEach(async () => {
    clearTestSessions()
    for (const dir of cleanupDirs) {
      try { await rmdir(dir, { recursive: true }) } catch { /* ignore */ }
    }
    cleanupDirs = []
  })

  it("cancels known sessions and reports unknown ones", async () => {
    // given
    const { session: s1, tmpDir: d1 } = await createMockSession("s1")
    const { session: s2, tmpDir: d2 } = await createMockSession("s2")
    cleanupDirs.push(d1, d2)
    registerTestSession(s1)
    registerTestSession(s2)

    // when
    const result = await cancelDevinSessions([s1.id, s2.id, "fake-id"])

    // then
    expect(result.cancelled.sort()).toEqual([s1.id, s2.id].sort())
    expect(result.unknown).toEqual(["fake-id"])
    expect(result.errors).toEqual([])
  })

  it("handles empty ids gracefully", async () => {
    // zod enforces min(1) at the server layer, but the store function handles any array
    // when
    const result = await cancelDevinSessions([])

    // then
    expect(result.cancelled).toEqual([])
    expect(result.unknown).toEqual([])
    expect(result.errors).toEqual([])
  })
})

describe("readSessionLogSince incremental", () => {
  let cleanupDirs: string[] = []

  afterEach(async () => {
    clearTestSessions()
    for (const dir of cleanupDirs) {
      try { await rmdir(dir, { recursive: true }) } catch { /* ignore */ }
    }
    cleanupDirs = []
  })

  it("returns only new content after the given offset", async () => {
    // given
    const { session, logPath, tmpDir } = await createMockSession("first part\n")
    cleanupDirs.push(tmpDir)
    registerTestSession(session)
    const initialSize = (await Bun.file(logPath).text()).length
    await writeFile(logPath, "second part\n", { flag: "a" })

    // when
    const newOutput = await readSessionLogSince(session.id, initialSize)

    // then
    expect(newOutput).toBe("second part\n")
  })

  it("returns empty string when no new content", async () => {
    // given
    const { session, tmpDir } = await createMockSession("static content")
    cleanupDirs.push(tmpDir)
    registerTestSession(session)

    // when
    const newOutput = await readSessionLogSince(session.id, 100)

    // then
    expect(newOutput).toBe("")
  })

  it("returns all content when since_bytes is 0", async () => {
    // given
    const { session, tmpDir } = await createMockSession("all the content")
    cleanupDirs.push(tmpDir)
    registerTestSession(session)

    // when
    const output = await readSessionLogSince(session.id, 0)

    // then
    expect(output).toBe("all the content")
  })
})
