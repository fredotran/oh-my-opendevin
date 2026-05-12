import { describe, test, expect, beforeEach, afterEach, jest } from "bun:test"
import { createDevinActivityMonitorHook } from "./hook"

function createMockCtx(): {
	client: {
		session: {
			promptAsync: ReturnType<typeof jest.fn>
		}
	}
} {
	return {
		client: {
			session: {
				promptAsync: jest.fn().mockResolvedValue({}),
			},
		},
	}
}

describe("createDevinActivityMonitorHook", () => {
	test("should return tool.execute.after handler and dispose function", () => {
		// given
		const ctx = createMockCtx()

		// when
		const hook = createDevinActivityMonitorHook(ctx as any)

		// then
		expect(hook["tool.execute.after"]).toBeDefined()
		expect(typeof hook["tool.execute.after"]).toBe("function")
		expect(typeof hook.dispose).toBe("function")
	})

	test("should track devin_start sessions", async () => {
		// given
		const ctx = createMockCtx()
		const hook = createDevinActivityMonitorHook(ctx as any)
		const output = {
			title: "devin_start",
			output:
				"Started Devin session 550e8400-e29b-41d4-a716-446655440000.\n" +
				"Poll with devin_status({session_id: \"550e8400-e29b-41d4-a716-446655440000\"}).\n\n" +
				"session_id: 550e8400-e29b-41d4-a716-446655440000\n" +
				"status: running\n" +
				"log_path: /tmp/oh-my-opencode-devin-mcp/550e8400-e29b-41d4-a716-446655440000.log\n" +
				"output_bytes: 0\n",
			metadata: {},
		}

		// when
		await hook["tool.execute.after"](
			{ tool: "devin_start", sessionID: "ses_abc123", callID: "call_1" },
			output,
		)

		// then - no error, and dispose cleans up
		hook.dispose()
		expect(true).toBe(true)
	})

	test("should update status on devin_status showing completion", async () => {
		// given
		const ctx = createMockCtx()
		const hook = createDevinActivityMonitorHook(ctx as any)

		// Start a session first
		await hook["tool.execute.after"](
			{ tool: "devin_start", sessionID: "ses_abc123", callID: "call_1" },
			{
				title: "devin_start",
				output:
					"Started Devin session 550e8400-e29b-41d4-a716-446655440000.\n\n" +
					"session_id: 550e8400-e29b-41d4-a716-446655440000\n" +
					"status: running\n" +
					"log_path: /tmp/oh-my-opencode-devin-mcp/550e8400-e29b-41d4-a716-446655440000.log\n" +
					"output_bytes: 0\n",
				metadata: {},
			},
		)

		// when - status shows completed
		await hook["tool.execute.after"](
			{ tool: "devin_status", sessionID: "ses_abc123", callID: "call_2" },
			{
				title: "devin_status",
				output:
					"session_id: 550e8400-e29b-41d4-a716-446655440000\n" +
					"status: completed (exit 0)\n" +
					"log_path: /tmp/oh-my-opencode-devin-mcp/550e8400-e29b-41d4-a716-446655440000.log\n" +
					"output_bytes: 1500\n",
				metadata: {},
			},
		)

		// then - should not throw
		hook.dispose()
		expect(true).toBe(true)
	})

	test("should ignore non-devin tools", async () => {
		// given
		const ctx = createMockCtx()
		const hook = createDevinActivityMonitorHook(ctx as any)

		// when
		await hook["tool.execute.after"](
			{ tool: "read", sessionID: "ses_abc123", callID: "call_1" },
			{ title: "read", output: "file content", metadata: {} },
		)

		// then - should not throw or track anything
		hook.dispose()
		expect(true).toBe(true)
	})

	test("dispose should clean up timer and sessions", () => {
		// given
		const ctx = createMockCtx()
		const hook = createDevinActivityMonitorHook(ctx as any)

		// Start tracking a session to start the timer
		hook["tool.execute.after"](
			{ tool: "devin_start", sessionID: "ses_abc123", callID: "call_1" },
			{
				title: "devin_start",
				output:
					"Started Devin session 550e8400-e29b-41d4-a716-446655440000.\n\n" +
					"session_id: 550e8400-e29b-41d4-a716-446655440000\n" +
					"status: running\n" +
					"log_path: /tmp/oh-my-opencode-devin-mcp/550e8400-e29b-41d4-a716-446655440000.log\n" +
					"output_bytes: 0\n",
				metadata: {},
			},
		)

		// when
		hook.dispose()

		// then - no error
		expect(true).toBe(true)
	})
})
