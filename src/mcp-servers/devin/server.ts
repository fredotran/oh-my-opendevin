import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import {
  cancelDevinSession,
  cancelDevinSessions,
  getDevinSession,
  listDevinSessions,
  readSessionLogSince,
  reattachOrphanedSessions,
  snapshotDevinSession,
  shutdownAllSessions,
  startDevinSession,
} from "./session-store"
import { resolveTierLabel } from "./tiers"
import type { DevinSessionSnapshot } from "./types"

const SERVER_NAME = "devin"
const SERVER_VERSION = "0.1.0"

function renderSnapshot(snap: DevinSessionSnapshot): string {
  const lines = [
    `session_id: ${snap.id}`,
    `status: ${snap.status}` + (snap.exitCode !== undefined ? ` (exit ${snap.exitCode})` : ""),
    `cwd: ${snap.cwd}`,
    snap.model ? `model: ${snap.model}` : null,
    snap.resumeId ? `resume_of: ${snap.resumeId}` : null,
    `started_at: ${new Date(snap.startedAt).toISOString()}`,
    snap.endedAt ? `ended_at: ${new Date(snap.endedAt).toISOString()}` : null,
    `duration_ms: ${snap.durationMs}`,
    `log_path: ${snap.logPath}`,
    `output_bytes: ${snap.outputBytes}`,
    "",
    "--- output (tail) ---",
    snap.output || "(no output yet)",
  ].filter((line): line is string => line !== null)
  return lines.join("\n")
}

function asTextResult(text: string) {
  return { content: [{ type: "text" as const, text }] }
}

