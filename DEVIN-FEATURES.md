# Oh My Opendevin — Fork-Specific Features

**Generated:** 2026-05-13  
**Fork branch:** `fredotran/dev`  
**Upstream:** `dev`  
**Since commit:** `7d09d2c8` (last upstream merge before fork divergence)  
**Last updated:** `fbabacc3`

This document tracks all features, fixes, and architectural changes added in the `oh-my-opendevin` fork that are not present in the upstream `oh-my-openagent` project.

---

## Table of Contents

1. [Devin CLI Integration](#devin-cli-integration)
2. [Devin Agent](#devin-agent)
3. [Model System](#model-system)
4. [Installation & Distribution](#installation--distribution)
5. [Developer Experience](#developer-experience)
6. [Performance Optimizations](#performance-optimizations)
7. [Resilience & Maintainability](#resilience--maintainability)
   - [Session Re-attachment](#session-re-attachment-on-mcp-server-restart)
   - [Pre-flight Validation](#pre-flight-validation-in-devin_start)
   - [Auto-cleanup](#auto-cleanup-of-completed-sessions-ttl-reaper)
   - [Idle Detection](#idle-session-detection)
   - [Max Duration Cap](#max-duration-cap-on-devin_start)
   - [Log Size Caps](#log-file-size-caps)
   - [Structured Error Hints](#structured-error-hints--model-fallback-chain)
   - [Tool Error Wrapping](#tool-error-wrapping)
   - [CLI Reporter](#cli-session-reporter-devin-report-subcommand)
   - [devin_wait Timeout Fix](#devin_wait-mcp-timeout-fix--incremental-polling-guidance)
   - [Model Disclosure](#model-disclosure-to-user)
   - [Startup Toast Fix](#startup-toast-shows-correct-default-agent)
   - [Parent Process Crash Detection](#parent-process-crash-detection-stdin-eof-handler)
   - [Very Long Task Guidance](#very-long-task-guidance-docker-builds)
   - [Ultrawork Safeguard](#ultrawork-safeguard)

---

## Devin CLI Integration

### Devin CLI MCP Server
- **Commit:** `bff58671` (initial), `413d70d0` (security hardening), `bfd6dd24` (global MCP config), `446aa60d` (Claude Code compat)
- **Files:** `src/mcp-servers/devin/`
- **What:** Standalone stdio MCP server wrapping the `devin` CLI binary. Spawns background `devin -p <prompt>` sessions and exposes 6 tools:
  - `devin_start` — spawn background Devin session
  - `devin_status` — poll status + log tail
  - `devin_wait` — block until exit/timeout
  - `devin_cancel` — kill single session
  - `devin_cancel_batch` — kill up to 50 sessions in one call (see `f91eb037`)
  - `devin_list` — enumerate managed sessions
- **Why:** Lets OpenCode agents delegate work to the Devin CLI sandbox, enabling parallel execution and model tier selection.

### Devin CLI Built-in Skill
- **Commit:** `b1b91003` (initial), `0f02158e` (model guidance), `8d5e1a37` (tier docs), `f91eb037` (incremental polling)
- **Files:** `src/features/builtin-skills/skills/devin-cli.ts`
- **What:** Agent-facing skill documenting when and how to delegate to Devin CLI. Includes model selection framework, prompt-writing rules, anti-patterns, and incremental polling guidance.

### Devin CLI Slash Commands
- **Commit:** `b28fe863` (added), `24f3d51c` (removed /devin and /devin-models)
- **Files:** `src/features/builtin-commands/templates/devin.ts`
- **What:** User-facing `/devin`, `/devin-status`, `/devin-cancel`, `/devin-models` commands. The `/devin` and `/devin-models` commands were later removed (`24f3d51c`) to reduce surface area; delegation now happens through the agent skill layer.

### MCP Server CWD Anchoring
- **Commit:** `28e345cc`
- **Files:** `src/mcp-servers/devin/session-store.ts`
- **What:** Captures the working directory at module load time (`MCP_HOME_DIR = process.cwd()`) so that session fork / session roaming does not drift the default cwd. Agents are instructed to always pass `cwd` explicitly in `devin_start` calls. Prevents subtle path resolution bugs when the MCP server outlives the originating session.

### Tiered Model Routing System
- **Commit:** `b6b17f87` (UI), `8b098ff1` (docs), `870bfa41` (README docs), `7eb7a9d5` (model name fix), `9e22df98` (diagram alignment)
- **What:** Explicit keyword-based tier selection when delegating to Devin CLI. The agent picks a tier based on task complexity; the MCP server resolves the keyword to the actual Devin model:

| Tier | Keyword | Resolved Model | Use Case |
|------|---------|---------------|----------|
| **Standard** | omit `model` | `kimi-k2.6` | Most tasks — good balance of capability and cost |
| **Fast/Cheap** | `"swe"` | `swe-1.6` | Simple edits, typos, single-file fixes |
| **Code Gen** | `"codex"` | `codex` | Boilerplate, CRUD, test scaffolding |
| **Balanced** | `"sonnet"` | `sonnet` | Moderate complexity, general purpose |
| **Deep** | `"opus"` | `opus` | Architecture refactors, multi-file, complex debugging |

- **Agent prompt** (`src/agents/devin.ts`): Includes tier table + selection heuristics (default to standard, reserve `opus` for complex tasks, etc.).
- **Built-in skill** (`src/features/builtin-skills/skills/devin-cli.ts`): Documents tier workflow, table, heuristics, and examples.
- **MCP server** (`src/mcp-servers/devin/server.ts`): `devin_start` schema accepts `model` parameter with description `"sonnet", "opus", "codex"`; defaults to `kimi-k2.6`.
- **Session store** (`src/mcp-servers/devin/session-store.ts`): `DEFAULT_DEVIN_MODEL = "kimi-k2.6"`; `options.model ?? DEFAULT_DEVIN_MODEL` resolves before spawning.
- **Note:** The original auto-classification (`classifyDevinModel`) was removed in favor of this explicit keyword system — agents choose the tier directly, which is more predictable and debuggable.

### How Model Selection Works in Practice
- **The agent decides, not the system.** There is no automatic task-to-model mapping. The agent running in your OpenCode session reads your request, assesses complexity, and picks a tier. Examples from the skill:
  - "Fix typo on line 42" → Standard (omit `model`) or Fast (`"swe"`)
  - "Refactor auth module across 15 files" → Deep (`"opus"`)
  - "Generate unit tests for all service methods" → Code Gen (`"codex"`)
  - "Update README with deployment steps" → Standard or Balanced (`"sonnet"`)
- If the agent does NOT specify a `model` parameter in `devin_start`, the MCP server defaults to `kimi-k2.6` (Standard tier).

### Actual Command Line Spawned
- **Files:** `src/mcp-servers/devin/session-store.ts`
- The MCP server spawns the `devin` binary directly via `Bun.spawn(["devin", ...args])`:
  ```bash
  devin \
    -p "<prompt text>" \
    --permission-mode dangerous \
    --model <resolvedModel> \
    [ -r <resume_id> ]    # only if resuming an existing session
  ```
- **Requirements:**
  - The `devin` CLI binary must be in your PATH
  - `--permission-mode dangerous` is the default (bypasses all Devin permission prompts)
  - `--model` accepts both keywords (`"opus"`, `"sonnet"`, `"swe"`, `"codex"`) and fully-qualified IDs (`"swe-1.6"`)
  - Working directory (`cwd`) defaults to the MCP server's startup directory if not passed explicitly

---

## Devin Agent

### Devin as Built-in Primary Agent
- **Commit:** `60d1a235` (registered), `352b7fac` (promoted to primary default)
- **Files:** `src/agents/devin.ts`, `src/agents/builtin-agents.ts`
- **What:** New agent that handles user requests via direct local tools OR delegates to Devin CLI sandbox. Never calls specialist agents (Sisyphus, Hephaestus, etc.).
- **Key constraints:**
  - Runs on free/cheap OpenCode models (deepseek-v4-flash, minimax-m2.5-free, etc.)
  - Uses `task()` and `call_omo_agent()` only for direct Devin CLI delegation
  - Falls back to free model chain on provider errors

### Agent Hardening
- **Commit:** `82e56f88`
- **What:** Enforces Devin never delegates to specialist agents. Prompt includes explicit "What You NEVER Do" section with anti-patterns for `task()` and `call_omo_agent()` misuse.

### Permission Mode Default
- **Commit:** `32a0a391`
- **What:** Devin CLI sessions default to `permission_mode: "dangerous"` — always bypasses permission prompts. Users can opt-in to `"auto"` for interactive approval.

---

## Model System

### Free Model Fallback Chain
- **Commit:** `8e4e017e` (configured), `eedd14cc` (restricted to free), `8d1c3ff4` (broadened providers), `fa0217d8` (validated IDs)
- **What:** Devin agent uses a fallback chain of free/cheap models instead of premium ones:
  - `deepseek-v4-flash` → `minimax-m2.5-free` → `big-pickle` → `nemotron-3-super-120b-a12b:free`
- **Why:** Reduces cost while maintaining capability for routine tasks.

### Model Name Corrections
- **Commit:** `92faf2d1` (deepseek-v4-flash), `60b0c757` (nemotron), `0367a0cf` (auto-prefix provider)
- **What:** Fixed invalid model IDs in fallback chain and added auto-prefixing for bare model names in config overrides.

### Default Devin CLI Model
- **Commit:** `e5bdb26a`
- **What:** Default Devin CLI model changed from `swe-1.6` to `kimi-k2.6` for better capability/cost balance.

---

## Installation & Distribution

### Package Rename
- **Commit:** `f3c402b5` (unscoped), `b19ce813` (oh-my-opendevin identity), `f2139460` (version toast)
- **What:** Renamed from scoped `@fredotran/oh-my-opencode` to unscoped `oh-my-opendevin` for easier installation.

### Global Installation Script
- **Commit:** `005871f2` (initial), `7fe9801b` (symlink fallback), `853ede47` (shell auto-detect)
- **Files:** `install-global.sh`, `INSTALL-GLOBAL.md`
- **What:** Bash script for one-line global installation:
  - Detects platform (darwin/linux, AVX2/baseline)
  - Installs platform-specific binary
  - Configures MCP server in `~/.claude/.mcp.json`
  - Auto-detects shell rc and sources PATH changes
  - Backup/restore config for clean uninstall

### Local Development Installation
- **Commit:** `5869eee6` (added), `65c56f7f` (removed), `1cfcf683` (doctor fix)
- **What:** Temporary local dev install script (later removed in favor of global installer).

### Local Symlink Fix (Plugin Loading)
- **Commit:** `72347a36`
- **Files:** `install-global.sh`
- **What:** Fixed the local-install symlink path in `install-global.sh`. The script was symlinking `$(pwd)/dist` instead of `$(pwd)`, which broke Node.js module resolution (`package.json` was missing from the package directory). This caused the plugin to fail silently on load, hiding all fork-specific agents (including the **devin** agent) from OpenCode.
- **Also fixed:**
  - Added `devin` to `AGENT_DISPLAY_NAMES` so the agent is properly remapped to its display name.
  - Added `devin-cli` to `BuiltinSkillNameSchema` so `disabled_skills: ["devin-cli"]` validates correctly.
  - Added sibling-package detection (`src/shared/external-plugin-detector.ts`) that warns when both `oh-my-opencode` and `oh-my-opendevin` are loaded, preventing agent shadowing.

---

## Developer Experience

### Session Resume Hints
- **Commit:** `abadf8ca`
- **What:** Shows session resume hint in `oh-my-opencode run` output on interrupt and completion, reminding users they can resume with `-r`.

### Agent Overrides Schema
- **Commit:** `9ce4fa4a`
- **What:** Added `devin` to `AgentOverridesSchema` so users can customize Devin agent config.

### Devin CLI Test Reporter
- **Commit:** `82c0d34f` (script added)
- **Files:** `scripts/devin-test-reporter.py`
- **What:** Standalone Python script (`uv run`) that retrieves and summarizes all Devin CLI sessions (direct CLI + MCP-spawned) to verify tiered model routing and session outcomes.
- **Features:**
  - Scans `devin list --format json` for CLI sessions (id, title/prompt, cwd, last activity)
  - Scans `/tmp/oh-my-opencode-devin-mcp/` for MCP session logs (output size, timestamps)
  - Aggregates by source (CLI vs MCP), status, and tier (when model is inferable)
  - Shows per-session details with prompt summaries and working directories
  - JSON output mode (`--json`) for CI integration
  - Tier filter mode (`--tier <tier>`) for focused verification
- **Limitation:** Neither the Devin CLI nor the MCP server persists the resolved model to disk. To verify which model was actually used, run the reporter WHILE sessions are active via MCP `devin_list` / `devin_status` tools, or enhance the MCP server to write `.meta.json` alongside `.log` files.

### README Fork Documentation
- **Commit:** `efa50caf` (fork features), `5ceab6c0` (reorganization), `021e31d2` (installation guide), `c1ffce7e` (removed aliases), `8b098ff1` (tag-team architecture), `870bfa41` (tiered routing), `9e22df98` (diagram alignment)
- **What:** Comprehensive fork-specific README with installation, Devin x Sisyphus tag-team architecture, model tier documentation, and corrected ASCII architecture diagram alignment.

---

## Performance Optimizations

### Log Snapshot Cache
- **Commit:** `71b66abb`
- **Files:** `src/mcp-servers/devin/session-store.ts`
- **What:** In-memory cache for `snapshotDevinSession()` keyed by `sessionId:fileSize:mtime:limit`. Eliminates redundant file reads when agents poll unchanged log files.
- **Cache eviction:** Cleared on session cancel and shutdown.

### Incremental Log Reads
- **Commit:** `71b66abb` (server), `f91eb037` (skill docs)
- **Files:** `src/mcp-servers/devin/server.ts`, `src/mcp-servers/devin/session-store.ts`
- **What:** `devin_status({ session_id, since_bytes })` returns only new output since the last byte offset. Agents track `output_bytes` from response and chain calls.
- **Impact:** Eliminates ~99% redundant data transfer during long-running session polling.

### Batch Cancellation
- **Commit:** `71b66abb`
- **Files:** `src/mcp-servers/devin/server.ts`, `src/mcp-servers/devin/session-store.ts`
- **What:** `devin_cancel_batch({ session_ids })` cancels up to 50 sessions in one MCP tool call, with structured result (`cancelled`/`unknown`/`errors`).

### Per-Model Concurrency Limits
- **Commit:** `71b66abb`
- **Files:** `src/mcp-servers/devin/session-store.ts`
- **What:** Default 5 concurrent sessions per model, with FIFO queuing when slots are full. Mirrors `BackgroundManager` concurrency pattern.
- **Bug fix:** `f2197075` — `acquireModelSlot` now uses `resolvedModel` (includes default) instead of raw `options.model`, preventing split pools.

### Priority Queues in BackgroundManager
- **Commit:** `71b66abb`
- **Files:** `src/features/background-agent/manager.ts`, `src/features/background-agent/types.ts`, `src/features/background-agent/constants.ts`
- **What:** Tasks can specify `priority` (default 5, lower = higher). Queue sorted by priority before processing, ensuring urgent tasks get slots before batch jobs.

---

## Resilience & Maintainability

### Session Re-attachment on MCP Server Restart
- **Files:** `src/mcp-servers/devin/session-store.ts`, `src/mcp-servers/devin/server.ts`
- **What:** On startup, scans `/tmp/oh-my-opencode-devin-mcp/` for `.meta.json` files with `status: "running"`. Since the process is gone after a restart, marks them as `"orphaned"` and registers as read-only sessions. `devin_list` and `devin_status` still report orphaned sessions with full log access.
- **Why:** Prevents "ghost" sessions that silently disappear after a server restart. Agents and users can see what was running when the server went down.

### Pre-flight Validation in devin_start
- **Files:** `src/mcp-servers/devin/session-store.ts`
- **What:** Before spawning a Devin process, validates:
  1. The `devin` binary exists in PATH (result cached after first check)
  2. The model name is recognized — typos like `"sonet"` are caught via Levenshtein distance with "did you mean?" suggestions
  3. The working directory exists and is a directory (not just a file)
- **Why:** Fails fast with actionable errors instead of silent spawn failures.

### Auto-cleanup of Completed Sessions (TTL Reaper)
- **Files:** `src/mcp-servers/devin/session-store.ts`
- **What:** Background interval (every 60s) removes terminal sessions (`completed`, `error`, `cancelled`, `orphaned`) from the in-memory `Map` after 1 hour. The `.meta.json` and `.log` files remain on disk for the `devin-report` CLI command and test reporter script.
- **Why:** Prevents memory leaks in long-running MCP server processes.

### Idle Session Detection
- **Files:** `src/mcp-servers/devin/session-store.ts`, `src/mcp-servers/devin/types.ts`
- **What:** Background interval (every 5 min) checks running sessions for log output growth. If a session's log hasn't grown in 30 minutes, status is set to `"stalled"`. The session is NOT auto-cancelled — agents or users decide. New `DevinSessionStatus` values: `"orphaned"` and `"stalled"`.
- **Why:** Surfaces hung sessions that waste compute, without destructive auto-cancellation.

### Max Duration Cap on devin_start
- **Commit:** `a6892032`
- **Files:** `src/mcp-servers/devin/session-store.ts`, `src/mcp-servers/devin/types.ts`
- **What:** Added `maxDurationMs` option to `devin_start`. Running sessions exceeding this cap are auto-cancelled. Default: 2 hours (7200000ms), minimum: 1 minute (60000ms). A background check runs alongside idle detection every 5 minutes.
- **Why:** Prevents runaway Devin sessions from burning subscription credits indefinitely when agents forget to cancel or the task loops.

### Log File Size Caps
- **Commit:** `a6892032`
- **Files:** `src/mcp-servers/devin/session-store.ts`
- **What:** Two-tier log size enforcement checked every 5 minutes:
  - **Soft cap (100MB):** Logs a warning to stderr — session continues running
  - **Hard cap (500MB):** Auto-cancels the session to prevent disk exhaustion
- **Why:** Verbose Devin sessions (e.g., with debug logging, long compilation output) can grow logs to multiple GBs. The caps prevent the MCP server from filling the tmp partition.

### Structured Error Hints & Model Fallback Chain
- **Commit:** `283d1440`
- **Files:** `src/mcp-servers/devin/session-store.ts`, `src/mcp-servers/devin/tiers.ts`, `src/mcp-servers/devin/types.ts`, `src/features/builtin-skills/skills/devin-cli.ts`
- **What:** When `devin_start` fails due to API limits, the error is parsed and returned as a **structured tagged hint** instead of raw stderr:
  - `RATE_LIMIT` — detected from "rate limit", "429", "too many requests". Includes `retryAfterMs` (parsed from "retry after N" or defaults to 30000ms)
  - `QUOTA_EXCEEDED` — detected from "quota exceeded", "usage limit", "out of credits", "insufficient quota". Includes `suggestedFallback` model
  - `CONTEXT_LIMIT` — detected from "context length", "token limit", "maximum context", "too many tokens". Suggests prompt truncation
  - `UNKNOWN` — catch-all for unrecognized errors
- **Fallback chain:** `opus` → `sonnet` → `kimi-k2.6` → `swe-1.6` (Deep → Balanced → Standard → Fast/Cheap). Exported as `FALLBACK_CHAIN` with `getFallbackModel(current)` utility. When the chain is exhausted, `getFallbackModel` loops back to the default model `kimi-k2.6` for a safety-net retry, then `swe-1.6` again before giving up.
- **Auto-fallback:** New `autoFallback` option on `devin_start` (default: `false`). When `true`, the server automatically retries down the fallback chain on `QUOTA_EXCEEDED` until success or chain exhaustion.
- **Skill guidance:** The `devin-cli` built-in skill now includes a "Limit & Error Recovery" section teaching agents the fallback chain, error tag actions, and a structured recovery workflow.
- **Why:** Agents previously saw `status: error` and raw stderr with no guidance on whether to retry, fallback, or ask the user. Structured hints eliminate guesswork and reduce user interruptions.

### Tool Error Wrapping
- **Commit:** `a6892032`
- **Files:** `src/mcp-servers/devin/server.ts`
- **What:** All 6 MCP tool handlers (`devin_start`, `devin_status`, `devin_wait`, `devin_cancel`, `devin_cancel_batch`, `devin_list`) are wrapped with `safeToolHandler(toolName, handler)`. Unexpected errors are caught and returned as text results (`[{type: "text", text: "[toolName] ERROR: message"}]`) instead of propagating as unhandled exceptions that crash the MCP client connection.
- **Why:** File I/O errors, stat failures, or race conditions in tool handlers could previously crash the MCP server process. The wrapper makes the server resilient to transient filesystem issues.

### CLI Session Reporter (devin-report subcommand)
- **Files:** `src/cli/devin-report/`, `src/cli/cli-program.ts`
- **What:** First-class CLI subcommand replacing the standalone Python script:
  ```bash
  bunx oh-my-opencode devin-report              # Full text report
  bunx oh-my-opencode devin-report --json        # JSON output for CI
  bunx oh-my-opencode devin-report --tier Deep   # Filter by tier
  ```
  Scans `/tmp/oh-my-opencode-devin-mcp/` for `.meta.json` files and reports model tiers, durations, statuses, prompts, and working directories.
- **Why:** Makes the session reporter discoverable and consistent with other CLI commands (`doctor`, `boulder`).

### devin_wait MCP Timeout Fix & Incremental Polling Guidance
- **Files:** `src/mcp-servers/devin/server.ts`, `src/features/builtin-skills/skills/devin-cli.ts`
- **What:**
  1. `devin_wait` now caps actual blocking at 30 seconds per call, preventing the MCP client from timing out with `-32001: Request timed out` when agents request long waits (e.g., 300s).
  2. When `devin_wait` returns because the session is still running, the response includes:
     - Elapsed wait time vs. requested timeout
     - Current `output_bytes` value
     - Explicit next-step recommendations: `devin_status({ since_bytes })`, call `devin_wait` again, or `devin_cancel`
  3. `devin_status` tool description and built-in skill docs now emphatically instruct agents to use `since_bytes` (not `tail_bytes`) for all repeated polling, preventing the redundant output re-fetch loop shown in the agent logs.
- **Why:** Fixes the infinite `devin_wait` timeout → `devin_status` with `tail_bytes` polling loop that wastes context window and triggers MCP errors.

### Model Disclosure to User
- **Commit:** `8a120f41` (first-line placement), earlier: `803332bb` (initial)
- **Files:** `src/mcp-servers/devin/server.ts`, `src/mcp-servers/devin/tiers.ts`, `src/cli/devin-report/devin-report.ts`, `src/features/builtin-skills/skills/devin-cli.ts`
- **What:**
  1. `devin_start` response puts the resolved tier and model on the **first line**: `Started Devin session <id> (tier: <TierName>, model: <model>)`. This makes it impossible to miss in CLI scrollback. Previously it was buried at the bottom inside a `=== MODEL INFO ===` block.
  2. Built-in skill marks model disclosure as **MANDATORY** (not just recommended) and adds explicit CLI-mode instruction: read the first line of the `devin_start` result and repeat it to the user verbatim.
  3. Example interactions updated to show tier + model in the user-facing message.
  4. New shared module `src/mcp-servers/devin/tiers.ts` with `resolveTierLabel()`, `resolveTierInfo()`, and `MODEL_TIER_MAP` — single source of truth for tier mapping consumed by both the MCP server and the `devin-report` CLI.
  5. Both tier keywords (`"swe"`, `"codex"`, `"sonnet"`, `"opus"`) and fully-qualified model IDs (`"swe-1.6"`, etc.) are recognized — sessions started with either form display the correct tier.
- **Why:** Users need visibility into which Devin CLI model is running their task — for cost awareness, capability confirmation, and debugging. In CLI mode the tool output scrolls by inline; putting the model on the first line ensures it cannot be missed regardless of scrollback length.
- **Tests:** 13 new tests in `src/mcp-servers/devin/tiers.test.ts` covering all tier resolution paths.

### Startup Toast Shows Correct Default Agent
- **Commit:** `c323b6b1`
- **Files:** `src/hooks/auto-update-checker/hook/startup-toasts.ts`, `src/hooks/auto-update-checker/hook.ts`, `src/plugin/hooks/create-session-hooks.ts`
- **What:** Fixed the startup toast that incorrectly said "Sisyphus running in local development mode." even when Devin was the default agent. The toast now dynamically reflects the actual default agent:
  - If `default_run_agent` is configured in the user's config, that agent name is shown (e.g., "sisyphus running in local development mode.")
  - Otherwise, "devin running in local development mode." is shown (since Devin is the fork's default)
  - The version toast message also uses the agent name: `<agent> is steering OpenCode.`
- **Why:** The previous logic checked `sisyphus_agent?.disabled !== true` which only verified that Sisyphus was *enabled*, not that it was the *default*. Since the fork keeps Sisyphus available (but not default) alongside Devin, the toast was misleading.

### Parent Process Crash Detection (Stdin EOF Handler)
- **Commit:** `1db2ce97`
- **Files:** `src/mcp-servers/devin/server.ts`
- **What:** Added `process.stdin.on('end')` handler to detect when the parent OpenCode process crashes or abruptly closes the stdio pipe. On EOF:
  - Logs a clear diagnostic message to stderr
  - Triggers `shutdownAllSessions()` to cancel all running Devin sessions
  - Exits cleanly after cleanup
- **Why:** Prevents the MCP server from hanging indefinitely while Devin sessions continue running in the background, burning subscription credits when the parent process dies.
- **Limitation:** This is a best-effort safety net for app crashes and process kills. It does NOT handle agent turn interruption because the stdio pipe stays open across turns by design.

### Very Long Task Guidance (Docker Builds)
- **Commit:** `fca188fa`, `95fdcf67`, `9ceec636`
- **Files:** `src/features/builtin-skills/skills/devin-cli.ts`
- **What:** Added dedicated workflow guidance for tasks that take 10+ minutes (e.g., Docker builds):
  - Explicitly states `devin_wait` caps at 30s regardless of `timeout_ms` — agents must not loop `devin_wait` every 30s for 20-minute builds
  - Correct pattern: `devin_wait` once → do other work for 2-3 min → `devin_status({ since_bytes })` → repeat spaced out
  - Tell the user ONCE with clear expectations (e.g., "This typically takes 15-30 minutes"), then be completely silent until actual news
  - For >10 minute tasks, check every 5 minutes (not 2-3)
  - Only break silence on: completed, error, cancelled, stalled, or user asks
- **Why:** Prevents the "Let me wait more..." x40 log spam seen in production traces when agents get stuck in tight `devin_wait` loops for long-running Docker builds.

### Ultrawork Safeguard
- **Commit:** `9ceec636`
- **Files:** `src/features/builtin-skills/skills/devin-cli.ts`
- **What:** Added safeguard section warning agents that Devin cannot participate in Oracle verification. Instructs them to:
  - NOT emit `<promise>DONE</promise>` until Devin is fully complete
  - Fully integrate Devin's output before claiming completion
  - Describes the practical workflow: delegate → work in parallel → integrate → only then emit completion promise
- **Why:** Prevents premature completion promises when Devin is still running in the background, which would violate the ultrawork contract and leave tasks incomplete.

---

## Test Coverage

| Suite | Tests | Status |
|-------|-------|--------|
| `src/mcp-servers/devin/session-store.test.ts` | 35 | Pass — cache, batch cancel, incremental reads, reattach, pre-flight validation, idle detection, max duration cap, log size caps, spawn error detection |
| `src/mcp-servers/devin/tiers.test.ts` | 19 | Pass — tier resolution, fallback chain, getFallbackModel for all positions |
| `src/mcp-servers/devin/server.test.ts` | 8 | Pass — devin_wait schema validation (30000ms cap), safeToolHandler error catching |
| `src/cli/devin-report/formatter.test.ts` | 6 | Pass — JSON output, text output, empty state, tier breakdown |
| `src/features/background-agent/manager.test.ts` | 157 | Pass — priority queue integration |
| `src/features/builtin-skills/skills.test.ts` | 17 | Pass — skill structure validation |
| **Total** | **242** | **0 failures** |

---

## Full Commit Log

```
fbabacc3 fix(update): stage bun.lock and skip commit when no changes
a62490d7 fix(builtin-agents): remove isFirstRunNoCache from atlas call (upstream type doesn't accept it)
b4bc1912 fix(update): remove stale isFirstRunNoCache post-merge fix (upstream now requires it)
4ccd9024 fix(update): mark bun.lock resolved with git rm during conflict resolution
37e9332a fix(update): defer bun.lock regeneration until after post-merge fixes
d987d82f fix(update): run post-merge fixes BEFORE bun install (prepare triggers build)
1a370b9d fix(update): add post-merge semantic fix for builtin-agents.ts isFirstRunNoCache
371bf886 fix(update): resolve package.json before bun.lock, add missing conflict rules
7c29e6a7 fix(merge): resolve Effect.void type error and regenerate schema/lockfile
03e9e9e2 feat(update): add automated upstream sync updater script
939f2b8b @SoShymKing has signed the CLA in code-yeongyu/oh-my-openagent#4469
1b3c0351 Merge dev into fredotran/dev
03eb9fff Merge pull request #4465 from code-yeongyu/fix-4417-atlas-path-and-start-work
28efc4e8 fix(continuation): resolve registered agent name before dispatching prompt (#4417)
a5cee769 fix(prompt-async-gate): retry object-form path on runtime type error (#4417)
c25c3383 Merge pull request #4454 from code-yeongyu/fix-4448-npm-pack-dot-dirs
94d9d932 Merge pull request #4453 from code-yeongyu/fix-4419-atlas-subagent-fallback
0d0be435 Merge pull request #4452 from code-yeongyu/fix-4449-tool-execute-after-stall
9c56bf22 test(script): typecheck package layout regression
72119b3a fix(package): ship dot-directory command assets
f57532cb fix(tool-execute-after): narrow metadata warning tools
dc845a88 chore(web): migrate canonical domain to omo.dev
6551f389 fix(background-agent): retry Atlas subagents on usage limits
767f5a61 fix(model-core): retry OpenAI usage_limit_reached fallbacks
6343feb6 Merge pull request #4450 from code-yeongyu/fix-4447-subagent-task-deny
4a68db02 fix(tool-execute-after): gate metadata recovery warnings
75d1ff4c fix(plugin-handlers): deny task for read-only subagents
9be97de6 Merge pull request #4435 from code-yeongyu/fix/issue-4429-team-mode-model-override
9fd52cb6 feat(help): #689 acp help JSON schema
eed88e41 feat(help): #689 acp help JSON schema
bab9caa6 feat(help): #688 sandbox help JSON schema
1fdb88a3 feat(help): #688 sandbox help JSON schema
2c6c42f8 feat(help): #687 status help JSON schema
36e394a5 feat(help): #687 status help JSON schema
a73e4db1 feat(help): #686 doctor help JSON schema
21713dcd fix(agents): preserve model overrides with team mode
776da68e feat(help): #686 doctor help JSON schema
ce4b11b0 fix(cli): add explicit helpOption configuration for consistent help-flag ordering
222adeb6 fix(runtime-fallback): honor retryable signal
de7f1d88 Merge pull request #4400 from code-yeongyu/refactor/prompts-core-oracle-cleanup
8f09c02c docs: scrub remaining references to migrated files
d18cadb1 test(ultrawork): add byte-exact characterization test
e0b37b46 test(prometheus): add byte-exact characterization test
9d204250 docs(keyword-detector): rewrite AGENTS.md for prompts-core migration
87e28d26 docs(prometheus): rewrite AGENTS.md for thin-loader structure
640d7f7b Merge pull request #4396 from code-yeongyu/fix/session-scoped-internal-wake
3d0b4c4a fix(parent-wake): block unfinished assistant wakes
2ea7c492 Merge pull request #4390 from code-yeongyu/refactor/prometheus-to-prompts-core
1f32b885 refactor(prometheus): remove migrated section TypeScript files
8fc429a5 refactor(prometheus): load prompt variants from prompts-core
3806d93d feat(prompts-core): wire Prometheus variant table
fa0500e9 feat(prompts-core): add Prometheus prompt markdown variants
4749eab2 Merge pull request #4389 from code-yeongyu/refactor/mode-prompts-to-prompts-core
803f030b Merge remote-tracking branch 'origin/dev' into refactor/mode-prompts-to-prompts-core
528f083f Merge pull request #4388 from code-yeongyu/refactor/atlas-to-prompts-core
63ef72d1 docs(agents): document prompts-core mode prompts
80361c05 chore(prompts-core): wire markdown prompt packaging
2c8e2dac refactor(mode-prompts): migrate hyperplan prompt
e79baf59 refactor(mode-prompts): migrate team prompt
3b7f51d5 refactor(mode-prompts): migrate analyze prompt
5cefbdbb refactor(mode-prompts): migrate search prompt
c187dba5 test(keyword-detector): capture mode prompt baselines
8451ecd1 docs(atlas): document prompts-core prompt ownership
582c768b refactor(atlas): remove migrated TypeScript prompts
4975c354 refactor(atlas): load prompt variants from prompts-core
96a93650 build(prompts-core): bundle markdown prompt variants
91351d73 feat(prompts-core): support bundled prompt sources
b77fed28 feat(prompts-core): add Atlas Opus 4.7 prompt markdown
2adcec8f feat(prompts-core): add Atlas Kimi prompt markdown
d5995b38 feat(prompts-core): add Atlas Gemini prompt markdown
19237611 feat(prompts-core): add Atlas GPT prompt markdown
565d0994 feat(prompts-core): add Atlas default prompt markdown
a92e25a1 test(atlas): add prompt byte preservation baselines
66445241 Merge pull request #4386 from code-yeongyu/refactor/ultrawork-to-prompts-core
79beeeee docs: document ultrawork prompt markdown location
d217efc1 build(prompts): inline markdown prompt imports
e772c468 refactor(ultrawork): move planner prompt to prompts-core
e51acd0a refactor(ultrawork): move gemini prompt to prompts-core
a818bbd9 refactor(ultrawork): move gpt prompt to prompts-core
9c366cce refactor(ultrawork): move default prompt to prompts-core
39b3cbcb chore(ultrawork): capture prompt baseline hashes
46ad6bfd Merge pull request #4385 from code-yeongyu/refactor/prompts-core-foundation
436c6187 fix(prompts-core): block prompt path traversal
74d5f701 chore(prompts-core): wire package typecheck
da0fa83f test(prompts-core): audit opencode coupling
c44a6bdb feat(prompts-core): add prompt loader
6301bcf0 feat(prompts-core): add variant resolver
4338ddb8 feat(prompts-core): add package skeleton
87de0563 refactor(model-core): move model family detectors
e1e9f348 Merge pull request #4382 from code-yeongyu/feat/ultrawork-prompt-tdd-evidence-tightening
d073bf1b feat(ultrawork): enforce TDD, scenario contract, durable notepad, reviewer gate
39a549a3 Merge pull request #4381 from code-yeongyu/fix/team-mode-closure-prompts
5f1fb0c5 fix(team-mode): make lead close teams on its own initiative
a4dcbb6b docs(publish): use Jobdori bot for releases
1473f93f Merge pull request #4380 from code-yeongyu/fix/ralph-loop-oracle-double-fire-race
cdc93754 chore: update bun.lock
9a1dd756 fix(ralph-loop): skip handleFailedVerification when oracle dispatch is in flight (#4256)
3523dab0 @niStee has signed the CLA in code-yeongyu/oh-my-openagent#4378
41c98e51 release: v4.4.0
20d67be4 @EvangelosMoschou has signed the CLA in code-yeongyu/oh-my-openagent#4357
5e2f12fd Merge pull request #4348 from Yeachan-Heo/omc-team/you-are-one-of-5-parallel-work/worker-4
0c14c473 Merge pull request #4350 from Yeachan-Heo/omc-team/you-are-one-of-5-parallel-work/worker-3
f390d365 Merge pull request #4352 from Yeachan-Heo/fix/atlas-config-model-override-4255
54513137 Merge pull request #4356 from Yeachan-Heo/fix/issue-3805-auto-tools-path
bfc50789 fix: trust user-configured multimodal-looker model for vision (#4209)
779e2d2f fix(task): capture late-arriving sessionId so TUI subagent entry is clickable (#4252)
7d444eed fix(agents): honor user atlas model when resolution returns undefined (#4255)
6c691a1a fix(grep): probe OpenCode cache-backed bin for auto-downloaded rg (#3805)
c0a6c667 Merge pull request #4346 from code-yeongyu/fix/agent-loop-dedupe-race-4256
b3097e56 fix(background-agent): suppress redundant parent wakes
2bfad490 feat(skills): add security-research orchestration
1ecf4f64 @chouzz has signed the CLA in code-yeongyu/oh-my-openagent#4312
01d21962 Merge pull request #4238 from islee23520/fix/look-at-status-map-hang
f511b4bc Merge pull request #4263 from YOMXXX/fix/gpt-5-3-codex-migration
d06a5d7a Merge pull request #4272 from YOMXXX/fix/ast-grep-windows-cli-suffix-test
9da30095 Merge pull request #4279 from MoerAI/fix/migrate-orphan-lsp-config-key
7cc5f8c6 chore: update bun.lock
74db81df Merge pull request #4285 from SpencerJung/fix/issue-4123-tool-pair-retrigger
6cac80fe Merge pull request #4290 from SpencerJung/fix/issue-4170-cjk-agent-header
12d7d104 Merge pull request #4282 from SpencerJung/fix/issue-4149-terminal-continuation-guard
aa3a2f2e release: v4.3.1
e7120f6a Merge pull request #4295 from vanhci/fix/issue-4292-comment-checker-deadloop
9e5c4318 Merge pull request #4297 from SpencerJung/fix/issue-4128-desktop-sidecar-crash
7409f2ea Merge pull request #4300 from code-yeongyu/fix/issue-3919-desktop-native-search
e6d8b3e7 Merge pull request #4299 from code-yeongyu/fix/issue-4128-ctx-dollar-guard
a51d22d3 Merge pull request #4301 from code-yeongyu/fix/issue-4256-duplicate-prompt-dispatch
560569e3 fix(parent-wake-notifier): drop duplicate wakes during promptAsync gate hold (#4256, #4019)
aded57ff fix(shared): harden ripgrep-cli, zip-extractor, binary-downloader subprocess paths
d17b2127 fix(tools/grep, tools/glob): use Node-safe subprocess streaming (#3919)
4ea7562f feat(shared): add Node-safe process stream reader and search output collector
bc8c462d fix(session-notification-sender): guard ctx.$ with execFile fallback for Desktop sidecar (#4128, #4061)
b31ad3c8 @csxq0605 has signed the CLA in code-yeongyu/oh-my-openagent#4298
6062df82 fix(migration): make 'lsp' migration guidance self-contained and update stale docs (addresses codex P2 on #4279)
ec9997b7 fix(background-agent): keep cleanup error listener active
4cf391b7 fix(comment-checker): skip modified-existing comments and dedupe per-session (issue #4292)
ed4c04e5 fix(cli): preserve CJK agent header text
28569307 fix(tool-pair-validator): continue after synthetic repairs
7dae2711 fix(atlas): honor stopped continuation after boulder completion
a7429cc2 fix(migration): drop orphan 'lsp' config key so users see LSP moved to .opencode/lsp.json (fixes #4225)
ccaf61e0 test(ast-grep): lock Windows backslash matching for ast_grep dist cli suffix (#4220)
cb205e14 @SpencerJung has signed the CLA in code-yeongyu/oh-my-openagent#4247
16993291 @YOMXXX has signed the CLA in code-yeongyu/oh-my-openagent#4263
d788c3d1 fix(migration): stop rewriting explicit gpt-5.3-codex to gpt-5.4 (#3777)
0904e237 @wolfkill has signed the CLA in code-yeongyu/oh-my-openagent#4261
00d814ee chore: update bun.lock
4e0dc7fa release: v4.3.0
abeb555c chore: regenerate config schema after default_mode/i18n/disabled_providers additions
f313eb1a docs: add [Unreleased] section and #4225 known issue
11c3da75 fix(default-mode,multimodal-looker,delegate-task): preserve user-expected behavior
7cce0ad2 fix(notepad-guard,start-work): wire dispatch and match .omo paths
3f44b45f feat(i18n): wire initI18n into production plugin startup
2e2e33cf test: fix stale imports after prompt-async-gate and model-core refactors
9c9e9885 fix(model-core): restore OpenAI server_error retryable patterns (regression from package extraction)
9624914c test(disabled-providers): drop logger mock to fix global mock-module leakage
bc0da0fa test: fix prometheus-prompt syntax + sync display name casing to lowercase
beed9e89 @shipped-it has signed the CLA in code-yeongyu/oh-my-openagent#4253
f1bf61ef fix: resolve duplicate ANALYZE_MESSAGE/ANALYZE_PATTERN identifiers in keyword-detector constants
2884ec9f chore: regenerate config schema
8a5811bf chore(comment-checker): drop dead apply-patch-edits re-export shim
7c66aae0 refactor(rules-engine): centralize rule constants and AGENTS.md walk-up
edaa95fe refactor(model-core): host snapshot fetcher, suggestion parser, and context-limit resolver
4ea76365 refactor(packages): extract hashline-core package
f29411a6 Merge pull request #4235 from code-yeongyu/fix/subagent-timeout-active-output
dbfde0b0 fix(background-agent): ignore metadata stream output
c4a51bee Cover look_at permanently absent session output
282010f9 fix(background-agent): gate stale timeout on abort success
6d15ab86 fix(background-agent): fail cancellation when abort fails
bd1a6e3d fix(background-agent): forward session stream activity
b3a195d6 Avoid look_at status map wait hang
53cabfe4 Merge pull request #3035 from code-yeongyu/fix/issue-2697-v2
90c38d16 Merge remote-tracking branch 'origin/dev' into fix/subagent-timeout-active-output
0bf8a9df fix(background-agent): fail abort on SDK errors
a562d536 fix: strip mcp_ prefix from tool names before dispatch
b68af25e fix(background-agent): track session.next activity
6c0252fa Merge pull request #3742 from mrosnerr/fix/schema-preserve-custom-agent-overrides
6e1e01eb Merge pull request #4219 from sjawhar/fix/skill-discovery-opencode-config
baa07dc9 Merge pull request #4232 from MoerAI/fix/hyperplan-hpp-file-extension
61b812ff fix(keyword-detector): stop hyperplan firing on '.hpp' C++ header paths (fixes #4215)
94d6d5b4 Merge pull request #4231 from code-yeongyu/fix/post-4228-test-and-session-gone
0feb1250 fix(background-agent): preserve missed polls on lookup errors
98d475f9 test(agent): align remapper fallback display name
7e8a61ae Merge pull request #2307 from SwiggitySwerve/feat/prometheus-spec-awareness
b2971a6a Merge pull request #2827 from z-traveler/feat/per-agent-skill-filtering
a7af82a8 Merge pull request #4230 from code-yeongyu/fix/post-merge-debugging-cleanup-20260521
80d726bf chore: remove reintroduced debugging artifact
3d402644 Merge pull request #4228 from code-yeongyu/fix/delegate-stale-activity
deb13d8e Merge pull request #3241 from cpkt9762/fix/configurable-task-cleanup-delay
4b6877cb Merge pull request #3294 from kilhyeonjun/fix/doctor-custom-provider-regression
d78ebc12 Merge pull request #3370 from Zireael/fix/git-bash-shell-detection-on-windows
6678c2ae Merge pull request #3884 from leeyazhou/i18n
c5f8fd40 Merge pull request #4031 from PeterPonyu/feat/config-disabled-providers
e4a60b8c Merge pull request #4048 from PeterPonyu/feat/doctor-check-tui-plugin
735b4d29 Merge pull request #4070 from PeterPonyu/fix/4036-prompt-shield-system-directive-marker
45e5d5dd Merge pull request #4071 from PeterPonyu/fix/4027-role-coordinator-subagent-selection
d7d023bf Merge pull request #4072 from PeterPonyu/fix/3645-runtime-fallback-git-silent-fail
689ad997 Merge pull request #4079 from PeterPonyu/refactor/3694-extract-analyze-constants
c5b1bff3 Merge pull request #4080 from PeterPonyu/docs/3469-mcp-list-plugin-vs-native
9cca6848 Merge pull request #4081 from PeterPonyu/feat/4004-agent-display-name-i18n
acedacc5 Merge pull request #4084 from pizzav-xyz/feature/keyword-detector-enabled-expansions
ba5bc0ef Merge pull request #4092 from code-yeongyu/fix/status-timeout-hang
a7401a34 Merge pull request #4157 from ririnto/docs/config-reference-alignment
323e53f3 Merge pull request #4181 from devswha/docs/add-vibetip-docs-link
b40426ca Merge pull request #4190 from herjarsa/feat/default-mode
d5029002 Merge pull request #4221 from heunghingwan/feat/plan-format-validator
e4049b7a Merge pull request #4222 from andomeder/wip/pr1-skip-disconnected-explicit-provider-fallbacks
bd553962 fix(look-at): avoid empty stable idle completion
bd614793 Merge pull request #4227 from code-yeongyu/fix/post-4106-cleanup-20260521
95291fa4 chore(evidence): refresh package layering refactor notes
fc0f4cc9 chore(model-core): remove unused generated snapshot (DI strategy makes it dead)
f6a2ff35 test(coupling-audit): allowlist dual-runtime spawn shims
2f26f78f chore(evidence): backfill PASS sentinels in empty evidence files
017f05dd refactor(packages/model-core): eliminate src/ back-imports via dependency injection
e15461fe refactor(model-core): inject bundled capabilities snapshot from harness
2462d7af refactor(model-core): remove src back-imports via core utilities and adapter
819bf0d1 chore: update meta-audits + add opencode coupling grep gate
a089d4a5 docs: update AGENTS.md + ROADMAP.md for package layering refactor
faf4a2d3 chore: post-W2 cleanup (remove orphan rules-core dir + W2-QA evidence)
27e43457 docs: update rules-core → rules-engine references
4bbf1d93 refactor(packages): rename rules-core to rules-engine
7c7aa281 refactor(packages): extract agents-md-core package
2748009f refactor(packages): extract model-core package
f7ceb03e refactor(packages): extract boulder-state package
7028c1f4 refactor(packages): extract comment-checker-core package
3b303e79 refactor(packages): extract ast-grep-core from ast-grep-mcp
a5c1d710 refactor(packages): extract utils package
c4fe747e chore: baseline measurements for package layering refactor
6e6f300c fix(background-agent): defer stale cancel on activity lookup errors
036e04c1 fix(look-at): allow stable idle after sync prompt
98d760a5 test(agent): align remapper display assertion
927cc84f fix(background-agent): refresh stale checks from session activity
8979e198 Merge pull request #4226 from code-yeongyu/fix/background-notification-active-turn-queue
0ad4d974 fix(background-agent): preserve parent activity across idle events
ced36bff refactor: split prompt async gate modules
3717b332 chore: remove leaked debugging artifact
a8201726 fix(background-agent): defer parent wakes during active turns
8b526124 Merge pull request #4194 from MoerAI/fix/lsp-windows-cli-path-separator
9bd2a9d7 fix(runtime-fallback): fall back to synthetic continuation when session messages are empty  (#3645)
20ba83e1 test(mcp): remove stale lsp exists import
ed6e9955 fix(mcp): normalize path separators in LSP/ast-grep cli candidate detection (fixes #4151)
860c663c fix-up(#4027): narrow coordinator guard to registry hard-reject set
7af3007e fix(team-mode): reject coordinator agents as subagent targets (#4027)
97910193 fix(prometheus-md-only): replace SYSTEM DIRECTIVE marker with XML tag in external prompts (#4036)
5a965fb4 fix(background-agent): skip disconnected explicit-provider fallbacks
e83bdb83 release: v2.0.0
cfe29168 Fix ambiguous FN. notation in Final Wave label instructions
fcb96841 @heunghingwan has signed the CLA in code-yeongyu/oh-my-openagent#4221
73b5a7eb Add plan format validator hook to detect malformed task labels
b4c4c53b fix(devin-mcp): await async file ops in session-store meta updates
e250c715 fix(tests): resolve fork-specific and upstream merge test failures
3ac42616 fix(build): align zod version override to resolve MCP SDK type incompatibility
a6e4691f fix: remove duplicate local isRecord declaration (conflicts with import)
9c4ae269 fix(skill-discovery): load native OpenCode skills in task delegation
97c73b41 Merge pull request #3147 from EZotoff/fix/notepad-directive-scope
db4c9f49 Merge pull request #3316 from ahuangsnail/fix/max-output-tokens-zero-fallback
821ee92c Merge pull request #2965 from sjawhar/fix/chat-message-session-cache
5b72411b Merge pull request #3045 from haimingZZ/fix/gpt54-junior-edit-tool-haimingzz
d7dbe7cd Merge pull request #2988 from odedindi/fix/add-server-export
abcc46f4 fix: update pollSessionUntilIdle -> waitForLookAtSessionResult import
2a4f5f28 Merge pull request #2958 from kui123456789/fix/context-injector-prt-prefix
70da8ad6 Merge pull request #3600 from hackerh3/hackerh3/start-work-session-affinity
3dba5527 Merge pull request #2991 from GreenPi290/fix/doctor-wsl-binary-detection
f5de4bf7 Merge pull request #3498 from Disaster-Terminator/fix/task-id-prompt-surface
abf79cd8 Merge pull request #3499 from Netzhangheng/fix/windows-auth-interceptor-binding
ace15a6a Merge pull request #3785 from Biemmmmm/fix/resolve-plugin-root-in-commands
d0719ff7 Merge pull request #3875 from jollyxenon/fix/3846-opencode-config-dir-additive
6dcb2afd Merge pull request #3838 from NICxKMS/fix/team-mode-windows-atomic-write
b18963b0 Merge pull request #3868 from MoerAI/fix/openai-server-error-retryable
2185babd Merge pull request #3936 from wjiuxing/fix/flaky-spawner-test-polling
cad63c97 Merge pull request #4052 from PeterPonyu/fix/3505-attach-retry-until-session-ready
7651c856 Merge pull request #3944 from survivor998/fix/ultraworker-display-name-zwsp
10ad8d87 Merge pull request #4050 from PeterPonyu/fix/3822-doctor-plugin-version-detection
0e49767a Merge pull request #4026 from dihak/fix/graceful-shutdown-exit
e824115a Merge pull request #4063 from PeterPonyu/fix/3963-server-url-port-zero
467aa13e Merge pull request #4064 from PeterPonyu/fix/3923-team-error-propagation
cb124f75 Merge pull request #4065 from PeterPonyu/fix/3987-team-create-hard-reject-validation
a1f03c84 Merge pull request #4066 from PeterPonyu/fix/2887-filter-terminal-probe-replies
6637a184 Merge pull request #4067 from PeterPonyu/fix/3898-fallback-preserve-team-context
b76e8d2e Merge pull request #4077 from PeterPonyu/fix/4013-todo-continuation-enforcer-loop
5eabeb80 Merge pull request #4082 from PeterPonyu/fix/3685-notepad-no-write-fallback
85d03298 Merge pull request #4098 from sjawhar/feat/look-at-async
aa3187bf Merge pull request #4180 from JacobZyy/fix/plugin-hooks-merge
343d9ed2 Merge pull request #4099 from sjawhar/fix/mcp-reload-survival
7a5b8d83 Merge pull request #4100 from sjawhar/fix/tmux-isolated-close-no-layout
12ed091e Merge pull request #4101 from sjawhar/fix/modalities-object-shape
aa5eeaf8 Merge pull request #4102 from sjawhar/fix/skill-directory-param
3ee0209a Merge pull request #4113 from PeterPonyu/fix/3937-runtime-fallback-quota-patterns
f35bb956 Merge pull request #4114 from PeterPonyu/fix/3607-detect-shell-windows-msystem
c6d754d3 Merge pull request #4115 from PeterPonyu/fix/3726-glob-grep-broken-symlinks
8276eb6c Merge pull request #4121 from mguttmann/fix-4119
33f121b1 fix: add PATH to restricted hook env, protect HOME/CLAUDE_PROJECT_DIR from allowlist override, reset plugin hooks state in tests
3e9c3f8a Merge pull request #4146 from LYY/fix/skill-shortname-fallback
2fd62714 Merge remote-tracking branch 'origin/dev' into dev
791825fc Merge pull request #4153 from MoerAI/fix/fallback-model-string-guard
e2469657 Merge pull request #4154 from MoerAI/fix/todo-description-override-fires
b463acda Merge pull request #4171 from MoerAI/fix/multimodal-looker-tool-usage-guidance
eea27d6f fix(mcp): resolve local mcp runtimes
37be0d56 Merge pull request #4174 from MoerAI/fix/cli-setup-alias-for-install
0a20844b fix: address PR #4180 review - security, typing, and test coverage
fd6a7aed Merge pull request #4176 from jangByeongHui/fix/skill-mcp-env-allowlist-bypass-3995
1e42c610 fix(todo-continuation): normalize prompt agent
32f0e1e0 Merge pull request #4186 from lang-911/feat/grok-reasoning-effort
3e2662dc chore: update bun.lock
5a695505 Merge pull request #4206 from jeongjin0/fix/session-ready-background-tasks
1f03f275 Merge branch 'origin/dev' into fredotran/dev
c85d2f9b fix(model-error-classifier): mark OpenAI server_error patterns as retryable (fixes #3799)
69e7ab47 Merge pull request #4083 from PeterPonyu/fix/3724-slash-command-content-duplicated
46118561 Merge pull request #4172 from MoerAI/fix/team-mode-base-dir-chmod-eperm
efe0458c release: v4.2.3
4e4bb361 docs(release): finalize v4.2.3 release notes
fbcc1435 fix(runtime-fallback): recognize completion progress events
2f5fc7c4 fix(rules-core): block symlinked rule directory escapes
330e437f docs(agents): regenerate hierarchical AGENTS.md for 2026-05-20
39aadbf9 fix(context-recovery): handle idle sessions
caa751aa @jeongjin0 has signed the CLA in code-yeongyu/oh-my-openagent#4206
60a23a55 fix(notification): suppress ready alerts during background tasks
c197c240 docs(agents): require merge commits for PRs
23396066 docs(release): expand v4.2.3 CHANGELOG and add OmO logo to README.ru.md
a0d75d15 docs(prompt-gate): document DEFAULT_PROMPT_ASYNC_POST_DISPATCH_HOLD_MS 250 -> 2000
b24dc6ee fix(rules-core): isolate package + block symlink escape from rule sources
89f69026 Merge pull request #4205 from code-yeongyu/fix/comment-checker-apply-patch-payloads
b5277251 Merge pull request #4203 from code-yeongyu/fix/continuation-prompt-dispatch-20260520051014
3bd63020 fix(comment-checker): handle apply_patch payloads
7d9cc4fb Merge pull request #4204 from code-yeongyu/hotfix/og-static-deploy-fix
6fd5e7c9 fix(web): switch OG image from next/og to static PNG file convention
5154ab4c Merge pull request #4202 from code-yeongyu/feature/web-portfolio-refinement-20260520
e9c44ddb fix(web): drop nested <main> on manifesto (WCAG 1.3.1)
f5d5e980 fix(web): hero Get Started CTA -> /docs#installation (closes #3848)
0ebba9eb fix(rules-injector): retry storage writes after cleanup race
4a72729a fix(plugin): run idle hooks for synthetic status idle
64997d5e test(web): responsive matrix — 6 viewports x 4 locales x 2 pages
623af759 feat(web): dynamic OG + Twitter card images via next/og
022eb784 refactor(web): decompose 358-LOC manifesto into 9 section components
4d5f58f0 refactor(web): decompose 832-LOC landing into 10 section components
78ca837e style(web): extract design system tokens + DESIGN.md
7e0406f4 fix(web): UX/a11y polish + middleware metadata route fix
68b80e03 perf(web): optimize CI + build pipeline
9799c54a chore(web): remove dead deps + safe version bumps
faf2b021 fix(lsp): update lsp-tools-mcp cleanup
18b58914 docs(reference): cross-module rules injection comparison report
fbe423a2 feat(rules-injector): hydrate dedup cache from session transcript
4de2782b Merge pull request #4201 from code-yeongyu/fix/test-isolation-cross-test-state-leak
f8d04d74 fix(test-isolation): isolate rules injector storage and fixture home
c6dc266f test(test-isolation): add diagnostic regression test for cross-suite leak
504a7779 Merge pull request #4200 from code-yeongyu/fix/rules-core-restore-sisyphus-with-deprecation-warning
dd9dd428 Merge pull request #4199 from code-yeongyu/fix/parent-wake-same-source-reservation-requeue
12aaff28 test(rules-core): isolate sisyphus deprecation warning assertion
53ddc470 test(rules-injector): align duplicate-cache mock types
d92894a3 docs(changelog): document .sisyphus/rules restoration and planned removal in v4.3.0
1bab6ec4 fix(rules-core): restore .sisyphus/rules discovery with deprecation warning (planned removal v4.3.0)
7ffe823f test(rules-core): add red tests for restored .sisyphus/rules discovery + deprecation warning (BUG-G)
11d2cfb8 fix(background-agent): re-enqueue parent wake on same-source reservation instead of dropping
ee8b80a5 test(background-agent): add red test for parent-wake drop on same-source reservation hold (BUG-E)
1760ffb6 Merge pull request #4196 from code-yeongyu/fix/rules-core-fallback-to-workspace-when-no-project-root
1f9a581e fix(rules-core): fall back to workspace directory when no project root marker is found
2c62e729 test(rules-core): add red test for project rule discovery in markerless workspaces (BUG-F)
913cc089 Merge pull request #4198 from code-yeongyu/fix/ast-grep-mcp-allow-absolute-paths-inside-workspace
4c7d7e8c Merge pull request #4197 from code-yeongyu/fix/prompt-gate-event-shapes-and-finish-marker
bd2823e8 Merge pull request #4195 from code-yeongyu/fix/team-send-message-ambiguous-delivery-loss
9cdcb429 revert(agents-md): restore ROADMAP warning banner unrelated to this PR
2ea2159d fix(ast-grep-mcp): allow absolute paths whose realpath is inside the workspace
b2e42e1b test(ast-grep-mcp): add red test for absolute paths inside workspace
f8f4b572 fix(runtime-fallback,prompt-gate): recognize all OpenCode progress event shapes and boolean/completed finish markers
20efb79f test(runtime-fallback,prompt-gate): add red tests for event-shape and finish-marker blind spots (BUG-C+D)
da5aa7f3 test(team-mode): allow reclaimed reservations to stay readable
579b8c38 docs(AGENTS.md): add aggressive refactoring-in-progress warning
f79da77f test(team-mode): decouple resume history fixture from session routing
af42f0ac test(team-mode): stabilize resume stale reservation history check
655dffbc fix(team-mode): release reservation on ambiguous failure, commit on success-path mark failure
7adb8336 test(team-mode): add red tests for ambiguous delivery loss (BUG-A + BUG-B)
847a8db2 fix(runtime-fallback): preserve accepted pending retries
6df148f0 fix(team-mode): close peer message delivery races
d3e218f9 fix(prompt): treat post-dispatch failures as accepted
3cb6785d fix(ralph-loop): minimal continuation prompt for default_mode
dc2e082a fix(default-mode): skip ultrawork system prompt when ralph_loop is also enabled
2f1380f5 refactor(default-mode): inject ultrawork via system prompt instead of visible text
e5463e2d feat(default-mode): auto-activate ultrawork and ralph loop without commands
696682e9 fix(chat-message): refresh stale session-agent cache from explicit input.agent
33c8bcd8 fix(look-at): address Oracle review findings on async session poller
824cd1a8 fix(skill-mcp): allow MCP manager to accept connections after disconnectAll
e8a7e2a9 fix(tmux): skip layout enforcement when closing isolated container pane
94e71936 fix(model-capabilities): handle object-shaped modalities in readModalityKeys
d2d15413 fix(skill): pass directory to getAllSkills and fix async test timing
342954ca fix(sisyphus-junior-notepad): scope plan directive to delegated workers
f5402498 docs(readme): add OmO logo to hero section
b2918fd4 fix(team-mode): close peer message delivery races
bcea4a9d fix(prompt-gate): harden sync and team prompt dispatch
1492bffd fix(prompt-gate): harden internal prompt dispatch
6c63372e @lang-911 has signed the CLA in code-yeongyu/oh-my-openagent#4186
8b097f2c fix(model-heuristics): register Grok family with reasoningEffort support
22cf4fcc @devswha has signed the CLA in code-yeongyu/oh-my-openagent#4181
9b151a25 fix(delegate-task): address Oracle review on PR #4121 — preserve explicit-null reject + rewrite continuation test
2f16a7da fix(delegate-task): default run_in_background and load_skills instead of throwing (fixes #4119)
c5cc720d docs(readme): add docs site badge linking to omo.vibetip.help/docs
68f9cd25 Merge branch 'i18n' of github.com:leeyazhou/oh-my-openagent into i18n
9dc9d779 feat(i18n): add toast i18n with en/zh locale and plugin config support
5e208422 fix(hooks): always persist plugin hook config state, even when empty
49066e7e @JacobZyy has signed the CLA in code-yeongyu/oh-my-openagent#4180
4d105d05 fix(hooks): merge marketplace plugin hooksConfigs into claude-code-hooks at config time
3dd41422 fix(rules): drop legacy sisyphus rule sources
7db3a7f9 fix(team-mode): preserve live delivery holds after ambiguous prompt failure
bb757514 fix(babysitter): avoid double prompt gate
44ef5dec fix(runtime-events): honor OpenCode progress shapes
38462aa9 fix(recovery): avoid duplicate continuation prompts
e57bac3b fix(prompt-retry): preserve async holds without blocking validation fallbacks
5f733f47 fix(parent-wake): recognize sdk tool progress
67bd3249 fix(runtime-fallback): keep pending retry state on gate skip
98c3fee1 fix(prompt-gate): detect finish-only tool waits
d3d2d491 fix(parent-wake): preserve stale tool-call wake escape
dfc2e8e4 fix(prompt-retry): preserve peer prompt reservations
b53a8b5e fix(parent-wake): close duplicate wake races
f5f358ab fix(prompt-gate): ignore internal user tails in tool waits
63e4198d @jangByeongHui has signed the CLA in code-yeongyu/oh-my-openagent#4176
1f3245e8 Merge pull request #4175 from code-yeongyu/fix/anthropic-assistant-prefill-tail
22aadd68 fix(skill-mcp-manager): trust explicit skill MCP env vars (#3995)
5f0e037d fix(plugin): cover Anthropic-family prefill guard
45d670a7 fix(plugin): constrain Anthropic prefill guard
3509bf47 fix(plugin): guard Anthropic assistant prefill tails
35d40cfd Merge pull request #4173 from code-yeongyu/roadmap-refactor
554a6aab fix(cli): add 'setup' as an alias for the install command (fixes #4112)
ff78aeda docs: add ROADMAP.md with package layering refactor plan
688d7395 fix(team-mode): swallow EPERM/ENOTSUP/EINVAL from chmod on base dir to keep init alive (fixes #4023)
81ce5127 fix(agents): declare multimodal-looker tool allowlist in prompt to prevent death loop on small VL models (fixes #4116)
33b66376 fix(background-agent): defer live tool-turn wakes
6915f152 fix(todo-continuation): cancel stale ULW countdown
37bd866c Merge pull request #4155 from code-yeongyu/feature/rules-astgrep-packages-20260518
8b40d0af docs: align config reference with implementation
d8f6d59d docs: update rules and MCP inventories
06f67093 build: wire ast-grep MCP into release gates
05c09c1d fix(doctor): list all built-in MCP servers
90b3f4ac test: harden workspace package assumptions
a86cc6af refactor(tools): remove native ast-grep tool
ef09880e feat(mcp): register ast-grep as built-in MCP
499aff01 feat(mcp): add package-backed ast-grep MCP
4ea29e2c refactor(rules): delegate injectors to rules-core
fb7d47f1 feat(rules): add shared rules-core package
472c2931 chore(packages): declare shared tool workspaces
25171a6c chore(hashline): update fixture dependencies
a6f1950d fix(web): restore navigation smoke coverage
9a9d9bd5 fix(web): adapt build tooling
92a5a442 chore(web): update web dependencies
c9a3c34a test: stabilize dependency verification
f925d130 chore(deps): update root dependencies
6fe2f72c fix(mcp): bootstrap lsp when cli is unavailable
ed44466f fix(plugin): wire tool.definition handler so todo-description-override actually fires (fixes #3705)
f6fba0b1 chore(deps): bump @code-yeongyu/comment-checker to 0.8.0
ae0c106e fix(shared,delegate-task,claude-code-agent-loader): guard model parsers against non-string input (fixes #4145)
47fced74 fix: address review findings - git-master identity check, test fixtures, regression strength
77997d8e fix(skill-loader): support unambiguous short skill names
ea249121 @LYY has signed the CLA in code-yeongyu/oh-my-openagent#4146
08869369 feat: filter agent-restricted skills from prompts and tool description
2926e366 Merge pull request #4148 from code-yeongyu/fix/prompt-async-duplicate-response
5862292e chore: refresh platform binary lockfile entries
450c1f9e fix(runtime-fallback): ignore stale assistant errors during fallback wait
2638dee2 @z-traveler has signed the CLA in code-yeongyu/oh-my-openagent#2827
b9707b84 Fix paused boulder session resolution
751f969f release: v4.2.0
881e990c fix(test/session-recovery): replace mock.calls[0][0] with typed accessor
9ddf1310 fix(test/runtime-fallback): add git_master to config fixture
394567a6 fix(ci): initialize submodules in publish-main checkout
ae278eb9 fix(mcp): always register lsp server
bf967945 chore(web): move site under packages
5e9a26c1 chore(packages): align platform package dirs
3e3beef2 fix(mcp): point CI lsp submodule path at packages
e9061731 fix(ralph-loop): guard verification retry ownership
9c19bd8c fix(ralph-loop): defer during fresh user prompts
cf901d4b chore(workspace): drop stale root plans
7187db6e chore(mcp): move lsp submodule under packages
bcbab055 fix(todo-continuation-enforcer): preserve countdown across compaction
f898116b test(todo-continuation-enforcer): lock compaction countdown state
ca3ea0bb fix(messages-transform): narrow assistant-tail recovery trigger
44ee5e6a test(messages-transform): lock assistant-tail continuation guard
f20294a7 fix(unstable-agent-babysitter): normalize reminder agent names
0ee45aa6 fix(unstable-agent-babysitter): respect active sessions
af1ad4d0 fix(background-agent): coalesce parent wake races
c712b71d test(tmux): isolate pane close logic tests
3b54d587 Merge pull request #4132 from code-yeongyu/fix/3446-atlas-runaway-loop
6dc31b2c fix(atlas): scope no-tool-progress counter to active plan path before stall
ed5a3f90 Merge pull request #4142 from code-yeongyu/fix/prompt-dispatch-gate
428a18c7 test(prompt-gate): tighten dispatch route regressions
e1554c08 fix(ralph-loop): preserve prompt dispatch holds through activity
66cb72b8 fix(prompt-gate): bind session messages receiver
1a66b96b docs: note Atlas stalled continuation fix
d3b4c022 fix(atlas): stop stalled boulder continuations
fff99aeb fix(atlas): track no-tool-progress state
0994c107 fix(atlas): require blocked plan checkbox edits
d44cd1c1 fix(background-agent): preserve parent agent on retry wakes
3b50b7c8 Merge pull request #4143 from code-yeongyu/fix/shell-env-csh-support
82b0672c fix(git-master): emit csh-compatible setenv syntax for csh/tcsh shells
b2961409 test(shell-env): add csh/tcsh detection and buildEnvPrefix coverage
bc2ed016 Merge pull request #4141 from code-yeongyu/fix/3396-config-skills-paths-discovery
b0f432db Merge pull request #4136 from code-yeongyu/fix/4059-blocker4-reland
c8c06d60 Merge pull request #4020 from scw1109/fix/default-agent-sort-order
c37725bb Merge pull request #4139 from code-yeongyu/fix/3450-anthropic-context-limit-revisited
ecb87608 fix: wire host config.skills.paths into command skill discovery
971be27b docs(known-issues): mark blocker-4 resolved
d5b1d361 docs(changelog): add 4.2.1 blocker-4 entry
14127958 fix: wire host config.skills.paths into agent skill discovery
043e84be fix: add adaptHostSkillConfig utility for host config.skills.paths
f5e063b0 fix: only call setDefaultAgentForSort when user explicitly sets default_agent
f17623d4 test(shared): isolate logger module in full suite
0f8fc548 fix(runtime-fallback): consume delegated bootstrap retry payload
f0f798d1 Merge pull request #4138 from code-yeongyu/fix/3207-git-master-shell-detect-reland
fdf7ba2e Merge pull request #4129 from code-yeongyu/feature/stage-c-lsp-mcp
6251a632 Merge pull request #4135 from code-yeongyu/fix/3893-team-mode-fresh-install
2387f1e7 Merge pull request #4134 from code-yeongyu/ulw/rule-comment-baseline-20260518
35df9119 test(hooks): update preemptive-compaction token thresholds for GA 1M context
b9a8ffec fix(shared): return GA 1M context limit for Anthropic 4.6/4.7 models without cached entry
161813c1 test(doctor): remove unstable unavailable-binary assertion
a0b01550 Merge pull request #4137 from code-yeongyu/fix/3763-exa-bearer-auth-reland
d7caeb01 fix(git-master): use shared shell detection for cross-platform env prefix (fix #3207)
00e6c824 Merge pull request #4117 from ririnto/fix/plan-subagent-hidden-registry
50ae2e11 perf(rules-injector): cache match decisions
a4cd7457 test(doctor): force unavailable lsp binary branch in CI
5ae0db04 fix(websearch): use Bearer auth for Exa MCP
364c7fee docs: note team mode fresh install fix
36409270 docs: add team mode fresh install note
03f04ca3 test(shared): isolate logger test overrides
21b782de test(plugin): cover fresh install team mode tools
9bae8733 fix(plugin): log team tool registry state
e5653f16 fix(config): log resolved team mode state
9560e932 docs: correct tool directory counts and lsp alias wording
7e777b0c chore(mcp): ship vendored lsp cli in npm artifacts
69371b78 test(mcp): stabilize lsp builtin and doctor checks
f7b60e36 fix(mcp): harden lsp cli resolution and doctor disable checks
5555dbfc Merge pull request #4133 from code-yeongyu/fix/3816-frozen-output-args
b20e2c9c fix: refactor 5 additional aliased output.args mutations + strengthen audit test
61890f08 fix(rules-injector): bound parsed rule cache
46b965b9 fix(rules-injector): bound matcher cache
1ab1b54c perf(rules-injector): cache compiled glob matchers
a7e5a657 Merge pull request #4131 from code-yeongyu/fix/3563-effort-max-pre-set-clamp
3a63a8b2 test(shared): add audit test forbidding direct output.args mutation + fix 9th site
13d88574 refactor(hooks): replace direct output.args mutation with replaceToolArgs (question/webfetch/null-byte)
af66b8de refactor(hooks): replace direct output.args mutation with replaceToolArgs (env + prompt injectors)
63a30210 test(anthropic-effort): cover pre-set effort=max clamping for constrained providers (#3563)
96767b5d fix(anthropic-effort): clamp pre-set effort=max for constrained providers regardless of variant
f72bb3fe refactor(hooks): replace direct output.args mutation with replaceToolArgs (claude-code-hooks)
6bffb2c4 feat(shared): add replaceToolArgs helper for safe tool-args mutation
b149ce53 docs: update AGENTS docs for MCP-backed LSP architecture
54eb3963 chore(ci): init and build vendor lsp submodule in CI
48c827ff test: update plugin tests for MCP-backed LSP
8716ef45 refactor(plugin): drop lspManager lifecycle wiring
ca51f613 refactor(tools): remove native LSP tool registry wiring
c2c078fe feat(mcp): register lsp tier-1 stdio MCP server
d95a45c8 chore: add lsp-tools-mcp submodule at vendor/lsp-tools-mcp
34e6af1a docs: update AGENTS guidance
c4dd21e1 Merge pull request #4127 from code-yeongyu/fix/3997-notification-crash
baa0470e Merge pull request #3870 from cvqluu/fix/3772-log-bloat-and-epipe-suppression
6037b917 Merge pull request #4122 from mguttmann/fix-4120
442cdebc docs: add Deepgram to sponsor list in README files
755f380a docs: update AGENTS.md metadata for v4.2.0 release
397ed104 fix(hooks): guard session-notification against missing ctx.$ (refs #3997)
98bd6a8e Merge branch 'i18n' of github.com:leeyazhou/oh-my-openagent into i18n
669e7525 feat(i18n): add toast i18n with en/zh locale and plugin config support
a6bed0a5 Merge branch 'code-yeongyu:dev' into fredotran/dev
fbfbbd10 docs(README): rename title to Oh My OpenDevin
b5644643 docs: invert Standard and Fast/Cheap tier models
4713a908 fix(shared): cap log file growth via size-based rotation
32941282 fix(background-agent): defer parent-wake when a user message just arrived (fixes #4120)
36812ead docs(README): remove non-relevant upstream content
e0714ff8 docs(README): document Devin Session Watcher completion notifications
2ea670c8 feat(devin-watcher): wire completion notifications into parent session chat + OS
7285163c @ririnto has signed the CLA in code-yeongyu/oh-my-openagent#4117
19aaf5d3 fix(prompts): point planning guidance at plan subagent
a1630685 fix(delegate-task): restore hidden plan delegation
94f69926 chore(schema): regenerate with devin watcher config
a9d008db feat(devin-watcher): wire notifications, start/stop lifecycle
c7bd95c5 feat(devin-watcher): add barrel export
99df025e feat(devin-watcher): add core watcher with tests
532c7bb5 feat(devin-watcher): add notifier with tests
a620bb83 feat(devin-watcher): add meta-reader with tests
69cef656 feat(devin-watcher): add watcher types
caa28bf7 config: add devin watcher config schema
bb7cca8a docs: add implementation plan for devin session watcher
63815d40 docs: add design spec for devin session watcher
8bba7357 fix(glob,grep): keep exit-code gate at >1 — --no-messages alone is enough
e0d88ff2 Merge pull request #3713 from deopa0402/fix/stale-plugin-specifier-cache
a8ccffdd style(runtime-fallback): add explicit optional chain on .replace per review
e195a472 fix(glob,grep): tolerate broken symlinks and non-fatal I/O warnings
2bd79460 fix(non-interactive-env): use powershell syntax on Windows regardless of SHELL/MSYSTEM
b2f0d423 test(runtime-fallback): tighten quota regression fixtures so new paths actually fire
f357ed03 fix(runtime-fallback): classify more provider quota error names
bb117107 docs: regenerate DEVIN-FEATURES.md after upstream merge
165017e4 Merge remote-tracking branch 'upstream/dev' into fredotran/dev
6c54123e fix(slash-commands): inject command content exactly once (#3724)
97581686 test(auto-update): isolate cached version resolution
37d9d613 fix(auto-update): clean stale OMO cache roots
babee921 Merge pull request #4109 from code-yeongyu/code-yeongyu/unify-prompt-async-routes
7a3a0a03 test(tmux): ignore unrelated pane runner mock calls
0f92d2c9 test(prompt-gate): narrow audit binding detection
98df0a43 docs(prompt-gate): document unified dispatch invariant
6768decd fix(session-recovery): fallback when stored unavailable-tool parts are absent
12bd6580 refactor(prompt-async-gate): remove deprecated dispatch wrappers
1bbe065c refactor(prompt-callers): migrate shared and cli dispatch
989ab717 refactor(hooks): use unified internal prompt dispatch
dd3fecaf refactor(plugin): use unified internal prompt dispatch
fee515c5 refactor(prompt-callers): migrate team and call_omo_agent dispatch
df198d8b refactor(background-agent): use unified internal prompt dispatch
a42f894f refactor(prompt-async-gate): collapse dispatch into mode-based entrypoint
b5d24619 test(prompt-async-gate): pin unified internal prompt dispatch contract
f1a0ba20 Merge pull request #4108 from code-yeongyu/code-yeongyu/fix-idle-recovery-fanout
8bc49775 fix(slash-command): skip already tagged command output
55312cc4 fix(session-recovery): preflight idle recovery fanout
1fea761c Merge pull request #4106 from code-yeongyu/code-yeongyu/fix-stale-tool-hang
75ba7080 fix(team-mode): sync atomic writes through writable handle
a7b7ace7 fix(prompt-gate): block prompts into pending tool turns
6eb88a05 fix(session-recovery): prefer valid tool use ids
4d417a33 fix(process-cleanup): stop force-exiting opencode on transient unhandled errors
f43effb8 fix(session-recovery): recover interrupted idle tool turns
fbec112b fix(background-output): bound session.messages fetch to stop forever-hang during /init-deep
24261da8 Merge pull request #4103 from code-yeongyu/code-yeongyu/fix-prompt-hang-race
f4f1efcb fix(call-omo-agent): fail fast on lost prompts
ec371237 Merge remote-tracking branch 'origin/dev' into fix/task-id-prompt-surface
8c770db8 refactor(devin): keep devin as primary so it remains in TUI agent list
257ff0e2 refactor(devin): make devin a subagent instead of primary
89c5be3f ci: let auto-updater run through CI instead of skipping it
2057de4f refactor(devin-mcp): swap default model from kimi-k2.6 to swe-1.6
75223149 Merge pull request #4096 from code-yeongyu/kimi-k2.6
412ac045 docs: add debugging journal for prompt hang investigation
d8f365bf test(guard): add merge-conflict guard to prevent unresolved git conflicts in source files
38702f6e Merge pull request #4094 from code-yeongyu/fix/opus-4.7
a77312c3 test(atlas): exclude isSessionActive timeout from retry timer assertion
c142066f Merge pull request #4093 from code-yeongyu/k2p6-turbo
67ead7bf fix(dynamic-truncator): bound session.messages fetch to stop forever-hang on Read (#4086)
fcd0011a test(atlas): track active timers instead of scheduled delays in setTimeout mock
2613de52 fix(prompt-async-gate): timeout isSessionActive to prevent infinite hang on stale SDK status
36468b11 fix(shared): add timeout to isSessionActive to prevent infinite hang
169e61f7 test(audit): allowlist build-team-idle-wake-hint-client.ts in prompt route audit
a43215f2 fix(plugin/event): bind team-idle-wake-hint client methods to SDK Session
271878bc perf(rules-injector): cache full candidates and memoize ancestor scans
c25f7529 perf(rules-injector): cache project root for visited ancestors
f843f57c Merge pull request #4088 from code-yeongyu/fix/session-agent-map-cleanup
2b8782de fix(claude-code-session-state): clear session-agent map on delete and sync cleanup
25d80541 Merge pull request #4074 from code-yeongyu/fix/delegate-task-spawn
c9ec11dd bump comment-checker to 0.7.1
d3318617 fix(background-agent): clean child session-agent state on pre-start abort and normalize stored agent
cc97a023 test(agents): drop unsafe AgentFactory cast and add typed empty skills
791fbf3e refactor(delegate-task): share buildSyncPromptTools between bootstrap and prompt dispatch
ea5f6ddf fix(call-omo-agent): register bootstrap and session agent before sync prompt dispatch
097d7dc5 fix(background-agent): keep delegated skill, permission, and child agent across retries
ba648685 fix(runtime-fallback): carry delegated system and tools through bootstrap retry
761f682a refactor(delegated-bootstrap): accept optional system and tools
4f981384 feat: add ci test runner, session routing, bash parser, and test fixtures
166e5de0 @pizzav-xyz has signed the CLA in code-yeongyu/oh-my-openagent#4084
80fa177b Merge pull request #4075 from code-yeongyu/feature/migrate-sisyphus-to-omo
572c3c24 fix(notepad-guard): refuse Write tool for .sisyphus/notepads files (#3685)
7bc92bcd feat(agents): support per-agent displayName for i18n (#4004)
c5067d1e docs(mcp): clarify plugin-injected MCPs do not appear in opencode mcp list (#3469)
57ab749b refactor(keyword-detector): consolidate analyze pattern/message into analyze/default and document delegate_task params (#3694)
5e4d45a3 fix(todo-continuation-enforcer): stop looping after all todos complete (#4013)
6573bd94 chore(workspace): move test discipline rule to omo
5a2c3bbb fix(workspace): match omo guard paths cross-platform
b5992b13 test(shared): stabilize port utility interface check
cdac0d69 fix(workspace): report only the active notepad change
240a4a17 fix(workspace): harden omo migration review issues
fbc5768f Merge pull request #3971 from MoerAI/fix/task-examples-add-run-in-background
82ec099c fix(atlas): match omo as a path segment
63519ec5 docs(workspace): document omo workspace paths
f10f7963 fix(workspace): keep omo and legacy rules compatible
36e373cd feat(workspace): point planning guardrails at omo
a86221b1 feat(workspace): store runtime state under omo
5dca1a57 feat(workspace): migrate legacy sisyphus state to omo
7c2e2fe1 fix(background-agent): redact task registry views
982fa813 fix(delegate-task): start child prompts reliably
76e573a9 Merge pull request #4073 from code-yeongyu/fix/team-create-permission-inline-spec
d974cd3d test(hooks): repair stale retry harnesses
cf7bf9d0 fix(team-mode): accept legacy inline specs
a2054057 Merge pull request #4068 from code-yeongyu/feat/pre-publish-fix-v420
b516d5d4 fix(team-mode): preserve team membership across model fallback (#3898)
e25f3ca7 fix(tmux-subagent): drain terminal probe replies during delegated pane startup (#2887)
4c360054 fix(team-mode): reject team_create from hard-reject agents (#3987)
2bf50382 fix(team-mode): surface member error to main agent (#3923)
ced95c4b fix(team-mode): surface port-0 fallback and silent layout skip (#3963)
496e00b7 refactor(devin-mcp): rename fully-qualified model from swe-1-6 to swe-1.6
64f5dc43 feat(devin-mcp): add safety-net fallback to default model on quota exhaustion
f152569e feat(keyword-detector): add enabled_expansions config for allowlist control
6576cb12 refactor(agents): rename devin display name to Devin - CLI Executor
3f3a63c5 docs(changelog): v4.2.0 entry with known issues and supersession history
eba17441 test(mock-module-audit): require lifecycle cleanup for mock.module
aaa215c5 docs(release-process): add post-fix repro verification policy
3435c9be docs(adr): write prompt-async-gate ADR
102d0670 fix(model-suggestion-retry): release reservation on async error path
5a8bd05d test(prompt-async-gate): replace timer waits with deterministic sync (BLOCKER-3)
9dd52a04 docs(changelog): v4.2.0 entry covering BLOCKER + HIGH + KNOWN ISSUES
e68a0707 fix(test): update install test to check for oh-my-opendevin plugin name
5ba1fe44 fix(agents): add first-run fallback for Atlas agent registration
7779213a fix(installer): ensure plugin is recognized by OpenCode
80c0ea53 fix(cli): use PUBLISHED_PACKAGE_NAME for plugin config detection and registration
3477b600 refactor(installer): remove npm dependency, keep only local symlink installation
5c143741 fix(install-global): symlink into OpenCode node_modules for Electron runtime
dc98bb8d docs: update DEVIN-FEATURES.md with symlink fix and agent recognition fixes
9f5f46b1 fix: devin agent not recognized by OpenCode
7432181a feat(devin-mcp): add health/resumable tools, cost estimates, doctor check, and schema fixes
a576e895 ci: filter [skip ci] commits from DEVIN-FEATURES.md auto-updater
4cf56a40 fix(toast): show correct default agent in startup toast
6e13aec8 docs: update DEVIN-FEATURES.md with README commit
d2cbe3ca docs(readme): add Devin CLI Reliability section and update fork features
3e9d1780 docs: add model selection rationale and spawned CLI command to DEVIN-FEATURES.md
c4bb5d61 docs: update DEVIN-FEATURES.md with reliability pack and limit recovery features
48897669 docs(devin-mcp): update AGENTS.md with all reliability features
d054ca77 docs: update DEVIN-FEATURES.md — model disclosure now on first line
c277d125 feat(devin-mcp): put model info on first line of devin_start response
1663e6fa feat(devin-mcp): structured error hints + agent fallback chain for limit recovery
31bc2060 docs(superpowers): add devin limit/quota error recovery design spec
21da1278 feat(devin-mcp): reliability pack — max duration, log caps, error handling, schema fix
24ff702b docs(devin-mcp): remove stale references to deleted /devin and /devin-models slash commands
a7b5cdbe docs(superpowers): add devin-mcp-reliability-pack design
5b79c2bf docs: update DEVIN-FEATURES.md with latest fork features
b530e49b feat(devin-mcp): add stdin EOF handler for parent process crash detection
ccd77bba feat(devin-mcp): make model/tier info prominent in all tool outputs
6649ed60 feat(devin-cli): stronger guidance for very long tasks — tell user once, then be silent
70b5a6f0 feat(devin-cli): add dedicated guidance for very long tasks (Docker builds)
395d3c86 feat(devin-cli): add ultrawork safeguard and cleaner wait logging to skill template
e51e28d4 refactor(devin-mcp): extract shared tiers module + fix swe keyword tier mapping
6f6aba76 feat(devin-mcp): disclose resolved model+tier to user on delegation
cf33d011 fix(devin-mcp): cap devin_wait at 30s, guide agents to since_bytes polling
a1d4f205 feat(devin-mcp): add 5 resilience features for MCP server
2e808967 fix: anchor skip-ci detection to end of subject line
b0f1a0b4 fix: prevent auto-update commits from desyncing DEVIN-FEATURES.md
112281a2 fix: remove merge conflict markers from DEVIN-FEATURES.md and harden updater script
985202e7 test: fix additional fork-specific test failures
40a22767 test: fix fork-specific test failures on fredotran/dev
c9039bcc fix(reporter): strip trailing whitespace and flatten newlines before wrapping
911b58f2 feat(devin-mcp): write .meta.json with spawn command + model for each session
ac83f46f ci: fix failing CI on fredotran/dev
be29fa91 docs: add Devin CLI test reporter script and update DEVIN-FEATURES.md
0d0ca2e9 ci: extract fork-specific automation into dedicated fork-sync workflow
9ee16028  docs(readme): sync Devin CLI model section with DEVIN-FEATURES.md
587e20ae ci: verify installer runs `bun run build` end-to-end
9ca2183d docs: correct Last updated commit hash in DEVIN-FEATURES.md
7cbe1247 ci: add branch triggers, build verification, and installer checks
568fe3f6 Fix README architecture diagram alignment
a0f8adbf fix(installer): correct --uninstall flag variable name from DO_UNLINK to DO_UNINSTALL
9c432171 fix(devin): anchor MCP server cwd at module load time + recommend explicit cwd
6733a64e fix(devin): correct balanced tier model name to sonnet
14bf0dce docs: add DEVIN-FEATURES.md — comprehensive fork feature registry
b7a0b39c fix(devin): use resolvedModel for concurrency slot acquisition
b78335df docs(readme): document Devin CLI tiered model routing system
0f0983b6 feat(devin-cli): document model tier system in built-in skill
44e6cc98 feat(devin): add incremental polling instructions and model tier guidance
81d14cef feat(devin): optimize CLI calls and task management
a06ac805 feat(devin-mcp): default devin-cli model to kimi-k2.6
9a587b8f feat(devin): add 'devin do [task]' prompt recognition + remove deepseek-v4-flash from fallback
94a5240c fix(devin): restore original nemotron model name — nemotron-3-super-120b-a12b:free
226aeeb6 fix(devin): correct deepseek model name — deepseek-v4-flash
55778243 fix(model-resolution): auto-prefix provider for bare model names in config overrides
ac07cf43 fix(devin): use valid model IDs in fallback chain
9f469766 feat(devin): broaden fallback chain providers — remove opencode-only lock
ef8a1c65 docs(readme): fix indentation of paragraph after MCP JSON block
9bf8df18 feat(commands): remove /devin and /devin-models slash commands
839d307b feat(devin-cli): default permission_mode to dangerous — always bypass permission prompts
f32ad1e3 feat(devin): harden agent separation — enforce Devin never delegates to specialists
c3181e2e fix(devin): restrict fallback to free models and fix delegation prompt
00398b07 feat(devin): configure cheap/free OpenCode model fallbacks
4056080d feat(config): add devin to AgentOverridesSchema
3e77554d feat(run): show session resume hint on interrupt and completion
ddd4a9d1 fix(identity): set published package name to oh-my-opendevin
0ddd4cad fix(team-mode): cast test fixture ask return to satisfy Effect type
8f3776b9 docs(readme): document Devin x Sisyphus tag-team architecture
45941e86 feat(agents): promote Devin to primary default agent
7c7efd9b feat(agents): register Devin as a built-in subagent
1640edcc docs(readme): remove session alias system references
47d26b32 feat(devin-models): improve model selector display with tiers and examples
7dcd8304 fix(version-detection): recognize oh-my-opendevin package name for version toast
ab377863 fix(mcp): write .mcp.json to ~/.claude/ where the plugin actually reads
976e19ca feat(installer): auto-detect shell rc and source after PATH change
ab2611ca feat(installer): add config backup/restore for uninstall
c00d6568 fix(mcp): resolve MCP integration failures and harden security
f85b097c feat(mcp): add global MCP configuration for Devin server
884b3826 feat(installer): add fallback to local installation via symlinks
a8ddb728 refactor: change package name from scoped to unscoped
63f0cd4d docs: update README with comprehensive installation guide
b1d3350c chore: remove local development installation scripts
a166d63b feat(installer): add global installation script for npm package
29c6ad26 Revert 'feat(install): use fixed project path for global installation'
d4c77153 feat(install): use fixed project path for global installation
4c955b5a Fix README title: this is an oh-my-openagent fork
05754440 Reorganize README: put fork-specific content before base project
982d8851 Update README.md with fork-specific features
d3308804 Fix doctor check warning for local development installation
ddb848f4 Add local development installation script
8848b82d feat: add /devin slash commands for easier delegation in OpenCode
5ad2d38a fix: update model names to use specific versions (swe-1-6, claude-sonnet-4-6)
d1c3346a feat: add intelligent model selection guidance to devin-cli skill
b919cd83 feat: add devin-cli built-in skill for MCP delegation guidance
587c97a2 feat: add Devin CLI MCP server for background session delegation
7dbb34cd refactor(background-agent): wire ParentWakeNotifier into BackgroundManager
41ff7bca fix(background-agent): release prompt gate before agent fallback retry
209063e8 docs(known-issues): document delegate-task early-failure-fallback deferral
0f8902c4 docs(changelog): v4.2.0 entry
48480172 test(mock-module-audit): require lifecycle cleanup for mock.module
845d862b test(prompt-async-gate): replace setTimeout sleeps with deterministic sync
f8d6f2a2 docs(known-issues): document delegate-task PR #3825 revert deferral
c096a596 test(mock-module-audit): require lifecycle cleanup for mock.module
8914dab4 docs(known-issues): reference delegate fallback tracking issue
1590085f docs(release-process): add post-fix repro verification policy
0c27ecb1 docs(adr): write prompt-async-gate ADR
38732b42 docs(known-issues): document delegate-task empty-history fallback (BLOCKER-4)
0941ffe7 docs(release-process): add post-fix repro verification policy
ee6bc67c docs(adr): write prompt-async-gate ADR
d706587e docs(known-issues): document delegate-task early-failure-fallback deferral
ff1b15d5 fix(model-suggestion-retry): release reservation before retry attempt
c1ccf8d0 refactor(background-agent): introduce ParentWakeNotifier module
8c4cc09d test(prompt-async-route-audit): migrate to TypeScript AST walker
f93d7297 test(prompt-async-gate): cover dispatch timeout and post-dispatch error hold
b333a528 fix(prompt-async-gate): add dispatch timeout, shared runner, harden prefix release
a19c1bfc chore(release): bump version to 4.2.0
c067b0fc refactor(plugin-entry): move createPluginModule to testing module
1723a8b7 Merge pull request #3500 from Disaster-Terminator/fix/tmux-defer-attach-until-focus
e63c5b9a fix(tmux): require explicit active isolated window
1ff59f44 test(tmux): align pane-state runner format
d02cca44 test(tmux): align pane replace placeholder expectations
54a7256a test(tmux): align placeholder command expectations
91f1cf5f fix(tmux): pin pane commands to /bin/sh
8c5ca736 fix(tmux): sweep suffixed stale isolated sessions
0c8e546c fix(tmux): support manager-scoped isolated session names
4e3684eb fix(tmux): gate isolated pane activation on visible client focus
c63108d5 fix(tmux): track placeholder panes before attach readiness
688bb551 fix(tmux): defer subagent attach until pane focus
6e5a127f Merge pull request #3840 from EnochLi15/codex/fix-tool-execute-after-boundary
d1161399 fix tool execute after hook boundary
ad10450b Merge pull request #3841 from Momentum96/fix/background-manager-tmux-ordering
58681f6d test(tmux-subagent): assert waitForSessionReady gates executeActions
cc88bedd fix(doctor): emit warning when tui.json is registered but opencode.json is not
df64f325 @boris-gorbylev has signed the CLA in code-yeongyu/oh-my-openagent#4057
be25109f fix(continuation): skip internal user turns
c580b8f2 fix(session): ignore internal synthetic turns
e8de8b79 fix(team-mode): skip pending mailbox reinjection
e90ff805 fix(tmux): treat busy sessions as attachable
efb862ce fix(tmux): prefer real tmux when session env exists
5238dd48 fix(background-agent): start promptAsync before blocking tmux callback
a9a00325 Merge pull request #3497 from Disaster-Terminator/fix/reminder-hooks-preserve-state-across-compaction
291b1f7b test(reminder-hooks): clean up compaction regressions
672f5d6e fix(keyword-detector): skip synthetic turns
196f6512 fix(team-mode): defer live mailbox acks
392c20e5 test(reminder-hooks): make delete reset regression diagnostic
29e7e97d test(reminder-hooks): cover delegated sessions across compaction
3db1da1e fix(reminder-hooks): preserve suppression state across compaction
ae7ff3bb Merge pull request #3891 from wjiuxing/feat/chinese-error-patterns
3e9b125f test(runtime-fallback): cover localized provider errors
c206b168 feat: add Chinese error patterns to model-error-classifier
149a83d7 feat: add Chinese quota patterns to classifyErrorType
adfa8bef feat: add Chinese error patterns to RETRYABLE_ERROR_PATTERNS
e24e495a Merge pull request #3322 from RaviTharuma/fix/runtime-fallback-equivalent-skip
d9033d73 fix(runtime-fallback): keep variant in equivalence
f501c47c fix(runtime-fallback): skip equivalent claude aliases
f54888b2 Merge pull request #3576 from Disaster-Terminator/fix/background-busy-stall-detection
27788b4a fix(session-recovery): audit raw prompt aliases
4a1c260d test(todo-continuation): cover peer-message reservation holds
39fef204 fix(background-agent): resolve parent wake agent aliases
2bd4944b fix(prompt-gate): scope reservation releases
b6caa5d3 fix(background-agent): correct stall timeout guidance
189af23e fix(background-agent): detect stalled active sessions
2eec0d96 Merge pull request #3319 from EZotoff/fix/remove-activity-stagnation-bypass
65c12833 fix(todo-continuation): clean up idle event diagnostics
047ca069 test: rename test to reflect todo-only stagnation check
68e9d54f fix(todo-continuation): remove activity-based stagnation bypass
fe66c962 Merge pull request #4053 from code-yeongyu/supersede/3866-tool-result-schema
b504fb1d fix(tool-pair-validator): emit schema-compatible synthetic tool results
0465562f fix(tmux-subagent): wait for session readiness before spawning attach pane
24f7e560 Merge pull request #4051 from code-yeongyu/supersede/3952-first-prompt-watchdog
3199bd3d fix(runtime-fallback): broaden watchdog progress detection + harden test timing
78ae2402 fix(doctor): detect plugin version via require.resolve fallback
a130fa70 fix(runtime-fallback): add first-prompt watchdog for stuck subagents
bda0452b Merge pull request #4029 from sandikodev/fix/json-error-recovery-exclude-todowrite
f835244d Merge pull request #4047 from PeterPonyu/fix/3894-skip-tmux-layout-when-server-unreachable
e66d60f4 Merge pull request #3773 from cailgarrisk-collab/fix/glm-rate-limit-fallback-statuscode
5cda8b8f Merge pull request #3330 from codeg-dev/fix/isplan-display-name-getAgentConfigKey
a3283436 Merge pull request #3299 from kilhyeonjun/fix/claude-code-settings-hooks-not-executed
0036c203 Merge pull request #3934 from Qihao0v0/fix/unifyllm-quota-classifier
c6054af9 Merge pull request #3872 from x-x-gpu/dev
7da44232 Merge pull request #4049 from code-yeongyu/supersede/3790-session-firstmessage-no-clear
9f6b6811 fix(hooks): do not clear sessionFirstMessageProcessed on session.idle
08959d63 feat(doctor): warn when oh-my-openagent/tui is missing from tui.json
bd3928e1 fix(team-mode): skip tmux layout when opencode server unreachable
ac66a43e Merge pull request #4046 from code-yeongyu/fix/3494-strip-zwsp-before-promptasync
7caf74a9 fix(atlas,todo-continuation): strip ZWSP sort prefix before promptAsync agent
2b43147c Merge pull request #4045 from code-yeongyu/supersede/3901-call-omo-agent-display-name
10f721de fix(call-omo-agent): translate config-key subagent_type to display name before SDK dispatch
437a8edb Merge pull request #4007 from PeterPonyu/feat/runtime-fallback-internal-abort
5e7ee941 Merge pull request #3982 from jas32096/fix/category-fallback-ignored-when-primary-set
83ab0009 Merge pull request #3972 from MoerAI/fix/circuit-breaker-tool-input-fallback
e2b8e49e Merge pull request #4044 from code-yeongyu/revert/3825-delegated-bootstrap
3c7d1299 Revert "Merge pull request #3825 from tw-yshuang/fix/delegated-child-session-early-failure-fallback"
cd33f3a3 Merge pull request #3825 from tw-yshuang/fix/delegated-child-session-early-failure-fallback
521c99cf Merge pull request #3950 from ismetanin/fix/surface-subagent-quota-error
f00a6939 Merge pull request #3947 from MoerAI/fix/process-cleanup-opt-out-env
c3319c75 Merge pull request #3470 from omer-koren/fix/thinking-block-modified-recovery
984b8c1a Merge pull request #4032 from PeterPonyu/fix/3996-tool-pair-validator-background-sessions
15b0a41f Merge pull request #4043 from code-yeongyu/fix/session-recovery-stale-error-dedupe
8e9dea94 fix(session-recovery): persist dedupe across stale repeated session.error
cb873850 test(ci): isolate runtime and rules dependencies
a02686e7 test(ci): remove suite-order mock coupling
f1fb1e08 fix(ralph-loop): send registered agent display name on continue
b3b2da89 test(ci): avoid global module mock leaks
8dcbccf0 fix(tmux): inject pane action dependencies
7a94cc72 fix(background-agent): stabilize parent wakes
c0544a70 fix(background-agent): defer retry notifications
462b55ef Merge pull request #4040 from code-yeongyu/cleanup/typescript-ai-slop-20260515
b6a0be56 test: remove decorative dividers
a9886ccb refactor(plugin): remove metadata assertions
0a3d1875 refactor(tools): narrow optional values
d92e78c9 refactor(sdk): narrow response fallbacks
4785767a refactor(interactive-bash): reuse tmux parser
d8f52aae test: run suite without split runner
150ccefa fix(delegate-task): allow hidden plan task
c25cb8dc fix(background-task): clarify task id contracts
15e7330f fix(team-mode): gate status injection by keyword
1e7a7a22 Merge pull request #4037 from code-yeongyu/fix/internal-initiator-dedupe
cd1c1a59 fix(background-agent): avoid branched parent wakes
9f6d0d22 docs(agents-md): refresh hierarchical knowledge base for v4.1.2
3dd8a5ca chore(rules): forbid flaky tests, time sleeps, and prompt pinning
53a74063 no prompt async
ced722e2 Merge pull request #4034 from code-yeongyu/fix/promptasync-duplicate-output
c2aa180e fix(prompt-gate): pin duplicate prompt dispatches
05189700 fix(prompt-gate): hold reservations after dispatch
c6e3b7e1 docs(agents-md): warn on prompt injection
edf3e530 fix(hooks): gate sync injected prompts
0b48f805 fix(call-omo-agent): gate reused sync prompts
439e7283 fix(runtime-fallback): gate retry prompts
30adce9c fix(prompt-gate): share message reservations
dd6271bb fix(babysitter): gate reminder prompts
a524754e fix(todo-continuation): gate idle prompts
b0b61182 fix(ralph-loop): gate continuation prompts
960baf39 fix(atlas): gate boulder continuation prompts
b0a484b4 fix(session-recovery): gate resume prompts
db28a32c fix(recovery): gate compaction prompts
c75f5488 fix(fallback): gate model retry prompts
f1a62a9c fix(team-mode): gate member wake prompts
174cbd0f fix(background-agent): gate parent wake prompts
b2fdd728 fix(prompt-async): add session idle gate
2567415a Merge pull request #4033 from code-yeongyu/perf/ci-test-build-time-20260515
e80c2811 ci: fail closed on sharded test gate
7ae8207a Merge pull request #4030 from code-yeongyu/fix/promptasync-concurrency-20260515
23dfe7ee fix(fallback): skip duplicate fallback re-arms
fdd40815 ci: split test workflow across shards
53de295b perf(ci): add sharded test runner phases
b7482ea7 test(fallback): type chat output assertions
26bb6231 fix(fallback): preserve provider-specific fallback retries
005d16dd fix(fallback): dedupe providerless fallback errors
da339204 fix(fallback): dedupe overlapping fallback continuations
e8a64088 feat(config): add disabled_providers schema + helper
17030b9a Prevent subagent repair from corrupting background sessions
c6c7a103 Merge pull request #4015 from code-yeongyu/fix/background-output-bg-id-20260514
8f90c1e9 fix(background-task): log missing output retry
d0355590 @sandikodev has signed the CLA in code-yeongyu/oh-my-openagent#4029
c76ac27e fix(json-error-recovery): add todowrite/todoread to JSON_ERROR_TOOL_EXCLUDE_LIST
ec49d6af fix(process-cleanup): call process.exit() after SIGTERM cleanup
bd2f1055 @scw1109 has signed the CLA in code-yeongyu/oh-my-openagent#4020
ec7168eb fix: respect default_agent in sort shim ordering (#3900)
d8652863 Merge remote-tracking branch 'origin/dev' into fix/background-output-bg-id-20260514
ca178f41 Merge pull request #4016 from code-yeongyu/fix-bg-noti-coalesce
9b279d2f chore(deps): sync lockfile metadata
8ea1e0fd chore: sync bun.lock with v4.1.2 release
268c89c9 fix(background-agent): coalesce rapid-fire idle parent notifications
1ea192b3 fix(background-task): retry transient missing output tasks
b9beea10 feat(team-mode): drive immediate teardown and recreate-to-reshape loop
a960f44a Merge branch 'i18n' of github.com:leeyazhou/oh-my-openagent into i18n
fd4b3bb3 feat(i18n): add toast i18n with en/zh locale and plugin config support
c75deee5 release: v4.1.2
9a1f8f67 fix(web): route installation links to docs section
63ced1d2 Merge pull request #4010 from code-yeongyu/chore/safe-tooling-upgrades-biome-tsgo-20260514-132516
96d72495 Merge pull request #4009 from code-yeongyu/fix/ralph-loop-compaction-race
f10251b5 chore(tooling): refresh safe deps and checks
9e618526 fix(ralph-loop): guard compaction continuation ownership
72bac14a @clousky2020 has signed the CLA in code-yeongyu/oh-my-openagent#4005
d16d47a0 docs: complete v4.1.1 drift sweep in reference and guide docs
98242ba6 docs(i18n+web): align translated READMEs and landing copy with v4.1.1 hook count
8cc3c320 docs: refresh user-facing docs to match v4.1.1 codebase
1e7a7600 docs(agents-md): regenerate hierarchical AGENTS.md knowledge base for v4.1.1
5b99a87c fix(runtime-fallback): preserve attemptCount when our own abort is the cause (closes #4006)
5ffbe0e2 fix(fallback): guard duplicate prompt injections
ea55c385 fix(background-agent): defer busy parent notifications
6e841773 @PeterPonyu has signed the CLA in code-yeongyu/oh-my-openagent#3871
f9b95f9e Merge pull request #3993 from code-yeongyu/fix/non-interactive-env-windows-shell
43b2d0e0 Merge pull request #3992 from MoerAI/fix/omo-block-native-execution-delegation
47d60a74 fix(non-interactive-env): honor Windows ComSpec shell
95cc9e2d [sisyphus-dev] fix(delegate-task): canonicalize agent dedup key to close hidden filter bypass
fef1d453 fix(non-interactive-env): respect Windows command shell
7469cb3f ci: skip cla for signed contributors
cab20568 fix(deps): sync platform lock entries
4bd81d2c fix(delegate-task): exclude hidden agents from task delegation discovery (fixes #3957)
61ba4e3b fix(ralph-loop): guard delayed start snapshots
1fa97c6e docs(publish): require discord announcement
f44d9441 release: v4.1.1
3b4d2431 fix(hooks): guard stale idle prompts
a337635e fix(background-agent): defer active parent wakes
0b99168b @EmiyaKiritsugu3 has signed the CLA in code-yeongyu/oh-my-openagent#3990
39fb0143 Merge pull request #3986 from code-yeongyu/fix/continuation-message-dispatch
36f51ddb fix(continuation): mark fallback resumes synthetic
1189b96d fix(continuation): mark atlas resumes synthetic
e49ba947 chore(deps): refresh platform lock entries
38b1433f fix(continuation): mark resumes synthetic
3f922643 fix(interactive-bash): prohibit tmux kill-server
099e126b Merge branch 'i18n' of github.com:leeyazhou/oh-my-openagent into i18n
6ffea1bc feat(i18n): add toast i18n with en/zh locale and plugin config support
286f5ccf when publish always discord
9edaa6e9 release: v4.1.0
21460713 .opencode to .agents
a0b46309 remove hyperplan for .opencode (not as a feature)
711b7534 fix(delegate-task): honor user fallback_models when category primary is unreachable
83c3379b Merge branch 'dev' into fix/surface-subagent-quota-error
12f52338 merge(dev): resolve latest manager and runtime-fallback conflicts
771242ea fix(start-work): prefer nested session plan refs
d22bd71d fix(start-work): narrow existing state before resume
063ba466 fix(start-work): prefer current session plan
b430524a feat(start-work): add session plan affinity lookup
5cd95cf5 fix(background-agent): fall back to partInfo.input when state.input is unavailable for circuit breaker (fixes #3962)
c4e88d63 fix(agents): add run_in_background to category task() examples in prompts (fixes #3960)
75825eb9 fix(todo-description-override): add OpenCode schema contract for string priorities
c740ed8a fix(delegate-task): route sync prompts by directory
6035a551 fix(background-agent): route session prompts by directory
1e1f574b merge(dev): resolve latest sync-task conflict for delegated fallback PR
ecb92c1e fix(runtime-fallback): abort stuck subagent on quota error with no fallback
dd68f324 fix(background-agent): add OMO_DISABLE_PROCESS_CLEANUP env opt-out for global handlers (fixes #3856)
cd39f885 fix(display): lowercase 'ultraworker' to avoid ZWSP rendering glitch in OpenCode TUI
a4fde034 fix: replace brittle setTimeout(50) with polling waitForCondition in spawner tests
583fa242 fix(runtime-fallback): classify localized balance failures
74171b91 merge(dev): resolve background-agent delegated fallback conflicts
291eeed8 fix(delegate-task): preserve late background session wiring on abort
6fd31a99 feat(i18n): add toast i18n with en/zh locale and plugin config support
ecd9d2a0 fix(test): stabilize opencode command dir assertions across environments
66a1a9ad fix(test): address review follow-ups for config dir layering
8d5dd908 fix(plugin-config): merge user config from default and custom opencode dirs
850dc3a4 fix(agent-loader): load opencode global agents from both config roots
71025dae fix(shared): add additive opencode config directory discovery
0b9cc80e fix: pass resolved model to session.create so sub-agent sessions use the correct model
fac90d69 fix(delegate-task): harden child-session fallback bootstrap and cleanup
87ad159b fix(prompt): prefer edit tool for gpt-5.4 juniors
a26117d9 fix: resolve ${CLAUDE_PLUGIN_ROOT} in plugin commands, agents, and skills
61d2f119 fix(model-fallback): add HTTP statusCode check for GLM rate limit fallback
bcc554bb fix(schema): preserve custom agent overrides via catchall
fd0e6e21 Merge remote-tracking branch 'origin/dev' into fix/git-bash-shell-detection-on-windows
0996d68d Fix interceptor auth injection binding
ee500ad7 Fix interceptor auth injection on Windows
ff9c3e0e test(atlas): assert task_id guidance in reminder
64a29118 fix(prompts): prefer task_id in continuation guidance
b6ad494f fix(session-recovery): detect and recover from 'thinking block modified' errors
998dbde2 fix: detect Git Bash/WSL/MSYS2 shell on Windows before PSModulePath
23d12575 fix(delegate-task): apply getAgentConfigKey normalization to isPlanAgent
6c3308aa fix: treat zero limit.output as unknown to enable fallback to bundled snapshot
fe1cfd88 fix: preserve accumulated modifiedInput and common fields on deny/ask from exit code paths
5d8bd99f fix: accumulate modifiedInput and common fields from allow hooks
e0d611ae revert: remove incorrect claudeCodeHooks override in createHooks, add pre-tool-use tests
5aeb5688 fix: don't early-return on 'allow' in executePreToolUseHooks
3b5745a6 fix: wire claudeCodeHooks into createHooks() to enable .claude/settings.json hooks
02d64e44 test(doctor): cover custom provider config regression
14c25cbb feat(background-task): make taskCleanupDelayMs configurable
cb53cba8 merge: resolve conflicts with dev branch
c507ce7c fix(doctor): improve opencode binary detection for WSL
28b0a757 fix(package): add ./server export for OpenCode-Go plugin compatibility
607fce17 fix(context-injector): prefix synthetic part ids with prt_
d66b6bcb fix(prometheus): complete OpenSpec command reference, fix Gemini self-containment, strengthen tests
69f4fed0 fix(prometheus): remove BMAD active detection, add missing spec-awareness tests
8ff41232 feat(prometheus): add spec-driven development framework awareness
```

---

*Generated with [Devin](https://cli.devin.ai/docs)*
