# src/mcp-servers/ — Standalone stdio MCP Servers

Standalone MCP servers shipped inside this repo and registered as **Tier 2** (Claude Code `.mcp.json`) — distinct from `src/mcp/` (Tier 1: remote HTTP only) and skill-embedded servers (Tier 3, per-session).

Each subdirectory is a self-contained stdio server that can be spawned by any MCP client (OpenCode, Claude Code, Devin CLI itself, etc.).

## Servers

| Server | Dir | Tools | Wrapped CLI |
|--------|-----|-------|-------------|
| **devin** | `devin/` | `devin_start`, `devin_status`, `devin_wait`, `devin_cancel`, `devin_cancel_batch`, `devin_list`, `devin_health`, `devin_resumable` | [`devin`](https://cli.devin.ai/docs) — runs background Devin sessions via `devin -p` |

## Conventions

- Entry point: `<server>/index.ts` exports the factory + auto-runs when invoked directly (`import.meta.main`).
- Server factory: `createXxxMcpServer(): McpServer` using `@modelcontextprotocol/sdk`.
- Background subprocesses: log stdout/stderr to a file under `os.tmpdir()/oh-my-opencode-<server>-mcp/` and expose status/tail-output tools.
- Run with: `bun run src/mcp-servers/<server>/index.ts` (or the `mcp:<server>` package.json script).
- Registered at project root via `.mcp.json` so the Claude Code MCP loader picks it up automatically.

## devin/ — Devin CLI wrapper

Wraps the `devin` CLI binary as a background-session MCP server. The OpenCode/oh-my-openagent agent can:

1. `devin_start({prompt, model?, cwd?, permission_mode?, resume?, maxDurationMs?, autoFallback?})` → spawns `devin -p <prompt>` detached, returns `session_id`
   - `maxDurationMs` (default: 2h, min: 1m) — auto-cancels the session if it exceeds this duration
   - `autoFallback` (default: false) — on `QUOTA_EXCEEDED`, automatically retries with the next model in the fallback chain
2. `devin_status({session_id, tail_bytes?, since_bytes?})` → polls log file + process state
   - `since_bytes` returns ONLY new output since the last poll (use after first call)
3. `devin_wait({session_id, timeout_ms?, tail_bytes?})` → blocks until exit (or timeout)
   - `timeout_ms` hard-capped at 30000ms per call to avoid MCP client timeouts
4. `devin_cancel({session_id})` → SIGKILL the subprocess
5. `devin_cancel_batch({session_ids})` → cancel up to 50 sessions in one call
6. `devin_list({include_output?})` → enumerate all sessions managed by this server instance
7. `devin_health()` → check binary availability, disk usage, slot usage, orphaned count
8. `devin_resumable({limit?})` → list completed/error sessions on disk eligible for resume

Sessions live in memory (`session-store.ts` — `Map<id, DevinSession>`); logs and `.meta.json` persist on disk. On restart, sessions left as `"running"` in `.meta.json` are re-attached as `"orphaned"` (read-only, logs accessible).

### Resilience features

- **Re-attachment:** On startup, `reattachOrphanedSessions()` scans `LOG_DIR` for `.meta.json` with `status: "running"` and registers them as `"orphaned"`.
- **Pre-flight validation:** `devin_start` checks the `devin` binary is in PATH (cached), catches model typos via Levenshtein distance, validates `cwd` is a directory, and validates `maxDurationMs` (min 1m).
- **TTL reaper:** Completed/errored/cancelled/orphaned sessions are removed from memory after 1 hour (logs remain on disk).
- **Idle detection:** Running sessions with no output growth for 30 minutes are marked `"stalled"` (not auto-cancelled).
- **Max duration enforcement:** Sessions exceeding `maxDurationMs` are auto-cancelled. Default: 2 hours, minimum: 1 minute.
- **Log size caps:** Warns when a session log exceeds 100MB; auto-cancels at 500MB to prevent disk exhaustion.
- **Disk cleanup:** On each spawn, old log files (> 24h) are deleted, with protection for files belonging to in-memory active sessions.
- **Structured error hints:** When `devin_start` fails due to rate limits, quota exhaustion, or context window overflow, the response includes a tagged error (`RATE_LIMIT`, `QUOTA_EXCEEDED`, `CONTEXT_LIMIT`, `UNKNOWN`) with a suggested recovery action.
- **Model fallback chain:** `opus` → `sonnet` → `kimi-k2.6` → `swe-1.6`. When a model quota is exceeded, agents can retry with the next tier. When the chain is exhausted, `getFallbackModel` loops back to the default model `kimi-k2.6` for a safety-net retry, then `swe-1.6` again before giving up. `autoFallback` can automate this.
- **Tool error wrapping:** All MCP tool handlers are wrapped with `safeToolHandler()` so unexpected errors are caught and returned as text results instead of propagating as unhandled exceptions.
- **Concurrent session limit:** Maximum 50 running sessions enforced at spawn time.
- **Model disclosure:** `devin_start` response includes resolved tier and model. Agents are instructed to tell the user which model is running their task.
- **Tier mapping single source of truth:** `tiers.ts` exports `MODEL_TIER_MAP`, `resolveTierLabel()`, `resolveTierInfo()`, `FALLBACK_CHAIN`, `getFallbackModel()`, `KNOWN_DEVIN_MODELS`, and `TIER_COST_MAP`. Both the MCP server (`devin_start` response) and the CLI (`devin-report`) consume this module so tier labels and cost estimates stay consistent. Both tier keywords (`"swe"`, `"codex"`, `"sonnet"`, `"opus"`) and fully-qualified IDs (`"swe-1.6"`, etc.) resolve to the same tier.
- **Cost estimation:** `devin-report` multiplies session duration by `TIER_COST_MAP` rates to produce directional USD spend estimates per session and per tier.
- **Session statuses:** `running`, `completed`, `error`, `cancelled`, `orphaned`, `stalled`.

### Agent guidance

The `devin-cli` built-in skill ([`src/features/builtin-skills/skills/devin-cli.ts`](../features/builtin-skills/skills/devin-cli.ts)) tells agents when and how to delegate to Devin. The skill is auto-loaded by `createBuiltinSkills()`; disable via `disabled_skills: ["devin-cli"]` in your oh-my-openagent config if you don't want agents to delegate.

### User-facing slash commands

Built-in commands ([`src/features/builtin-commands/templates/devin.ts`](../features/builtin-commands/templates/devin.ts)) give the user direct entry points:

| Command | Purpose |
|---------|---------|
| `/devin-status [<id-prefix>] [--full]` | List running sessions (or render full output for a specific id) |
| `/devin-cancel [<id-prefix>] [--all]` | Cancel one session (prefix match) or every running session |

`/devin` and `/devin-models` were removed in commit `24f3d51c` — delegation now goes through the agent skill layer (the `devin-cli` built-in skill is auto-loaded into the model context). Disable any remaining command via `disabled_commands: ["devin-status", ...]` in oh-my-openagent config.

### Smoke test

```bash
( printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"x","version":"0"}}}' \
            '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
            '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
) | bun run src/mcp-servers/devin/index.ts
```
