import { mkdir, stat, readdir, unlink } from "node:fs/promises"
import { existsSync, openSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import type { DevinSession, DevinSessionSnapshot } from "./types"

const LOG_DIR = join(tmpdir(), "oh-my-opencode-devin-mcp")
const TAIL_BYTES_DEFAULT = 8192
const TAIL_BYTES_MAX = 262144
const MAX_CONCURRENT_SESSIONS = 50
const DEFAULT_MODEL_CONCURRENCY = 5
const LOG_RETENTION_MS = 24 * 60 * 60 * 1000 // 24 hours
const KILL_GRACE_PERIOD_MS = 5000
const DEFAULT_DEVIN_MODEL = "kimi-k2.6"

const sessions = new Map<string, DevinSession>()

// Per-model concurrency tracking (mirrors BackgroundManager pattern)
const modelRunningCounts = new Map<string, number>()
const modelPendingQueues = new Map<string, Array<{ resolve: () => void; reject: (err: Error) => void }>>()

function getModelConcurrencyLimit(_model: string | undefined): number {
  // Future: read from config. For now, use default.
  return DEFAULT_MODEL_CONCURRENCY
}

function getRunningCount(model: string | undefined): number {
  return modelRunningCounts.get(model ?? "__default") ?? 0
}

function incrementRunning(model: string | undefined): void {
  const key = model ?? "__default"
  modelRunningCounts.set(key, (modelRunningCounts.get(key) ?? 0) + 1)
}

function decrementRunning(model: string | undefined): void {
  const key = model ?? "__default"
  const current = (modelRunningCounts.get(key) ?? 0) - 1
  if (current <= 0) {
    modelRunningCounts.delete(key)
  } else {
    modelRunningCounts.set(key, current)
  }
}

async function acquireModelSlot(model: string | undefined): Promise<void> {
  const limit = getModelConcurrencyLimit(model)
  if (getRunningCount(model) < limit) {
    incrementRunning(model)
    return
  }
  return new Promise<void>((resolve, reject) => {
    const key = model ?? "__default"
    const queue = modelPendingQueues.get(key) ?? []
    queue.push({ resolve, reject })
    modelPendingQueues.set(key, queue)
  })
}

function releaseModelSlot(model: string | undefined): void {
  decrementRunning(model)
  const key = model ?? "__default"
  const queue = modelPendingQueues.get(key)
  if (queue && queue.length > 0) {
    const next = queue.shift()!
    incrementRunning(model)
    next.resolve()
  }
  if (queue && queue.length === 0) {
    modelPendingQueues.delete(key)
  }
}

function cancelModelWaiters(model: string | undefined): void {
  const key = model ?? "__default"
  const queue = modelPendingQueues.get(key)
  if (queue) {
    for (const entry of queue) {
      entry.reject(new Error("Session cancelled before starting"))
    }
    modelPendingQueues.delete(key)
  }
}

// Cache for log snapshot output to avoid re-reading unchanged files.
// Key: `${sessionId}:${fileSize}:${fileMtimeMs}`
const snapshotCache = new Map<string, { output: string; outputBytes: number }>()

export type StartOptions = {
  prompt: string
  cwd?: string
  model?: string
  resume?: string
  permissionMode?: "auto" | "dangerous"
  extraArgs?: string[]
}

// Allowed Devin CLI arguments to prevent arbitrary flag injection
const ALLOWED_EXTRA_ARG_PREFIXES = ["--env", "--no-", "--yes", "--wait"]

function validateModel(model: string | undefined): void {
  if (!model) return
  // Devin model IDs are alphanumeric with hyphens and dots
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(model)) {
    throw new Error(`Invalid model identifier: ${model}`)
  }
}

function validateResumeId(resumeId: string | undefined): void {
  if (!resumeId) return
  // Resume IDs are UUIDs or alphanumeric session identifiers
  if (!/^[a-zA-Z0-9_-]+$/.test(resumeId) || resumeId.length > 128) {
    throw new Error(`Invalid resume identifier: ${resumeId}`)
  }
}

function validateExtraArgs(extraArgs: string[] | undefined): string[] {
  if (!extraArgs?.length) return []
  const validated: string[] = []
  for (const arg of extraArgs) {
    // Reject args that look like path injection attempts
    if (arg.includes("../") || arg.includes("..\\") || arg.startsWith("/") || arg.startsWith("\\")) {
      throw new Error(`Invalid extra argument (path injection attempt): ${arg}`)
    }
    // Only allow known-safe prefixes or simple key=value pairs
    const isAllowed = ALLOWED_EXTRA_ARG_PREFIXES.some((prefix) => arg.startsWith(prefix)) ||
      /^--[a-z][a-z0-9-]+(=.+)?$/.test(arg)
    if (!isAllowed) {
      throw new Error(`Disallowed extra argument: ${arg}. Only allowlisted flags are permitted.`)
    }
    validated.push(arg)
  }
  return validated
}

