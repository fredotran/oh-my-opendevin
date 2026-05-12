export type DevinReportOptions = {
  json: boolean
  tier?: string
}

export type DevinReportSession = {
  id: string
  model: string
  status: string
  prompt: string
  cwd: string
  command: string[]
  startTime: string | null
  endTime: string | null
  exitCode: number | undefined
  source: "mcp" | "cli"
  logSizeBytes: number
  tier: string
  keyword: string
  durationSeconds: number | null
}

export type DevinReportSummary = {
  totalSessions: number
  bySource: Record<string, number>
  byStatus: Record<string, number>
  byTier: Record<string, {
    count: number
    models: string[]
    totalDurationSeconds: number
    avgDurationSeconds: number
  }>
  totalDurationSeconds: number
}

export type DevinReportResult = {
  sessions: DevinReportSession[]
  summary: DevinReportSummary
}