export function createDevinMcpServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })

  server.registerTool(
    "devin_start",
    {
      description:
        "Start a background Devin CLI session running `devin -p <prompt>`. Returns a session_id you can poll with devin_status. RECOMMENDATION: always pass `cwd` explicitly; if omitted, the session uses the MCP server's startup directory.",
      inputSchema: {
        prompt: z.string().min(1).describe("Prompt to send to Devin."),
        cwd: z.string().optional().describe("Working directory. Defaults to the MCP server's startup directory. Pass explicitly to avoid ambiguity when sessions fork."),
        model: z
          .string()
          .optional()
          .describe('Devin model (e.g. "sonnet", "opus", "codex"). Defaults to "kimi-k2.6".'),
        permission_mode: z.enum(["auto", "dangerous"]).optional().describe("Devin --permission-mode (default: dangerous — bypasses all permission prompts)."),
        resume: z.string().optional().describe("Resume an existing Devin session by id (passes -r)."),
      },
    },
    async ({ prompt, cwd, model, permission_mode, resume }) => {
      const session = await startDevinSession({
        prompt,
        cwd,
        model,
        permissionMode: permission_mode,
        resume,
      })
      const snap = await snapshotDevinSession(session, 0)
      const tierLabel = resolveTierLabel(session.model)
      return asTextResult(
        `Started Devin session ${session.id} (tier: ${tierLabel}, model: ${session.model ?? "kimi-k2.6"}).\n` +
        `Poll with devin_status({session_id: "${session.id}"}).\n\n` +
          renderSnapshot(snap),
      )
    },
  )

  server.registerTool(
    "devin_status",
    {
      description:
        "Get current status and output of a background Devin session. CRITICAL: after the first call, ALWAYS use `since_bytes` (not `tail_bytes`) for incremental reads to avoid re-fetching the same output and wasting context window. The response includes `output_bytes` — save it and pass as `since_bytes` on the next poll.",
      inputSchema: {
        session_id: z.string().describe("Session id returned by devin_start."),
        tail_bytes: z
          .number()
          .int()
          .min(0)
          .max(262144)
          .optional()
          .describe("How many bytes of trailing output to return (default 8192, max 262144). USE ONLY for the first status check or when the user asks for 'full output'. For all repeated polling, use since_bytes instead."),
        since_bytes: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Return ONLY new output written after this byte offset. Use the `output_bytes` field from the PREVIOUS devin_status or devin_wait response. This avoids redundant data transfer and context bloat."),
      },
    },
    async ({ session_id, tail_bytes, since_bytes }) => {
      const session = getDevinSession(session_id)
      if (!session) return asTextResult(`unknown session_id: ${session_id}`)
      if (since_bytes !== undefined) {
        const newOutput = await readSessionLogSince(session_id, since_bytes)
        const snap = await snapshotDevinSession(session, 0)
        return asTextResult(
          `session_id: ${snap.id}\n` +
          `status: ${snap.status}` + (snap.exitCode !== undefined ? ` (exit ${snap.exitCode})` : "") + "\n" +
          `output_bytes: ${snap.outputBytes}\n` +
          `new_output_bytes: ${newOutput.length}\n\n` +
          "--- new output ---\n" +
          (newOutput || "(no new output)")
        )
      }
      const snap = await snapshotDevinSession(session, tail_bytes ?? 8192)
      return asTextResult(renderSnapshot(snap))
    },
  )

  server.registerTool(
    "devin_wait",
    {
      description:
        "Block until a background Devin session finishes. Returns the final snapshot if the session exits, or a 'still running' status with polling guidance if it does not. The actual wait is capped at 30 seconds per call to avoid MCP client timeouts — if the session is still running after 30s, call devin_status with since_bytes for incremental polling, or call devin_wait again.",
      inputSchema: {
        session_id: z.string().describe("Session id returned by devin_start."),
        timeout_ms: z
          .number()
          .int()
          .min(1000)
          .max(600000)
          .optional()
          .describe("Target max wait in ms (default 60000, max 600000). The tool returns after 30s if the session is still running, to avoid MCP-level timeouts. You can call devin_wait again or switch to devin_status with since_bytes."),
        tail_bytes: z.number().int().min(0).max(262144).optional(),
      },
    },
    async ({ session_id, timeout_ms, tail_bytes }) => {
      const session = getDevinSession(session_id)
      if (!session) return asTextResult(`unknown session_id: ${session_id}`)
      const requestedLimit = timeout_ms ?? 60000
      // Cap actual blocking to 30s to avoid MCP client timeout (-32001).
      // The agent can call devin_wait again or switch to devin_status.
      const actualLimit = Math.min(requestedLimit, 30000)
      const startWait = Date.now()
      const timer = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), actualLimit))
      const result = await Promise.race([session.proc.exited.then(() => "exited" as const), timer])
      const elapsed = Date.now() - startWait
      const snap = await snapshotDevinSession(session, tail_bytes ?? 8192)

      if (result === "timeout") {
        return asTextResult(
          `Session ${session_id} is still running after ${elapsed}ms (capped at ${actualLimit}ms per call to avoid MCP timeout).\n\n` +
          `NEXT STEPS — choose one:\n` +
          `  1. Poll incrementally: devin_status({ session_id: "${session_id}", since_bytes: ${snap.outputBytes} })\n` +
          `  2. Wait again: devin_wait({ session_id: "${session_id}", timeout_ms: ${requestedLimit} })\n` +
          `  3. Cancel: devin_cancel({ session_id: "${session_id}" })\n\n` +
          `Current snapshot:\n` +
          renderSnapshot(snap),
        )
      }

      return asTextResult(`Session ${session_id} exited.\n\n` + renderSnapshot(snap))
    },
  )

  server.registerTool(
    "devin_cancel",
    {
      description: "Cancel a running background Devin session by killing its process.",
      inputSchema: {
        session_id: z.string().describe("Session id returned by devin_start."),
      },
    },
    async ({ session_id }) => {
      const session = await cancelDevinSession(session_id)
      if (!session) return asTextResult(`unknown session_id: ${session_id}`)
      const snap = await snapshotDevinSession(session, 0)
      return asTextResult(`Cancelled.\n\n` + renderSnapshot(snap))
    },
  )

  server.registerTool(
    "devin_cancel_batch",
    {
      description:
        "Cancel multiple background Devin sessions in a single call. More efficient than calling devin_cancel repeatedly.",
      inputSchema: {
        session_ids: z
          .array(z.string())
          .min(1)
          .max(50)
          .describe("Array of session ids to cancel (max 50)."),
      },
    },
    async ({ session_ids }) => {
      const result = await cancelDevinSessions(session_ids)
      const lines: string[] = []
      if (result.cancelled.length > 0) {
        lines.push(`Cancelled: ${result.cancelled.join(", ")}`)
      }
      if (result.unknown.length > 0) {
        lines.push(`Unknown session_ids: ${result.unknown.join(", ")}`)
      }
      if (result.errors.length > 0) {
        lines.push(
          `Errors:\n${result.errors.map((e) => `  - ${e.id}: ${e.error}`).join("\n")}`,
        )
      }
      return asTextResult(lines.join("\n") || "No sessions to cancel.")
    },
  )

  server.registerTool(
    "devin_list",
    {
      description: "List all background Devin sessions managed by this MCP server in the current process.",
      inputSchema: {
        include_output: z
          .boolean()
          .optional()
          .describe("If true, include the last 256 bytes of each session's output."),
      },
    },
    async ({ include_output }) => {
      const sessions = listDevinSessions()
      if (sessions.length === 0) return asTextResult("(no sessions)")
      const parts = await Promise.all(
        sessions.map(async (session) => {
          const snap = await snapshotDevinSession(session, include_output ? 256 : 0)
          const head =
            `- ${snap.id}  [${snap.status}]  duration=${snap.durationMs}ms  prompt=${JSON.stringify(snap.prompt.slice(0, 80))}`
          return include_output ? `${head}\n  tail: ${snap.output.replace(/\n/g, " ").slice(0, 256)}` : head
        }),
      )
      return asTextResult(parts.join("\n"))
    },
  )

  return server
}

export async function runDevinMcpServer(): Promise<void> {
  // Re-attach any sessions left behind by a previous server instance
  await reattachOrphanedSessions()

  const server = createDevinMcpServer()
  const transport = new StdioServerTransport()
  const cleanup = () => {
    void shutdownAllSessions().finally(() => process.exit(0))
  }
  process.on("SIGINT", cleanup)
  process.on("SIGTERM", cleanup)
  await server.connect(transport)
}
