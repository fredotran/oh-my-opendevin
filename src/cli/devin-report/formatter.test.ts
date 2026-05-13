import { describe, expect, it } from "bun:test"
import { formatJsonOutput, formatTextOutput } from "./formatter"
import type { DevinReportResult, DevinReportSession } from "./types"

function createTestSession(overrides: Partial<DevinReportSession> = {}): DevinReportSession {
  return {
    id: "test-session-1234",
    model: "sonnet",
    status: "completed",
    prompt: "fix the bug in index.ts",
    cwd: "/home/user/project",
    command: ["devin", "-p", "fix the bug in index.ts", "--model", "sonnet"],
    startTime: "2026-05-13T00:00:00.000Z",
    endTime: "2026-05-13T00:05:00.000Z",
    exitCode: 0,
    source: "mcp",
    logSizeBytes: 2048,
    tier: "Balanced",
    keyword: '"sonnet"',
    durationSeconds: 300,
    estimatedCostUSD: 1.5,
    ...overrides,
  }
}

function createTestResult(sessions: DevinReportSession[] = []): DevinReportResult {
  if (sessions.length === 0) {
    sessions = [createTestSession()]
  }
  return {
    sessions,
    summary: {
      totalSessions: sessions.length,
      bySource: { mcp: sessions.length },
      byStatus: { completed: sessions.length },
      byTier: {
        Balanced: {
          count: sessions.length,
          models: ["sonnet"],
          totalDurationSeconds: 300,
          avgDurationSeconds: 300,
          estimatedCostUSD: 1.5,
        },
      },
      totalDurationSeconds: 300,
      totalEstimatedCostUSD: 1.5,
    },
  }
}

describe("devin-report formatter", () => {
  describe("#given formatJsonOutput", () => {
    it("returns valid JSON", () => {
      // given
      const result = createTestResult()

      // when
      const output = formatJsonOutput(result)

      // then
      expect(() => JSON.parse(output)).not.toThrow()
      const parsed = JSON.parse(output)
      expect(parsed.sessions).toHaveLength(1)
      expect(parsed.summary.totalSessions).toBe(1)
    })
  })

  describe("#given formatTextOutput", () => {
    it("includes header and summary", () => {
      // given
      const result = createTestResult()

      // when
      const output = formatTextOutput(result)

      // then
      expect(output).toContain("DEVIN CLI SESSION REPORT")
      expect(output).toContain("SUMMARY")
      expect(output).toContain("Total sessions:")
    })

    it("shows session details with model and tier", () => {
      // given
      const result = createTestResult()

      // when
      const output = formatTextOutput(result)

      // then
      expect(output).toContain("SESSION DETAILS")
      expect(output).toContain("sonnet")
      expect(output).toContain("Balanced")
    })

    it("shows prompts and commands section", () => {
      // given
      const result = createTestResult()

      // when
      const output = formatTextOutput(result)

      // then
      expect(output).toContain("PROMPTS & COMMANDS")
      expect(output).toContain("fix the bug in index.ts")
    })

    it("displays 'No sessions found' when empty", () => {
      // given
      const result: DevinReportResult = {
        sessions: [],
        summary: {
          totalSessions: 0,
          bySource: {},
          byStatus: {},
          byTier: {},
          totalDurationSeconds: 0,
          totalEstimatedCostUSD: 0,
        },
      }

      // when
      const output = formatTextOutput(result)

      // then
      expect(output).toContain("No sessions found")
    })

    it("shows tier breakdown with cost estimates", () => {
      // given
      const sessions = [
        createTestSession({ tier: "Deep", model: "opus", estimatedCostUSD: 4.5 }),
        createTestSession({ id: "test-2", tier: "Standard", model: "kimi-k2.6", estimatedCostUSD: 0.9 }),
      ]
      const result: DevinReportResult = {
        sessions,
        summary: {
          totalSessions: 2,
          bySource: { mcp: 2 },
          byStatus: { completed: 2 },
          byTier: {
            Deep: { count: 1, models: ["opus"], totalDurationSeconds: 300, avgDurationSeconds: 300, estimatedCostUSD: 4.5 },
            Standard: { count: 1, models: ["kimi-k2.6"], totalDurationSeconds: 300, avgDurationSeconds: 300, estimatedCostUSD: 0.9 },
          },
          totalDurationSeconds: 600,
          totalEstimatedCostUSD: 5.4,
        },
      }

      // when
      const output = formatTextOutput(result)

      // then
      expect(output).toContain("BY TIER")
      expect(output).toContain("Deep")
      expect(output).toContain("Standard")
      expect(output).toContain("Est Cost")
      expect(output).toContain("Total est cost")
    })
  })
})
