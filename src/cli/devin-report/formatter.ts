import type { DevinReportResult, DevinReportSession } from "./types"

function formatLogSize(bytes: number): string {
  if (bytes > 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${bytes}B`
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "N/A"
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return `${mins}m ${secs}s`
}

export function formatJsonOutput(result: DevinReportResult): string {
  return JSON.stringify(result, null, 2)
}

export function formatTextOutput(result: DevinReportResult): string {
  const { sessions, summary } = result
  const lines: string[] = []

  lines.push("=".repeat(90))
  lines.push("  DEVIN CLI SESSION REPORT")
  lines.push("=".repeat(90))
  lines.push("")

  // Summary
  lines.push("  SUMMARY")
  lines.push("  " + "-".repeat(86))
  lines.push(`  Total sessions:     ${summary.totalSessions}`)
  for (const [source, count] of Object.entries(summary.bySource).sort()) {
    lines.push(`  Source: ${source.padEnd(10)} ${count}`)
  }
  lines.push(`  Total wall time:    ${formatDuration(summary.totalDurationSeconds)}`)
  lines.push("")

  // By Status
  if (Object.keys(summary.byStatus).length > 0) {
    lines.push("  BY STATUS")
    lines.push("  " + "-".repeat(86))
    const maxCount = Math.max(...Object.values(summary.byStatus))
    for (const [status, count] of Object.entries(summary.byStatus).sort()) {
      const barLen = maxCount > 0 ? Math.round((count / maxCount) * 20) : 0
      const bar = "#".repeat(barLen) + ".".repeat(20 - barLen)
      lines.push(`  ${status.padEnd(12)} ${bar} ${count}`)
    }
    lines.push("")
  }

  // By Tier
  if (Object.keys(summary.byTier).length > 0) {
    lines.push("  BY TIER")
    lines.push("  " + "-".repeat(86))
    lines.push(`  ${"Tier".padEnd(14)} ${"Count".padStart(6)} ${"Models".padEnd(30)} ${"Total Time".padStart(12)} ${"Avg Time".padStart(10)}`)
    lines.push(`  ${"-".repeat(14)} ${"-".repeat(6)} ${"-".repeat(30)} ${"-".repeat(12)} ${"-".repeat(10)}`)
    for (const [tier, info] of Object.entries(summary.byTier)) {
      const modelsStr = info.models.join(", ").slice(0, 28)
      lines.push(
        `  ${tier.padEnd(14)} ${String(info.count).padStart(6)} ${modelsStr.padEnd(30)} ${formatDuration(info.totalDurationSeconds).padStart(12)} ${formatDuration(info.avgDurationSeconds).padStart(10)}`,
      )
    }
    lines.push("")
  }

  // Session Details
  if (sessions.length > 0) {
    lines.push("  SESSION DETAILS")
    lines.push("  " + "-".repeat(86))
    lines.push(
      `  ${"ID".padEnd(28)} ${"Source".padEnd(6)} ${"Tier".padEnd(12)} ${"Model".padEnd(12)} ${"Status".padEnd(10)} ${"Duration".padStart(10)} ${"Log Size".padStart(10)}`,
    )
    lines.push(
      `  ${"-".repeat(28)} ${"-".repeat(6)} ${"-".repeat(12)} ${"-".repeat(12)} ${"-".repeat(10)} ${"-".repeat(10)} ${"-".repeat(10)}`,
    )

    for (const s of sessions) {
      lines.push(
        `  ${s.id.slice(0, 28).padEnd(28)} ${s.source.padEnd(6)} ${s.tier.padEnd(12)} ${s.model.slice(0, 11).padEnd(12)} ${s.status.padEnd(10)} ${formatDuration(s.durationSeconds).padStart(10)} ${formatLogSize(s.logSizeBytes).padStart(10)}`,
      )
    }
    lines.push("")

    lines.push("  PROMPTS & COMMANDS")
    lines.push("  " + "-".repeat(86))
    for (const s of sessions) {
      lines.push(`  [${s.source}] ${s.tier} | ${s.status} | ${s.id.slice(0, 20)}...`)
      if (s.model && s.model !== "unknown") lines.push(`    Model: ${s.model}`)
      if (s.cwd) lines.push(`    CWD:   ${s.cwd}`)
      if (s.command.length > 0) {
        const cmdStr = s.command.join(" ")
        lines.push(`    Spawn: ${cmdStr.length > 80 ? cmdStr.slice(0, 77) + "..." : cmdStr}`)
      }
      if (s.prompt) {
        const flat = s.prompt.replace(/\n/g, " ").trim()
        lines.push(`    Task:  ${flat}`)
      }
      if (s.exitCode !== undefined) lines.push(`    Exit:  ${s.exitCode}`)
      lines.push("")
    }
  } else {
    lines.push("  No sessions found.")
    lines.push("")
  }

  lines.push("=".repeat(90))
  return lines.join("\n")
}
