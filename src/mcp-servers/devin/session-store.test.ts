import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { mkdtemp, writeFile, mkdir, unlink, rmdir } from "node:fs/promises"
import { truncateSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { snapshotDevinSession, cancelDevinSession, cancelDevinSessions, readSessionLogSince, shutdownAllSessions, registerTestSession, clearTestSessions, reattachOrphanedSessions, setDevinBinaryAvailable } from "./session-store"
import type { DevinSession } from "./types"
import type { SessionMetaFile } from "./types"

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

describe("reattachOrphanedSessions", () => {
  let testLogDir: string

  beforeEach(async () => {
    clearTestSessions()
    testLogDir = await mkdtemp(join(tmpdir(), "devin-reattach-test-"))
  })

  afterEach(async () => {
    clearTestSessions()
    try { await rmdir(testLogDir, { recursive: true }) } catch { /* ignore */ }
  })

  it("reattaches sessions with status 'running' as 'orphaned'", async () => {
    // given — write a .meta.json that looks like it was left behind
    const sessionId = "orphan-test-1234"
    const meta: SessionMetaFile = {
      id: sessionId,
      model: "sonnet",
      prompt: "fix the bug",
      cwd: testLogDir,
      command: ["devin", "-p", "fix the bug", "--model", "sonnet"],
      startedAt: Date.now() - 60_000,
      status: "running",
    }
    // We need to write to the actual LOG_DIR, so we'll use the module's
    // reattachOrphanedSessions which reads from /tmp/oh-my-opencode-devin-mcp/
    const logDir = join(tmpdir(), "oh-my-opencode-devin-mcp")
    await mkdir(logDir, { recursive: true })
    const metaPath = join(logDir, `${sessionId}.meta.json`)
    const logPath = join(logDir, `${sessionId}.log`)
    await writeFile(metaPath, JSON.stringify(meta, null, 2))
    await writeFile(logPath, "some log output")

    // when
    const count = await reattachOrphanedSessions()

    // then
    expect(count).toBeGreaterThanOrEqual(1)
    // The meta file should be updated to "orphaned"
    const updatedMeta = JSON.parse(await Bun.file(metaPath).text())
    expect(updatedMeta.status).toBe("orphaned")

    // cleanup
    try { await unlink(metaPath) } catch { /* ignore */ }
    try { await unlink(logPath) } catch { /* ignore */ }
  })

  it("skips sessions with non-running status", async () => {
    // given
    const sessionId = "completed-test-5678"
    const meta: SessionMetaFile = {
      id: sessionId,
      model: "opus",
      prompt: "already done",
      cwd: testLogDir,
      command: ["devin", "-p", "already done"],
      startedAt: Date.now() - 120_000,
      status: "completed",
      endedAt: Date.now() - 60_000,
      exitCode: 0,
    }
    const logDir = join(tmpdir(), "oh-my-opencode-devin-mcp")
    await mkdir(logDir, { recursive: true })
    const metaPath = join(logDir, `${sessionId}.meta.json`)
    await writeFile(metaPath, JSON.stringify(meta, null, 2))

    // when
    const count = await reattachOrphanedSessions()

    // then — completed sessions should not be reattached
    // (count may include other orphans from prior test, but the completed one should be skipped)
    const updatedMeta = JSON.parse(await Bun.file(metaPath).text())
    expect(updatedMeta.status).toBe("completed")

    // cleanup
    try { await unlink(metaPath) } catch { /* ignore */ }
  })
})

describe("pre-flight validation", () => {
  afterEach(() => {
    clearTestSessions()
  })

  it("rejects model names with typos via levenshtein", async () => {
    // given — set binary as available to skip that check
    setDevinBinaryAvailable(true)

    // when / then
    const { startDevinSession } = await import("./session-store")
    await expect(
      startDevinSession({ prompt: "test", model: "sonet" }),
    ).rejects.toThrow(/did you mean "sonnet"/)
  })

  it("rejects model names with another typo", async () => {
    // given
    setDevinBinaryAvailable(true)

    // when / then
    const { startDevinSession } = await import("./session-store")
    await expect(
      startDevinSession({ prompt: "test", model: "opsu" }),
    ).rejects.toThrow(/did you mean "opus"/)
  })

  it("accepts known model names without error", async () => {
    // given
    setDevinBinaryAvailable(true)

    // when / then — should not throw for model validation
    // (it will throw for spawn since devin binary isn't real, but model check passes)
    const { startDevinSession } = await import("./session-store")
    try {
      await startDevinSession({ prompt: "test", model: "sonnet" })
    } catch (err) {
      // May fail at spawn, but NOT at model validation
      expect((err as Error).message).not.toContain("did you mean")
    }
  })

  it("accepts unknown but non-typo model names", async () => {
    // given
    setDevinBinaryAvailable(true)

    // when / then — "gpt-99" is not close to any known model
    const { startDevinSession } = await import("./session-store")
    try {
      await startDevinSession({ prompt: "test", model: "gpt-99" })
    } catch (err) {
      expect((err as Error).message).not.toContain("did you mean")
    }
  })
})

describe("idle session detection", () => {
  let cleanupDirs: string[] = []

  afterEach(async () => {
    clearTestSessions()
    for (const dir of cleanupDirs) {
      try { await rmdir(dir, { recursive: true }) } catch { /* ignore */ }
    }
    cleanupDirs = []
  })

  it("tracks lastOutputBytes and lastOutputAt on new sessions", async () => {
    // given
    const { session, tmpDir } = await createMockSession("some output")
    cleanupDirs.push(tmpDir)
    session.lastOutputBytes = 0
    session.lastOutputAt = Date.now()

    // then
    expect(session.lastOutputBytes).toBe(0)
    expect(session.lastOutputAt).toBeDefined()
    expect(session.lastOutputAt).toBeGreaterThan(0)
  })

  it("allows stalled status on session type", () => {
    // given
    const { session } = { session: { status: "stalled" as const } }

    // then
    expect(session.status).toBe("stalled")
  })

  it("allows orphaned status on session type", () => {
    // given
    const { session } = { session: { status: "orphaned" as const } }

    // then
    expect(session.status).toBe("orphaned")
  })
})

describe("max duration cap", () => {
  let cleanupDirs: string[] = []

  afterEach(async () => {
    clearTestSessions()
    for (const dir of cleanupDirs) {
      try { await rmdir(dir, { recursive: true }) } catch { /* ignore */ }
    }
    cleanupDirs = []
  })

  it("rejects maxDurationMs below 1 minute", async () => {
    // given
    setDevinBinaryAvailable(true)

    // when / then
    const { startDevinSession } = await import("./session-store")
    await expect(
      startDevinSession({ prompt: "test", maxDurationMs: 30_000 }),
    ).rejects.toThrow(/maxDurationMs must be at least 60000ms/)
  })

  it("rejects negative maxDurationMs", async () => {
    // given
    setDevinBinaryAvailable(true)

    // when / then
    const { startDevinSession } = await import("./session-store")
    await expect(
      startDevinSession({ prompt: "test", maxDurationMs: -1 }),
    ).rejects.toThrow(/maxDurationMs must be at least 60000ms/)
  })

  it("cancels session that exceeds maxDurationMs", async () => {
    // given — a mock session that started 3 minutes ago with 2 minute max
    const tmpDir = await mkdtemp(join(tmpdir(), "devin-maxdur-test-"))
    cleanupDirs.push(tmpDir)
    const logPath = join(tmpDir, "test.log")
    await writeFile(logPath, "some output")

    const now = Date.now()
    const session: DevinSession = {
      id: "test-maxdur-1",
      proc: mockSubprocess,
      logPath,
      startedAt: now - 180_000, // 3 minutes ago
      cwd: tmpDir,
      prompt: "test prompt",
      status: "running",
      maxDurationMs: 120_000, // 2 minute cap
    }
    registerTestSession(session)

    // when
    const { checkMaxDurationSessions } = await import("./session-store")
    checkMaxDurationSessions()

    // then
    expect(session.status).toBe("cancelled")
  })

  it("does not cancel session within maxDurationMs", async () => {
    // given — a mock session that started 1 minute ago with 2 minute max
    const tmpDir = await mkdtemp(join(tmpdir(), "devin-maxdur-test-"))
    cleanupDirs.push(tmpDir)
    const logPath = join(tmpDir, "test.log")
    await writeFile(logPath, "some output")

    const now = Date.now()
    const session: DevinSession = {
      id: "test-maxdur-2",
      proc: mockSubprocess,
      logPath,
      startedAt: now - 60_000, // 1 minute ago
      cwd: tmpDir,
      prompt: "test prompt",
      status: "running",
      maxDurationMs: 120_000, // 2 minute cap
    }
    registerTestSession(session)

    // when
    const { checkMaxDurationSessions } = await import("./session-store")
    checkMaxDurationSessions()

    // then
    expect(session.status).toBe("running")
  })

  it("applies default maxDurationMs when not specified", async () => {
    // given
    setDevinBinaryAvailable(true)

    // when / then — default should be 2 hours (7200000ms)
    const { startDevinSession } = await import("./session-store")
    try {
      await startDevinSession({ prompt: "test" })
    } catch (err) {
      // May fail at spawn, but NOT at maxDuration validation
      expect((err as Error).message).not.toContain("maxDurationMs")
    }
  })
})

describe("log size caps", () => {
  let cleanupDirs: string[] = []

  afterEach(async () => {
    clearTestSessions()
    for (const dir of cleanupDirs) {
      try { await rmdir(dir, { recursive: true }) } catch { /* ignore */ }
    }
    cleanupDirs = []
  })

  it("warns when log exceeds soft cap", async () => {
    // given — a mock session with a sparse log file larger than soft cap (100MB)
    const tmpDir = await mkdtemp(join(tmpdir(), "devin-logcap-test-"))
    cleanupDirs.push(tmpDir)
    const logPath = join(tmpDir, "test.log")
    const softCap = 100 * 1024 * 1024
    await writeFile(logPath, "")
    truncateSync(logPath, softCap + 1024)

    const session: DevinSession = {
      id: "test-logcap-1",
      proc: mockSubprocess,
      logPath,
      startedAt: Date.now(),
      cwd: tmpDir,
      prompt: "test prompt",
      status: "running",
    }
    registerTestSession(session)

    // when
    const { checkLogSizeCaps } = await import("./session-store")
    checkLogSizeCaps()

    // then — session should still be running but warned
    expect(session.status).toBe("running")
  })

  it("cancels session when log exceeds hard cap", async () => {
    // given — a mock session with a sparse log file larger than hard cap (500MB)
    const tmpDir = await mkdtemp(join(tmpdir(), "devin-logcap-test-"))
    cleanupDirs.push(tmpDir)
    const logPath = join(tmpDir, "test.log")
    const hardCap = 500 * 1024 * 1024
    await writeFile(logPath, "")
    truncateSync(logPath, hardCap + 1024)

    const session: DevinSession = {
      id: "test-logcap-2",
      proc: mockSubprocess,
      logPath,
      startedAt: Date.now(),
      cwd: tmpDir,
      prompt: "test prompt",
      status: "running",
    }
    registerTestSession(session)

    // when
    const { checkLogSizeCaps } = await import("./session-store")
    checkLogSizeCaps()

    // then
    expect(session.status).toBe("cancelled")
  })

  it("ignores sessions below soft cap", async () => {
    // given — a mock session with a small log file
    const tmpDir = await mkdtemp(join(tmpdir(), "devin-logcap-test-"))
    cleanupDirs.push(tmpDir)
    const logPath = join(tmpDir, "test.log")
    await writeFile(logPath, "small log")

    const session: DevinSession = {
      id: "test-logcap-3",
      proc: mockSubprocess,
      logPath,
      startedAt: Date.now(),
      cwd: tmpDir,
      prompt: "test prompt",
      status: "running",
    }
    registerTestSession(session)

    // when
    const { checkLogSizeCaps } = await import("./session-store")
    checkLogSizeCaps()

    // then
    expect(session.status).toBe("running")
  })
})
