import { readdirSync } from "fs"
import { join } from "path"
import { readMetaFile } from "./meta-reader"
import { createDevinNotifier } from "./notifier"
import type { DevinWatcherConfig, WatchedSession } from "./types"

export type WatcherDeps = DevinWatcherConfig & {
  logDir: string
  sendSystemReminder?: (text: string) => void
  sendOsNotification?: (text: string) => void
}

export class DevinSessionWatcher {
  private knownSessions = new Map<string, WatchedSession>()
  private intervalId: ReturnType<typeof setInterval> | null = null
  private notifier: ReturnType<typeof createDevinNotifier>

  constructor(private deps: WatcherDeps) {
    this.notifier = createDevinNotifier({
      sendSystemReminder: deps.sendSystemReminder,
      sendOsNotification: deps.sendOsNotification,
    })
  }

  start(): void {
    if (!this.deps.enabled) return
    this.scan()
    this.intervalId = setInterval(() => this.scan(), this.deps.pollIntervalMs)
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  private scan(): void {
    try {
      const files = readdirSync(this.deps.logDir).filter((f) => f.endsWith(".meta.json"))
      for (const file of files) {
        const meta = readMetaFile(join(this.deps.logDir, file))
        if (!meta) continue
        this.handleMeta(meta)
      }
    } catch {
      // LOG_DIR may not exist yet — silently skip
    }
  }

  private handleMeta(meta: { id: string; status: string; exitCode?: number; endedAt?: number; prompt: string; model: string; cwd: string }): void {
    const known = this.knownSessions.get(meta.id)
    const isTerminal = meta.status === "completed" || meta.status === "error" || meta.status === "cancelled"

    if (!known) {
      this.knownSessions.set(meta.id, {
        id: meta.id,
        status: meta.status as WatchedSession["status"],
        exitCode: meta.exitCode,
        endedAt: meta.endedAt,
        prompt: meta.prompt,
        model: meta.model,
        cwd: meta.cwd,
        notified: false,
      })
      return
    }

    if (known.status === "running" && isTerminal && !known.notified) {
      known.status = meta.status as WatchedSession["status"]
      known.exitCode = meta.exitCode
      known.endedAt = meta.endedAt
      this.notifier.notify(known)
    }
  }
}
