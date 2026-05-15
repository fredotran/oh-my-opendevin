# Oh My Opendevin — Fork-Specific Features

**Generated:** 2026-05-13  
**Fork branch:** `fredotran/dev`  
**Upstream:** `dev`  
**Since commit:** `7d09d2c8` (last upstream merge before fork divergence)  
**Last updated:** `00fe2539`

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
- **Fallback chain:** `opus` → `sonnet` → `kimi-k2.6` → `swe` (Deep → Balanced → Standard → Fast/Cheap). Exported as `FALLBACK_CHAIN` with `getFallbackModel(current)` utility.
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
00fe2539 fix(installer): ensure plugin is recognized by OpenCode
58eb1b85 fix(cli): use PUBLISHED_PACKAGE_NAME for plugin config detection and registration
1c9570a8 Merge branch 'fredotran/dev' of github.com:fredotran/oh-my-opendevin into fredotran/dev
1a3fd3a4 refactor(installer): remove npm dependency, keep only local symlink installation
c160b52a fix(install-global): symlink into OpenCode node_modules for Electron runtime
74e343f9 docs: update DEVIN-FEATURES.md with symlink fix and agent recognition fixes
72347a36 fix: devin agent not recognized by OpenCode
44c1a442 feat(devin-mcp): add health/resumable tools, cost estimates, doctor check, and schema fixes
8e2d732f ci: filter [skip ci] commits from DEVIN-FEATURES.md auto-updater
575bddf9 fix(toast): show correct default agent in startup toast
c323b6b1 docs: update DEVIN-FEATURES.md with README commit
1fac2095 docs(readme): add Devin CLI Reliability section and update fork features
48e451af docs: add model selection rationale and spawned CLI command to DEVIN-FEATURES.md
79e50cbb docs: update DEVIN-FEATURES.md with reliability pack and limit recovery features
6dd71484 docs(devin-mcp): update AGENTS.md with all reliability features
f6cf6532 docs: update DEVIN-FEATURES.md — model disclosure now on first line
8a120f41 feat(devin-mcp): put model info on first line of devin_start response
283d1440 feat(devin-mcp): structured error hints + agent fallback chain for limit recovery
caa99dc3 docs(superpowers): add devin limit/quota error recovery design spec
a6892032 feat(devin-mcp): reliability pack — max duration, log caps, error handling, schema fix
2492b81a docs(devin-mcp): remove stale references to deleted /devin and /devin-models slash commands
b7797d43 docs(superpowers): add devin-mcp-reliability-pack design
2fd4b76b docs: update DEVIN-FEATURES.md with latest fork features
1db2ce97 feat(devin-mcp): add stdin EOF handler for parent process crash detection
803332bb feat(devin-mcp): make model/tier info prominent in all tool outputs
95fdcf67 feat(devin-cli): stronger guidance for very long tasks — tell user once, then be silent
fca188fa feat(devin-cli): add dedicated guidance for very long tasks (Docker builds)
9ceec636 feat(devin-cli): add ultrawork safeguard and cleaner wait logging to skill template
00eeeeb4 refactor(devin-mcp): extract shared tiers module + fix swe keyword tier mapping
275f7bb8 feat(devin-mcp): disclose resolved model+tier to user on delegation
32963465 fix(devin-mcp): cap devin_wait at 30s, guide agents to since_bytes polling
2de60da6 feat(devin-mcp): add 5 resilience features for MCP server
648e03c4 fix: anchor skip-ci detection to end of subject line
7be3dea7 fix: prevent auto-update commits from desyncing DEVIN-FEATURES.md
c0a0edf6 fix: remove merge conflict markers from DEVIN-FEATURES.md and harden updater script
1446a64a test: fix additional fork-specific test failures
7884ffc1 test: fix fork-specific test failures on fredotran/dev
23795ba7 fix(reporter): strip trailing whitespace and flatten newlines before wrapping
57595368 feat(devin-mcp): write .meta.json with spawn command + model for each session
8be9d69d ci: fix failing CI on fredotran/dev
99f129f1 docs: add Devin CLI test reporter script and update DEVIN-FEATURES.md
2762b419 fix: regenerate bun.lock for renamed package oh-my-opendevin
5374954c ci: extract fork-specific automation into dedicated fork-sync workflow
8c27070b ci: auto-update DEVIN-FEATURES.md on push to fredotran/dev
d7a4719c  docs(readme): sync Devin CLI model section with DEVIN-FEATURES.md
76519775 ci: verify installer runs `bun run build` end-to-end
451179bc docs: correct Last updated commit hash in DEVIN-FEATURES.md
575f309c ci: add branch triggers, build verification, and installer checks
41d4e507 Fix README architecture diagram alignment
6725189c fix(installer): correct --uninstall flag variable name from DO_UNLINK to DO_UNINSTALL
91432ae0 fix(devin): anchor MCP server cwd at module load time + recommend explicit cwd
9fe75f3c fix(devin): correct balanced tier model name to sonnet
1a953000 docs: add DEVIN-FEATURES.md — comprehensive fork feature registry
eacc32dc fix(devin): use resolvedModel for concurrency slot acquisition
d8ee20b9 docs(readme): document Devin CLI tiered model routing system
f78a1683 feat(devin-cli): document model tier system in built-in skill
19d155e5 feat(devin): add incremental polling instructions and model tier guidance
b6609303 feat(devin): optimize CLI calls and task management
761792bd feat(devin-mcp): default devin-cli model to kimi-k2.6
532a5c32 feat(devin): add 'devin do [task]' prompt recognition + remove deepseek-v4-flash from fallback
56855f38 fix(devin): restore original nemotron model name — nemotron-3-super-120b-a12b:free
1ec5e6ea fix(devin): correct deepseek model name — deepseek-v4-flash
ade36c0b fix(model-resolution): auto-prefix provider for bare model names in config overrides
ce1b65ef fix(devin): use valid model IDs in fallback chain
d1a1e105 feat(devin): broaden fallback chain providers — remove opencode-only lock
e791dc18 docs(readme): fix indentation of paragraph after MCP JSON block
048d8991 feat(commands): remove /devin and /devin-models slash commands
8b2dbd30 feat(devin-cli): default permission_mode to dangerous — always bypass permission prompts
cd1f26bd feat(devin): harden agent separation — enforce Devin never delegates to specialists
d35495d6 fix(devin): restrict fallback to free models and fix delegation prompt
e1c6160f feat(devin): configure cheap/free OpenCode model fallbacks
488a7575 feat(config): add devin to AgentOverridesSchema
5487a58b feat(run): show session resume hint on interrupt and completion
ff43fead fix(identity): set published package name to oh-my-opendevin
dfd69860 fix(team-mode): cast test fixture ask return to satisfy Effect type
d6a30d6f docs(readme): document Devin x Sisyphus tag-team architecture
b7350049 feat(agents): promote Devin to primary default agent
8d03b99d feat(agents): register Devin as a built-in subagent
d837fd44 docs(readme): remove session alias system references
03c2ec13 feat(devin-models): improve model selector display with tiers and examples
ff640217 fix(version-detection): recognize oh-my-opendevin package name for version toast
973eb916 fix(mcp): write .mcp.json to ~/.claude/ where the plugin actually reads
25d76aa0 feat(installer): auto-detect shell rc and source after PATH change
c6db5767 feat(installer): add config backup/restore for uninstall
1fc3f57d fix(mcp): resolve MCP integration failures and harden security
b947e452 feat(mcp): add global MCP configuration for Devin server
ab735c8e feat(installer): add fallback to local installation via symlinks
2b9dc575 refactor: change package name from scoped to unscoped
896670da docs: update README with comprehensive installation guide
216c2e73 chore: remove local development installation scripts
8c34e139 feat(installer): add global installation script for npm package
99956ba4 Revert 'feat(install): use fixed project path for global installation'
fb1f37c3 feat(install): use fixed project path for global installation
3206fc29 Fix README title: this is an oh-my-openagent fork
183768bf Reorganize README: put fork-specific content before base project
16347494 Update README.md with fork-specific features
32b146d6 Fix doctor check warning for local development installation
71c57855 Add local development installation script
491f9aea feat: add /devin slash commands for easier delegation in OpenCode
9c7a9244 fix: update model names to use specific versions (swe-1-6, claude-sonnet-4-6)
99011cf6 feat: add intelligent model selection guidance to devin-cli skill
ee2fa4c9 feat: add devin-cli built-in skill for MCP delegation guidance
23193a47 feat: add Devin CLI MCP server for background session delegation
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
75825eb9 fix(todo-description-override): add OpenCode schema contract for string priorities
c740ed8a fix(delegate-task): route sync prompts by directory
6035a551 fix(background-agent): route session prompts by directory
```

---

*Generated with [Devin](https://cli.devin.ai/docs)*
