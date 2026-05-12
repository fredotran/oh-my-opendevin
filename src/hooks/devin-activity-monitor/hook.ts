import type { PluginInput } from "@opencode-ai/plugin"
import { stat } from "node:fs/promises"
import { log } from "../../shared/logger"
import { createInternalAgentTextPart } from "../../shared/internal-initiator-marker"

const LOG_DIR = "/tmp/oh-my-opencode-devin-mcp"
const POLL_INTERVAL_MS = 5000
const MIN_INJECTION_INTERVAL_MS = 5000
const MAX_OUTPUT_CHARS_PER_INJECTION = 2000
const SESSION_INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

interface TrackedSession {
	sessionId: string
	parentSessionId: string
	logPath: string
	lastReadBytes: number
	lastInjectedAt: number
	status: "running" | "completed" | "error" | "cancelled"
}

const trackedSessions = new Map<string, TrackedSession>()

function stripAnsiCodes(str: string): string {
	// eslint-disable-next-line no-control-regex
	return str.replace(/\x1b\[[0-9;]*m/g, "")
}

function extractSessionId(text: string): string | undefined {
	const match = text.match(/session_id:\s*([a-f0-9-]{36})/i)
	return match?.[1]
}

function extractLogPath(text: string): string | undefined {
	const match = text.match(/log_path:\s*(.+)/)
	return match?.[1]?.trim()
}

function extractStatus(text: string): string | undefined {
	const match = text.match(/status:\s*(\w+)/)
	return match?.[1]
}

function extractOutputBytes(text: string): number | undefined {
	const match = text.match(/output_bytes:\s*(\d+)/)
	return match ? parseInt(match[1], 10) : undefined
}

async function readNewLogContent(
	logPath: string,
	fromByte: number,
): Promise<{ content: string; newSize: number }> {
	try {
		const st = await stat(logPath)
		const size = st.size
		if (size <= fromByte) {
			return { content: "", newSize: size }
		}
		const file = Bun.file(logPath)
		const slice = file.slice(fromByte, size)
		let text = await slice.text()
		text = stripAnsiCodes(text)
		// Only take the last N chars if too large
		if (text.length > MAX_OUTPUT_CHARS_PER_INJECTION) {
			text = "...[truncated]\n" + text.slice(-MAX_OUTPUT_CHARS_PER_INJECTION)
		}
		return { content: text, newSize: size }
	} catch (err) {
		log("[devin-activity-monitor] Failed to read log:", err)
		return { content: "", newSize: fromByte }
	}
}

export function createDevinActivityMonitorHook(ctx: PluginInput) {
	let intervalId: ReturnType<typeof setInterval> | null = null

	async function injectUpdate(session: TrackedSession, content: string): Promise<void> {
		if (!content.trim()) return

		const now = Date.now()
		if (now - session.lastInjectedAt < MIN_INJECTION_INTERVAL_MS) {
			return
		}

		try {
			await ctx.client.session.promptAsync({
				path: { id: session.parentSessionId },
				body: {
					noReply: true,
					parts: [
						createInternalAgentTextPart(
							`<system-reminder>\n` +
								`[Devin activity] session ${session.sessionId.slice(0, 8)}\u2026\n` +
								"\`\`\`\n" +
								content +
								"\n\`\`\`\n" +
								`</system-reminder>`,
						),
					],
				},
			})
			session.lastInjectedAt = now
		} catch (err) {
			log("[devin-activity-monitor] Failed to inject update:", err)
		}
	}

	function startPolling(): void {
		if (intervalId !== null) return

		intervalId = setInterval(async () => {
			const now = Date.now()
			const sessionsToRemove: string[] = []

			for (const [sessionId, session] of trackedSessions) {
				// Clean up old/inactive sessions
				if (
					session.status !== "running" ||
					now - session.lastInjectedAt > SESSION_INACTIVITY_TIMEOUT_MS
				) {
					sessionsToRemove.push(sessionId)
					continue
				}

				const { content, newSize } = await readNewLogContent(session.logPath, session.lastReadBytes)
				if (content.trim()) {
					session.lastReadBytes = newSize
					await injectUpdate(session, content)
				}
			}

			for (const id of sessionsToRemove) {
				trackedSessions.delete(id)
			}

			// Stop the interval if no sessions are being tracked
			if (trackedSessions.size === 0 && intervalId !== null) {
				clearInterval(intervalId)
				intervalId = null
			}
		}, POLL_INTERVAL_MS)
	}

	const toolExecuteAfter = async (
		input: { tool: string; sessionID: string; callID: string },
		output: { title: string; output: string; metadata: unknown },
	) => {
		if (!input.tool.startsWith("devin_")) return

		const text = output.output
		if (!text) return

		const sessionId = extractSessionId(text)
		if (!sessionId) return

		const logPath = extractLogPath(text) || `${LOG_DIR}/${sessionId}.log`
		const status = extractStatus(text)
		const outputBytes = extractOutputBytes(text)

		const existing = trackedSessions.get(sessionId)

		if (input.tool === "devin_start") {
			// New session started
			trackedSessions.set(sessionId, {
				sessionId,
				parentSessionId: input.sessionID,
				logPath,
				lastReadBytes: outputBytes ?? 0,
				lastInjectedAt: Date.now(),
				status: "running",
			})
			startPolling()
			return
		}

		if (input.tool === "devin_status" || input.tool === "devin_wait") {
			if (!existing) return

			existing.logPath = logPath
			// Sync read position so the timer doesn't re-inject what the agent just saw
			if (outputBytes !== undefined) {
				existing.lastReadBytes = Math.max(existing.lastReadBytes, outputBytes)
			}
			existing.lastInjectedAt = Date.now()

			if (status === "completed" || status === "error" || status === "cancelled") {
				existing.status = status as TrackedSession["status"]
			}
			return
		}

		if (input.tool === "devin_cancel") {
			if (existing) {
				existing.status = "cancelled"
			}
		}
	}

	const dispose = () => {
		if (intervalId !== null) {
			clearInterval(intervalId)
			intervalId = null
		}
		trackedSessions.clear()
	}

	return {
		"tool.execute.after": toolExecuteAfter,
		dispose,
	}
}
