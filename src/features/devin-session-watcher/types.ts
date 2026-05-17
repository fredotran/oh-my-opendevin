export type DevinSessionStatus = "running" | "completed" | "error" | "cancelled" | "orphaned" | "stalled"

export type WatchedSession = {
  id: string
  status: DevinSessionStatus
  exitCode?: number
  endedAt?: number
  startedAt?: number
  prompt: string
  model: string
  cwd: string
  notified: boolean
}

export type DevinWatcherConfig = {
  enabled: boolean
  pollIntervalMs: number
  osNotifications: boolean
  systemReminders: boolean
}

export type DevinMetaJson = {
  id: string
  status: DevinSessionStatus
  exitCode?: number
  endedAt?: number
  startedAt?: number
  prompt: string
  model: string
  cwd: string
}
