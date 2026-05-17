import type { WatchedSession } from "./types"

export type NotifierDeps = {
  sendSystemReminder?: (text: string) => void
  sendOsNotification?: (text: string) => void
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return `${minutes}m ${seconds}s`
}

function formatMessage(session: WatchedSession): string {
  const statusLine = session.exitCode !== undefined
    ? `${session.status} (exit ${session.exitCode})`
    : session.status
  const duration = session.endedAt && session.startedAt
    ? `Duration: ${formatDuration(session.endedAt - session.startedAt)}.`
    : ""
  const promptPreview = session.prompt.length > 80
    ? `${session.prompt.slice(0, 80)}...`
    : session.prompt
  return `Devin session "${session.id}" completed with status: ${statusLine}. ${duration} Prompt: "${promptPreview}"`
}

export function createDevinNotifier(deps: NotifierDeps) {
  return {
    notify(session: WatchedSession): void {
      const message = formatMessage(session)
      deps.sendSystemReminder?.(message)
      deps.sendOsNotification?.(message)
      session.notified = true
    },
  }
}
