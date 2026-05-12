# Oh My Opendevin — Fork-Specific Features

**Generated:** 2026-05-12  
**Fork branch:** `fredotran/dev`  
**Upstream:** `dev`  
**Since commit:** `7d09d2c8` (last upstream merge before fork divergence)  
**Last updated:** `e0e7139b`

This document tracks all features, fixes, and architectural changes added in the `oh-my-opendevin` fork that are not present in the upstream `oh-my-openagent` project.

---

## Table of Contents

1. [Devin CLI Integration](#devin-cli-integration)
2. [Devin Agent](#devin-agent)
3. [Model System](#model-system)
4. [Installation & Distribution](#installation--distribution)
5. [Developer Experience](#developer-experience)
6. [Performance Optimizations](#performance-optimizations)

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

## Test Coverage

| Suite | Tests | Status |
|-------|-------|--------|
| `src/mcp-servers/devin/session-store.test.ts` | 10 | Pass — cache, batch cancel, incremental reads |
| `src/features/background-agent/manager.test.ts` | 157 | Pass — priority queue integration |
| `src/features/builtin-skills/skills.test.ts` | 17 | Pass — skill structure validation |
| **Total** | **184** | **0 failures** |

---

## Full Commit Log

```
e0e7139b fix: prevent auto-update commits from desyncing DEVIN-FEATURES.md
2fd9043d fix: remove merge conflict markers from DEVIN-FEATURES.md and harden updater script
408bfb28 docs: auto-update DEVIN-FEATURES.md [skip ci]
9b69476f test: fix additional fork-specific test failures
86f4389a docs: auto-update DEVIN-FEATURES.md [skip ci]
a49d0717 test: fix fork-specific test failures on fredotran/dev
d86084fc docs: auto-update DEVIN-FEATURES.md [skip ci]
39aa4154 Merge branch 'fredotran/dev' of github.com:fredotran/oh-my-opendevin into fredotran/dev
f3122e4f fix(reporter): strip trailing whitespace and flatten newlines before wrapping
a392c6a2 docs: auto-update DEVIN-FEATURES.md [skip ci]
f0d061e0 Merge branch 'fredotran/dev' of github.com:fredotran/oh-my-opendevin into fredotran/dev
5aafca52 feat(devin-mcp): write .meta.json with spawn command + model for each session
120b8cac docs: auto-update DEVIN-FEATURES.md [skip ci]
be21247d ci: fix failing CI on fredotran/dev
e675586c docs: auto-update DEVIN-FEATURES.md [skip ci]
dcefd6ff docs: add Devin CLI test reporter script and update DEVIN-FEATURES.md
a234d44b fix: regenerate bun.lock for renamed package oh-my-opendevin
7c10441b docs: auto-update DEVIN-FEATURES.md [skip ci]
336ba20b ci: extract fork-specific automation into dedicated fork-sync workflow
0c5f58a7 ci: auto-update DEVIN-FEATURES.md on push to fredotran/dev
82c0d34f  docs(readme): sync Devin CLI model section with DEVIN-FEATURES.md
da323e1f ci: verify installer runs `bun run build` end-to-end
3b9c8013 docs: correct Last updated commit hash in DEVIN-FEATURES.md
55bf204f ci: add branch triggers, build verification, and installer checks
9e22df98 Fix README architecture diagram alignment
926a308e Merge branch 'fredotran/dev' of github.com:fredotran/oh-my-opendevin into fredotran/dev
7fa5f766 Merge branch 'feature/devin-cwd-roaming-fix' into fredotran/dev
28e345cc fix(devin): anchor MCP server cwd at module load time + recommend explicit cwd
1dcabc21 fix(installer): correct --uninstall flag variable name from DO_UNLINK to DO_UNINSTALL
7eb7a9d5 fix(devin): correct balanced tier model name to sonnet
5435f58c docs: add DEVIN-FEATURES.md — comprehensive fork feature registry
f2197075 fix(devin): use resolvedModel for concurrency slot acquisition
870bfa41 docs(readme): document Devin CLI tiered model routing system
8d5e1a37 feat(devin-cli): document model tier system in built-in skill
f91eb037 feat(devin): add incremental polling instructions and model tier guidance
ec5e4060 Merge branch 'feature/devin-cli-optimizations' into fredotran/dev
71b66abb feat(devin): optimize CLI calls and task management
e5bdb26a feat(devin-mcp): default devin-cli model to kimi-k2.6
48718a34 feat(devin): add 'devin do [task]' prompt recognition + remove deepseek-v4-flash from fallback
60b0c757 fix(devin): restore original nemotron model name — nemotron-3-super-120b-a12b:free
92faf2d1 fix(devin): correct deepseek model name — deepseek-v4-flash
0367a0cf fix(model-resolution): auto-prefix provider for bare model names in config overrides
fa0217d8 fix(devin): use valid model IDs in fallback chain
8d1c3ff4 feat(devin): broaden fallback chain providers — remove opencode-only lock
a8e0790f docs(readme): fix indentation of paragraph after MCP JSON block
24f3d51c feat(commands): remove /devin and /devin-models slash commands
32a0a391 feat(devin-cli): default permission_mode to dangerous — always bypass permission prompts
82e56f88 feat(devin): harden agent separation — enforce Devin never delegates to specialists
eedd14cc fix(devin): restrict fallback to free models and fix delegation prompt
8e4e017e feat(devin): configure cheap/free OpenCode model fallbacks
9ce4fa4a feat(config): add devin to AgentOverridesSchema
abadf8ca feat(run): show session resume hint on interrupt and completion
b19ce813 fix(identity): set published package name to oh-my-opendevin
b36dfdcf fix(team-mode): cast test fixture ask return to satisfy Effect type
8b098ff1 docs(readme): document Devin x Sisyphus tag-team architecture
352b7fac feat(agents): promote Devin to primary default agent
60d1a235 feat(agents): register Devin as a built-in subagent
c1ffce7e docs(readme): remove session alias system references
b6b17f87 feat(devin-models): improve model selector display with tiers and examples
f2139460 fix(version-detection): recognize oh-my-opendevin package name for version toast
446aa60d fix(mcp): write .mcp.json to ~/.claude/ where the plugin actually reads
853ede47 feat(installer): auto-detect shell rc and source after PATH change
8bbd17d8 feat(installer): add config backup/restore for uninstall
413d70d0 fix(mcp): resolve MCP integration failures and harden security
bfd6dd24 feat(mcp): add global MCP configuration for Devin server
7fe9801b feat(installer): add fallback to local installation via symlinks
f3c402b5 refactor: change package name from scoped to unscoped
021e31d2 docs: update README with comprehensive installation guide
65c56f7f chore: remove local development installation scripts
005871f2 feat(installer): add global installation script for npm package
1655e455 Revert 'feat(install): use fixed project path for global installation'
cb6da4d6 feat(install): use fixed project path for global installation
1d6c6481 Fix README title: this is an oh-my-openagent fork
5ceab6c0 Reorganize README: put fork-specific content before base project
efa50caf Update README.md with fork-specific features
1cfcf683 Fix doctor check warning for local development installation
5869eee6 Add local development installation script
b28fe863 feat: add /devin slash commands for easier delegation in OpenCode
8851e10b fix: update model names to use specific versions (swe-1-6, claude-sonnet-4-6)
0f02158e feat: add intelligent model selection guidance to devin-cli skill
b1b91003 feat: add devin-cli built-in skill for MCP delegation guidance
bff58671 feat: add Devin CLI MCP server for background session delegation
75825eb9 fix(todo-description-override): add OpenCode schema contract for string priorities
c740ed8a fix(delegate-task): route sync prompts by directory
6035a551 fix(background-agent): route session prompts by directory
```

---

*Generated with [Devin](https://cli.devin.ai/docs)*
