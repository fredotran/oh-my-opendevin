# Devin MCP Server Reliability Pack — Design

**Date:** 2026-05-13
**Branch:** `feature/devin-mcp-reliability-pack`
**Parent branch:** `fredotran/dev`

## Context

After shipping the initial Devin MCP server (5 resilience features) and the model disclosure work, deeper review surfaced 8 additional gaps that affect day-to-day reliability:

1. Builtin `/devin` command template references models that no longer exist in `MODEL_TIER_MAP`.
2. Devin sessions can run forever — no max duration cap.
3. `devin_wait` schema says `timeout_ms: max(600000)` but the code hard-caps at `30000`. Agents waste calls passing 5-minute timeouts that silently downgrade to 30s.
4. MCP tool handlers have no `try/catch`. A corrupted log or disk error crashes the JSON-RPC call instead of returning a graceful error.
5. Log files grow unbounded. A 2-hour Docker build could produce a multi-GB `.log` that breaks `devin_status` tail reads.
6. No total concurrent session limit. Per-model slots exist but the absolute count is unbounded.
7. `.log` and `.meta.json` files accumulate in `/tmp/oh-my-opencode-devin-mcp/` forever. The in-memory reaper cleans the Map after 1 hour, but disk files survive.
8. `devin_status({ since_bytes })` still returns the full snapshot metadata (cwd, model, started_at, log_path, prompt). The agent already has these — they waste context window on every poll.

## Goals

- Each improvement is independently testable and rolls back cleanly.
- No breaking changes to existing tool schemas (all new params are optional).
- One commit per improvement for clean review.
- TDD throughout: failing test first, then implementation.
- All existing tests must continue to pass.

## Non-Goals

- No protocol-level changes to MCP.
- No new MCP tools (only enhance existing 6).
- No CLI / plugin changes beyond the `/devin` builtin command template.
- No changes to OpenCode plugin code.

---

## Improvement 1: Fix `/devin` builtin command model names

**Problem:** `templates/devin.ts` references `"claude-sonnet-4-6"`, `"gpt"`, `"gpt-5.5"` — none of which exist in `MODEL_TIER_MAP`. Agents following this template get "Unknown" tier classification.

**Solution:**
- Replace all unsupported names with: `swe`, `codex`, `sonnet`, `opus` (and omit-for-`kimi-k2.6`).
- Update model selection heuristics table to match the actual tier map.
- Update example response to use a valid model.

**Tests:** Snapshot test that asserts no unsupported model names appear in the template.

**Files changed:**
- `src/features/builtin-commands/templates/devin.ts`
- `src/features/builtin-commands/templates/devin.test.ts` (new)

---

## Improvement 2: Max duration cap on `devin_start`

**Problem:** A Devin session can run forever, burning subscription credits. There is no kill-switch independent of agent action.

**Solution:**
- Add optional `max_duration_ms` to `devin_start` input schema (range `60_000` to `14_400_000` — 1 min to 4 hours).
- On spawn, set a `setTimeout` that calls `killWithGracefulFallback` after the limit.
- Add new `DevinSessionStatus` value: `"timeout"`.
- Clear the timer when the process exits naturally.

**Tests:**
- Session with `max_duration_ms: 100` gets killed and marked `"timeout"` within 200ms.
- Session that exits naturally before the cap is NOT marked `"timeout"`.
- `max_duration_ms` omitted → no timer set, session can run indefinitely.

**Files changed:**
- `src/mcp-servers/devin/types.ts` (add `"timeout"` to status union)
- `src/mcp-servers/devin/session-store.ts` (timer logic in `startDevinSession`)
- `src/mcp-servers/devin/server.ts` (expose `max_duration_ms` param)
- `src/mcp-servers/devin/session-store.test.ts` (new tests)

---

## Improvement 3: Fix `devin_wait` timeout schema deception

**Problem:** Zod schema says `max: 600000` (10 min) but code hard-caps at `30000` (30 s). The schema is a lie; agents keep passing `timeout_ms: 300000` expecting 5-min blocks.

**Solution:**
- Change Zod schema from `.max(600000)` to `.max(30000)`.
- Update `.describe()` to make the cap unmistakable.
- Update default behavior unchanged (still 30s effective max).

**Tests:**
- Calling `devin_wait` with `timeout_ms: 60000` should now reject at schema validation (Zod throws).
- Calling with `timeout_ms: 30000` succeeds.
- Calling with no `timeout_ms` succeeds and uses default.

**Files changed:**
- `src/mcp-servers/devin/server.ts`

---

## Improvement 4: Error handling in MCP tool handlers

**Problem:** If `snapshotDevinSession` throws (corrupted log, permission denied, disk full), the MCP tool call crashes with an unhandled exception. The agent gets no useful error.

**Solution:**
- Add a `safeToolHandler(handler)` wrapper that:
  - Catches synchronous and async errors.
  - Returns `asTextResult("Error: <message>")` on failure.
  - Logs the full error to `console.error` for diagnostics.
- Apply to all 6 tool handlers: `devin_start`, `devin_status`, `devin_wait`, `devin_cancel`, `devin_cancel_batch`, `devin_list`.

**Tests:**
- `devin_status` for a session whose log file was deleted mid-flight returns a clean error message, not a thrown exception.
- `devin_cancel` for a session whose process is already gone returns a clean error message.

