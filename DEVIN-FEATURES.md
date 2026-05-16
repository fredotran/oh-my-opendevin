# Oh My Opendevin — Fork-Specific Features

**Generated:** 2026-05-13  
**Fork branch:** `fredotran/dev`  
**Upstream:** `dev`  
**Since commit:** `7d09d2c8` (last upstream merge before fork divergence)  
**Last updated:** `64f5dc43`

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
| **Fast/Cheap** | `"swe"` | `swe-1-6` | Simple edits, typos, single-file fixes |
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
  - `--model` accepts both keywords (`"opus"`, `"sonnet"`, `"swe"`, `"codex"`) and fully-qualified IDs (`"swe-1-6"`)
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
- **What:** Default Devin CLI model changed from `swe-1-6` to `kimi-k2.6` for better capability/cost balance.

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
- **Fallback chain:** `opus` → `sonnet` → `kimi-k2.6` → `swe-1-6` (Deep → Balanced → Standard → Fast/Cheap). Exported as `FALLBACK_CHAIN` with `getFallbackModel(current)` utility. When the chain is exhausted, `getFallbackModel` loops back to the default model `kimi-k2.6` for a safety-net retry, then `swe-1-6` again before giving up.
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
  5. Both tier keywords (`"swe"`, `"codex"`, `"sonnet"`, `"opus"`) and fully-qualified model IDs (`"swe-1-6"`, etc.) are recognized — sessions started with either form display the correct tier.
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
64f5dc43 feat(devin-mcp): add safety-net fallback to default model on quota exhaustion
6576cb12 refactor(agents): rename devin display name to Devin - CLI Executor
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
119128fb ci: auto-update DEVIN-FEATURES.md on push to fredotran/dev
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
24f7e560 Merge pull request #4051 from code-yeongyu/supersede/3952-first-prompt-watchdog
3199bd3d fix(runtime-fallback): broaden watchdog progress detection + harden test timing
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
17030b9a Prevent subagent repair from corrupting background sessions
c6c7a103 Merge pull request #4015 from code-yeongyu/fix/background-output-bg-id-20260514
8f90c1e9 fix(background-task): log missing output retry
d0355590 @sandikodev has signed the CLA in code-yeongyu/oh-my-openagent#4029
c76ac27e fix(json-error-recovery): add todowrite/todoread to JSON_ERROR_TOOL_EXCLUDE_LIST
bd2f1055 @scw1109 has signed the CLA in code-yeongyu/oh-my-openagent#4020
d8652863 Merge remote-tracking branch 'origin/dev' into fix/background-output-bg-id-20260514
ca178f41 Merge pull request #4016 from code-yeongyu/fix-bg-noti-coalesce
9b279d2f chore(deps): sync lockfile metadata
8ea1e0fd chore: sync bun.lock with v4.1.2 release
268c89c9 fix(background-agent): coalesce rapid-fire idle parent notifications
1ea192b3 fix(background-task): retry transient missing output tasks
b9beea10 feat(team-mode): drive immediate teardown and recreate-to-reshape loop
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
286f5ccf when publish always discord
9edaa6e9 release: v4.1.0
21460713 .opencode to .agents
a0b46309 remove hyperplan for .opencode (not as a feature)
711b7534 fix(delegate-task): honor user fallback_models when category primary is unreachable
83c3379b Merge branch 'dev' into fix/surface-subagent-quota-error
12f52338 merge(dev): resolve latest manager and runtime-fallback conflicts
5cd95cf5 fix(background-agent): fall back to partInfo.input when state.input is unavailable for circuit breaker (fixes #3962)
75825eb9 fix(todo-description-override): add OpenCode schema contract for string priorities
c740ed8a fix(delegate-task): route sync prompts by directory
6035a551 fix(background-agent): route session prompts by directory
1e1f574b merge(dev): resolve latest sync-task conflict for delegated fallback PR
ecb92c1e fix(runtime-fallback): abort stuck subagent on quota error with no fallback
dd68f324 fix(background-agent): add OMO_DISABLE_PROCESS_CLEANUP env opt-out for global handlers (fixes #3856)
583fa242 fix(runtime-fallback): classify localized balance failures
74171b91 merge(dev): resolve background-agent delegated fallback conflicts
291eeed8 fix(delegate-task): preserve late background session wiring on abort
0b9cc80e fix: pass resolved model to session.create so sub-agent sessions use the correct model
fac90d69 fix(delegate-task): harden child-session fallback bootstrap and cleanup
61d2f119 fix(model-fallback): add HTTP statusCode check for GLM rate limit fallback
b6ad494f fix(session-recovery): detect and recover from 'thinking block modified' errors
23d12575 fix(delegate-task): apply getAgentConfigKey normalization to isPlanAgent
fe1cfd88 fix: preserve accumulated modifiedInput and common fields on deny/ask from exit code paths
5d8bd99f fix: accumulate modifiedInput and common fields from allow hooks
e0d611ae revert: remove incorrect claudeCodeHooks override in createHooks, add pre-tool-use tests
5aeb5688 fix: don't early-return on 'allow' in executePreToolUseHooks
3b5745a6 fix: wire claudeCodeHooks into createHooks() to enable .claude/settings.json hooks
```

---

*Generated with [Devin](https://cli.devin.ai/docs)*