function validateCwd(cwd: string | undefined): string {
  const resolved = cwd ?? process.cwd()
  if (!existsSync(resolved)) {
    throw new Error(`Working directory does not exist: ${resolved}`)
  }
  return resolved
}

async function cleanupOldLogs(): Promise<void> {
  try {
    const entries = await readdir(LOG_DIR)
    const now = Date.now()
    for (const entry of entries) {
      if (!entry.endsWith(".log")) continue
      const logPath = join(LOG_DIR, entry)
      try {
        const st = await stat(logPath)
        if (now - st.mtimeMs > LOG_RETENTION_MS) {
          await unlink(logPath)
        }
      } catch {
        // Ignore per-file errors during cleanup
      }
    }
  } catch {
    // Directory may not exist yet
  }
}

function enforceSessionLimit(): void {
  const runningCount = [...sessions.values()].filter((s) => s.status === "running").length
  if (runningCount >= MAX_CONCURRENT_SESSIONS) {
    throw new Error(
      `Maximum concurrent Devin sessions (${MAX_CONCURRENT_SESSIONS}) reached. ` +
        `Cancel existing sessions before creating new ones.`,
    )
  }
}

export async function startDevinSession(options: StartOptions): Promise<DevinSession> {
  enforceSessionLimit()

  // Resolve model: explicit > default
  const resolvedModel = options.model ?? DEFAULT_DEVIN_MODEL

  // Validate all user inputs before spawning
  validateModel(resolvedModel)
  validateResumeId(options.resume)
  const validatedExtraArgs = validateExtraArgs(options.extraArgs)
  const resolvedCwd = validateCwd(options.cwd)

  // Wait for a per-model concurrency slot (mirrors BackgroundManager)
  await acquireModelSlot(resolvedModel)

  await mkdir(LOG_DIR, { recursive: true })
  await cleanupOldLogs()

  const id = randomUUID()
  const logPath = join(LOG_DIR, `${id}.log`)
  const fd = openSync(logPath, "a")

  const args: string[] = []
  if (options.resume) {
    args.push("-r", options.resume)
  }
  args.push("-p", options.prompt)
  args.push("--permission-mode", options.permissionMode ?? "dangerous")
  args.push("--model", resolvedModel)
  if (validatedExtraArgs.length) args.push(...validatedExtraArgs)

  const proc = Bun.spawn(["devin", ...args], {
    cwd: resolvedCwd,
    stdout: fd,
    stderr: fd,
    stdin: "ignore",
  })

  const session: DevinSession = {
    id,
    proc,
    logPath,
    startedAt: Date.now(),
    cwd: resolvedCwd,
    prompt: options.prompt,
    model: resolvedModel,
    status: "running",
    resumeId: options.resume,
  }

  sessions.set(id, session)

  proc.exited
    .then((exitCode) => {
      session.exitCode = exitCode
      session.endedAt = Date.now()
      session.status = exitCode === 0 ? "completed" : session.status === "cancelled" ? "cancelled" : "error"
      releaseModelSlot(session.model)
    })
    .catch((err) => {
      session.endedAt = Date.now()
      session.status = "error"
      console.error(`[devin-mcp] Session ${id} process error:`, err)
      releaseModelSlot(session.model)
    })

  return session
}

export function getDevinSession(id: string): DevinSession | undefined {
  return sessions.get(id)
}

export function listDevinSessions(): DevinSession[] {
  return [...sessions.values()].sort((a, b) => b.startedAt - a.startedAt)
}

export async function snapshotDevinSession(
  session: DevinSession,
  tailBytes = TAIL_BYTES_DEFAULT,
): Promise<DevinSessionSnapshot> {
  const limit = Math.max(0, Math.min(tailBytes, TAIL_BYTES_MAX))
  let output = ""
  let outputBytes = 0
  if (existsSync(session.logPath)) {
    const st = await stat(session.logPath)
    outputBytes = st.size
    if (limit > 0) {
      const cacheKey = `${session.id}:${outputBytes}:${st.mtimeMs}:${limit}`
      const cached = snapshotCache.get(cacheKey)
      if (cached) {
        output = cached.output
      } else {
        const start = Math.max(0, outputBytes - limit)
        const file = Bun.file(session.logPath)
        const slice = file.slice(start, outputBytes)
        output = await slice.text()
        if (start > 0) output = `... [${start} earlier bytes truncated]\n` + output
        snapshotCache.set(cacheKey, { output, outputBytes })
      }
    }
  }
  const endedAt = session.endedAt ?? Date.now()
  return {
    id: session.id,
    logPath: session.logPath,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    cwd: session.cwd,
    prompt: session.prompt,
    model: session.model,
    status: session.status,
    exitCode: session.exitCode,
    resumeId: session.resumeId,
    output,
    outputBytes,
    durationMs: endedAt - session.startedAt,
    running: session.status === "running",
  }
}