**Files changed:**
- `src/mcp-servers/devin/server.ts` (add wrapper + apply to all 6 handlers)
- `src/mcp-servers/devin/server.test.ts` (new — first server-level test file)

---

## Improvement 5: Log file size cap (soft + hard)

**Problem:** Logs grow unbounded. Multi-GB log files break `devin_status` tail reads and exhaust disk.

**Solution — TWO LAYERS:**

### Soft cap (read-side, 100 MB)
- When `snapshotDevinSession` reads a log > 100 MB, clamp the read start so we only ever read the last 100 MB.
- Add a banner to the output: `... [log file is N MB, showing last 100 MB only]`.

### Hard cap (write-side, 500 MB)
- Idle detector (already runs every 5 min) now also checks log size.
- When a session's log exceeds 500 MB:
  - Append a truncation marker line: `\n[TRUNCATED — log exceeded 500 MB, further output suppressed]\n`.
  - Close the file descriptor used by the spawned process (this is the tricky part — we may need to redirect stdout/stderr to `/dev/null` going forward).

**Simpler hard-cap approach (chosen):**
- Instead of redirecting fd at runtime (complex), the hard cap **kills the session** when exceeded and marks it `"error"` with a reason. Simpler, safer, gives the agent a clear signal.

**Tests:**
- Soft cap: 150 MB synthetic log → snapshot returns ≤ 100 MB + banner.
- Hard cap: stub a session whose log file is artificially > 500 MB → next idle check kills it and marks status `"error"`.

**Files changed:**
- `src/mcp-servers/devin/session-store.ts`
- `src/mcp-servers/devin/session-store.test.ts`

---

## Improvement 6: Total concurrent session limit

**Problem:** You can spawn unlimited sessions; per-model concurrency limits don't enforce a total.

**Solution:**
- New constant `MAX_CONCURRENT_SESSIONS = 10`.
- Override via `DEVIN_MCP_MAX_SESSIONS` env var (parsed at module load).
- In `startDevinSession`, before spawning, count `sessions` entries with `status === "running"`. If `>= MAX_CONCURRENT_SESSIONS`, throw with clear message: `Cannot start session — already at max concurrent sessions (N). Cancel some with devin_cancel_batch.`

**Tests:**
- Spawning at the limit throws the expected error.
- Cancelling a session frees a slot.
- Env var override is respected.

**Files changed:**
- `src/mcp-servers/devin/session-store.ts`
- `src/mcp-servers/devin/session-store.test.ts`

---

## Improvement 7: Disk cleanup for old log files

**Problem:** `.log` and `.meta.json` files in `/tmp/oh-my-opencode-devin-mcp/` are never deleted. Multi-week-old runs accumulate.

**Solution:**
- New `cleanupOldLogFiles()` that scans `LOG_DIR` and deletes pairs (`<id>.log` + `<id>.meta.json`) where the file mtime is > 7 days old.
- Runs:
  - Once at MCP server startup (after `reattachOrphanedSessions`).
  - Every 24 hours via a timer (`startDiskCleanupTimer`).
- Skips files whose `id` is currently in the in-memory `sessions` map.

**Tests:**
- Files older than 7 days get deleted.
- Files newer than 7 days survive.
- Files belonging to live in-memory sessions are NEVER deleted (regardless of mtime).

**Files changed:**
- `src/mcp-servers/devin/session-store.ts`
- `src/mcp-servers/devin/server.ts` (wire up startup call)
- `src/mcp-servers/devin/session-store.test.ts`

---

## Improvement 8: Lightweight incremental `devin_status` response

**Problem:** Every `since_bytes` poll returns the full snapshot metadata (cwd, model, prompt, log_path, started_at, etc.). Wastes context window.

**Solution:**
- When `since_bytes` is provided, return a minimal response:
  ```
  session_id: <id>
  status: <status>[ (exit <N>)]
  output_bytes: <N>
  new_output_bytes: <delta>
  --- new output ---
  <text>
  ```
- When `since_bytes` is omitted (first call or full snapshot request), keep the existing full `renderSnapshot()` output.

**Tests:**
- `devin_status({ session_id, since_bytes: 100 })` response does NOT contain `cwd`, `model`, `prompt`, `started_at`, `log_path`.
- `devin_status({ session_id })` (no `since_bytes`) response still contains all of those.

**Files changed:**
- `src/mcp-servers/devin/server.ts`

---

## Branch + commit plan

1. **Setup:** `git checkout -b feature/devin-mcp-reliability-pack` (already done)
2. **Spec commit:** This design doc → `docs(superpowers): add devin-mcp-reliability-pack design`
3. **One commit per improvement** (8 total), each with: failing test → implementation → verify
4. **Final verification commit:** any docs touch-ups + DEVIN-FEATURES.md update
5. **Push:** `git push origin feature/devin-mcp-reliability-pack`

## Verification before claiming done

For each improvement:
- ✅ `npx tsc --noEmit` (typecheck clean)
- ✅ Co-located test file has a new test that demonstrates the fix (TDD red → green)
- ✅ Full devin test suite passes: `bun test src/mcp-servers/devin src/cli/devin-report src/features/builtin-skills src/features/builtin-commands`

After all 8:
- ✅ `npm run build` succeeds (all bundles + schema)
- ✅ Smoke test: MCP server `initialize` + `tools/list` + one round-trip
- ✅ No regression in existing 55-test suite
