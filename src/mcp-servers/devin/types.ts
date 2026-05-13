import type { Subprocess } from "bun"

export type DevinSessionStatus = "running" | "completed" | "error" | "cancelled" | "orphaned" | "stalled"

export type DevinSession = {
  id: string
  proc: Subprocess
  logPath: string
  startedAt: number
  endedAt?: number
  cwd: string
  prompt: string
  model?: string
  status: DevinSessionStatus
  exitCode?: number
  resumeId?: string
  /** Tracked by idle detector: last known log file size in bytes */
  lastOutputBytes?: number
  /** Tracked by idle detector: timestamp when output last grew */
  lastOutputAt?: number
  /** Maximum allowed duration in ms before auto-cancellation */
  maxDurationMs?: number
}

export type DevinSessionSnapshot = Omit<DevinSession, "proc"> & {
  output: string
  outputBytes: number
  durationMs: number
  running: boolean
}

/** Metadata persisted to .meta.json alongside session log files */
export type SessionMetaFile = {
  id: string
  model?: string
  prompt: string
  cwd: string
  command: string[]
  startedAt: number
  status: string
  endedAt?: number
  exitCode?: number
}
