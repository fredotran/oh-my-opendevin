import { readdir, stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SessionMetaFile } from "../../mcp-servers/devin/types"
import { formatJsonOutput, formatTextOutput } from "./formatter"
import type { DevinReportOptions, DevinReportResult, DevinReportSession, DevinReportSummary } from "./types"

const MCP_LOG_DIR = join(tmpdir(), "oh-my-opencode-devin-mcp")

const TIER_MAP: Record<string, { tier: string; keyword: string }> = {
  "kimi-k2.6": { tier: "Standard", keyword: "omit model" },
  "swe-1-6": { tier: "Fast/Cheap", keyword: '"swe"' },
  "codex": { tier: "Code Gen", keyword: '"codex"' },
  "sonnet": { tier: "Balanced", keyword: '"sonnet"' },
  "opus": { tier: "Deep", keyword: '"opus"' },
}

function getTierInfo(model: string): { tier: string; keyword: string } {
  return TIER_MAP[model] ?? { tier: "Unknown", keyword: model }
}

async function getMcpSessions(): Promise<DevinReportSession[]> {
  const sessions: DevinReportSession[] = []
  if (!existsSync(MCP_LOG_DIR)) return sessions

  const entries = await readdir(MCP_LOG_DIR)
  const metaFiles = entries.filter((e) => e.endsWith(".meta.json")).sort()
  const processedIds = new Set<string>()

  for (const metaFile of metaFiles) {
    const metaPath = join(MCP_LOG_DIR, metaFile)
    try {
      const raw = await Bun.file(metaPath).text()
      const meta = JSON.parse(raw) as SessionMetaFile
      const sid = meta.id ?? metaFile.replace(".meta.json", "")
      processedIds.add(sid)

      const logPath = join(MCP_LOG_DIR, `${sid}.log`)
      let logSize = 0
      try {
        const st = await stat(logPath)
        logSize = st.size
      } catch {
        // Log file may not exist
      }

      const startIso = meta.startedAt
        ? new Date(meta.startedAt).toISOString()
        : null
      const endIso = meta.endedAt
        ? new Date(meta.endedAt).toISOString()
        : null

      const { tier, keyword } = getTierInfo(meta.model ?? "unknown")

      let durationSeconds: number | null = null
      if (meta.startedAt && meta.endedAt) {
        durationSeconds = Math.round((meta.endedAt - meta.startedAt) / 1000 * 10) / 10
      }

      const promptTruncated = (meta.prompt ?? "").length > 120
        ? (meta.prompt ?? "").slice(0, 120) + "..."
        : (meta.prompt ?? "")

      sessions.push({
        id: sid,
        model: meta.model ?? "unknown",
        status: meta.status ?? "unknown",
        prompt: promptTruncated,
        cwd: meta.cwd ?? "",
        command: meta.command ?? [],
        startTime: startIso,
        endTime: endIso,
        exitCode: meta.exitCode,
        source: "mcp",
        logSizeBytes: logSize,
        tier,
        keyword,
        durationSeconds,
      })
    } catch {
      // Skip unparseable meta files
    }
  }

  // Include legacy .log files without .meta.json
  const logFiles = entries.filter((e) => e.endsWith(".log")).sort()
  for (const logFile of logFiles) {
    const sid = logFile.replace(".log", "")
    if (processedIds.has(sid)) continue
    try {
      const logPath = join(MCP_LOG_DIR, logFile)
      const st = await stat(logPath)
      sessions.push({
        id: sid,
        model: "unknown",
        status: "unknown",
        prompt: "",
        cwd: "",
        command: [],
        startTime: new Date(st.ctimeMs).toISOString(),
        endTime: new Date(st.mtimeMs).toISOString(),
        exitCode: undefined,
        source: "mcp",
        logSizeBytes: st.size,
        tier: "Unknown",
        keyword: "unknown",
        durationSeconds: Math.round((st.mtimeMs - st.ctimeMs) / 1000 * 10) / 10,
      })
    } catch {
      // Skip unreadable log files
    }
  }

  return sessions
}

function buildSummary(sessions: DevinReportSession[]): DevinReportSummary {
  const bySource: Record<string, number> = {}
  const byStatus: Record<string, number> = {}
  const byTier: Record<string, { count: number; models: Set<string>; totalDuration: number }> = {}
  let totalDuration = 0

  for (const s of sessions) {
    bySource[s.source] = (bySource[s.source] ?? 0) + 1
    byStatus[s.status] = (byStatus[s.status] ?? 0) + 1

    if (!byTier[s.tier]) {
      byTier[s.tier] = { count: 0, models: new Set(), totalDuration: 0 }
    }
    byTier[s.tier].count++
    byTier[s.tier].models.add(s.model)
    if (s.durationSeconds) {
      byTier[s.tier].totalDuration += s.durationSeconds
      totalDuration += s.durationSeconds
    }
  }

  const byTierResult: DevinReportSummary["byTier"] = {}
  for (const [tier, info] of Object.entries(byTier).sort(([a], [b]) => a.localeCompare(b))) {
    byTierResult[tier] = {
      count: info.count,
      models: [...info.models].sort(),
      totalDurationSeconds: Math.round(info.totalDuration * 10) / 10,
      avgDurationSeconds: info.count > 0 ? Math.round((info.totalDuration / info.count) * 10) / 10 : 0,
    }
  }

  return {
    totalSessions: sessions.length,
    bySource,
    byStatus,
    byTier: byTierResult,
    totalDurationSeconds: Math.round(totalDuration * 10) / 10,
  }
}

export async function devinReport(options: DevinReportOptions): Promise<number> {
  let sessions = await getMcpSessions()

  if (options.tier) {
    sessions = sessions.filter((s) => s.tier.toLowerCase() === options.tier!.toLowerCase())
  }

  const summary = buildSummary(sessions)
  const result: DevinReportResult = { sessions, summary }

  const output = options.json
    ? formatJsonOutput(result)
    : formatTextOutput(result)

  process.stdout.write(`${output}\n`)
  return 0
}