async function killWithGracefulFallback(proc: DevinSession["proc"], sessionId: string): Promise<void> {
  try {
    proc.kill("SIGTERM")
  } catch (err) {
    console.error(`[devin-mcp] Failed to send SIGTERM to session ${sessionId}:`, err)
  }

  // Wait for graceful shutdown with timeout, then SIGKILL
  const graceTimeout = new Promise<void>((resolve) => {
    const timeoutId = setTimeout(() => {
      try {
        proc.kill("SIGKILL")
      } catch (err) {
        console.error(`[devin-mcp] Failed to send SIGKILL to session ${sessionId}:`, err)
      }
      resolve()
    }, KILL_GRACE_PERIOD_MS)

    proc.exited
      .then(() => {
        clearTimeout(timeoutId)
        resolve()
      })
      .catch(() => {
        clearTimeout(timeoutId)
        resolve()
      })
  })

  await graceTimeout
}

function clearSnapshotCacheForSession(sessionId: string): void {
  for (const key of snapshotCache.keys()) {
    if (key.startsWith(`${sessionId}:`)) {
      snapshotCache.delete(key)
    }
  }
}

export async function cancelDevinSession(id: string): Promise<DevinSession | undefined> {
  const session = sessions.get(id)
  if (!session) return undefined
  clearSnapshotCacheForSession(id)
  if (session.status === "running") {
    session.status = "cancelled"
    await killWithGracefulFallback(session.proc, id)
    releaseModelSlot(session.model)
  }
  return session
}

export type CancelBatchResult = {
  cancelled: string[]
  unknown: string[]
  errors: { id: string; error: string }[]
}

export async function cancelDevinSessions(ids: string[]): Promise<CancelBatchResult> {
  const result: CancelBatchResult = { cancelled: [], unknown: [], errors: [] }
  await Promise.all(
    ids.map(async (id) => {
      try {
        const session = await cancelDevinSession(id)
        if (session) {
          result.cancelled.push(id)
        } else {
          result.unknown.push(id)
        }
      } catch (err) {
        result.errors.push({ id, error: err instanceof Error ? err.message : String(err) })
      }
    }),
  )
  return result
}

export async function readSessionLog(id: string, tailBytes = TAIL_BYTES_DEFAULT): Promise<string> {
  const session = sessions.get(id)
  if (!session) throw new Error(`unknown devin session: ${id}`)
  const snap = await snapshotDevinSession(session, tailBytes)
  return snap.output
}

export async function readSessionLogSince(id: string, sinceBytes: number): Promise<string> {
  const session = sessions.get(id)
  if (!session) throw new Error(`unknown devin session: ${id}`)
  if (!existsSync(session.logPath)) return ""
  const st = await stat(session.logPath)
  const totalBytes = st.size
  if (sinceBytes >= totalBytes) return ""
  const file = Bun.file(session.logPath)
  const slice = file.slice(sinceBytes, totalBytes)
  return slice.text()
}

export async function shutdownAllSessions(): Promise<void> {
  snapshotCache.clear()
  // Cancel all queued sessions waiting for a slot
  for (const key of modelPendingQueues.keys()) {
    cancelModelWaiters(key === "__default" ? undefined : key)
  }
  const pending: Promise<unknown>[] = []
  for (const session of sessions.values()) {
    if (session.status === "running") {
      session.status = "cancelled"
      pending.push(killWithGracefulFallback(session.proc, session.id))
    }
  }
  await Promise.all(pending)
}

// @allow — test-only helper to inject mock sessions without spawning processes
export function registerTestSession(session: DevinSession): void {
  sessions.set(session.id, session)
}

// @allow — test-only helper to clear all sessions and cache
export function clearTestSessions(): void {
  sessions.clear()
  snapshotCache.clear()
  modelRunningCounts.clear()
  for (const key of modelPendingQueues.keys()) {
    cancelModelWaiters(key === "__default" ? undefined : key)
  }
}
