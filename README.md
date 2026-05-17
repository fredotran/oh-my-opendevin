# Oh My OpenAgent (Custom Fork)

**This is a customized fork of [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) with additional features and integrations.**

## What's Different

This fork adds:
- **Devin x Sisyphus Dual-Primary Architecture** - Two independent primary agents with clear separation:
  - **Devin** (default): Local execution + Devin CLI sandbox delegation. Never uses specialist agents.
  - **Sisyphus**: Full specialist agent orchestration (Oracle, Librarian, Explore, Hephaestus, Atlas, Metis, Momus).
  - Switch between them anytime based on your needs.
- **Devin CLI Integration** - MCP server, built-in skill, slash commands, and a dedicated `devin` built-in agent for delegating tasks to the Devin CLI sandbox. Includes **live session completion notifications** via the Devin Session Watcher.
- **Global Installer** - Easy installation script for deploying to any system.
- **Custom Configurations** - Tailored settings for specific workflows.

All core features from the original oh-my-openagent are preserved and maintained. See [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) for the upstream project.

---

## Fork-Specific Features

### Devin CLI Integration

This fork includes a complete integration with the [Devin CLI](https://cli.devin.ai/docs):

**MCP Server** (`src/mcp-servers/devin/`)
- `devin_start` - Start a background Devin session
- `devin_status` - Get session status and recent output
- `devin_wait` - Block until session finishes
- `devin_cancel` - Cancel a running session
- `devin_list` - List all active sessions

**Built-in Skill** (`src/features/builtin-skills/skills/devin-cli.ts`)
- Tiered model selection guidance (Standard → Fast → Code Gen → Balanced → Deep)
- Standard workflow documentation for agents
- Anti-patterns and best practices

**Slash Commands** (`src/features/builtin-commands/templates/devin.ts`)
- `/devin-status` - List or show session status
- `/devin-cancel` - Cancel sessions

**Resilience & Maintainability**
- Session re-attachment on MCP server restart (orphaned sessions remain visible)
- Pre-flight validation: binary existence check, model typo detection, cwd validation
- Auto-cleanup of completed sessions from memory (1h TTL, logs remain on disk)
- Idle session detection: sessions with no output for 30min marked as `"stalled"`
- First-class CLI reporter: `bunx oh-my-opencode devin-report [--json] [--tier <tier>]`
- Model disclosure: agents always tell you which tier and model was selected when delegating to Devin CLI

**Devin Session Watcher** (live completion notifications)
- Lightweight file watcher that polls the Devin MCP log directory for session state changes
- Detects when a Devin session transitions from `running` → `completed` / `error` / `cancelled`
- Fires two notification paths:
  - **System reminder** — queued into the active OpenCode chat session via `backgroundManager.queuePendingNotification`, injected on the next `chat.message` via the existing `backgroundNotificationHook`
  - **OS notification** — cross-platform native toast (macOS `osascript`/`terminal-notifier`, Linux `notify-send`, Windows PowerShell toast)
- Configurable: enable/disable, poll interval (default 5s), toggle system reminders vs OS notifications independently
- Automatically starts when `devin.watcher_enabled: true`, stops on `session.deleted` and process shutdown

Enable in `~/.config/opencode/oh-my-openagent.jsonc`:

```jsonc
{
  "devin": {
    "watcher_enabled": true,
    "watcher_poll_interval_ms": 5000,
    "watcher_system_reminders": true,
    "watcher_os_notifications": true
  }
}
```

Restart OpenCode after changing. When a Devin session completes, you will see:
- **In chat**: *"Devin session `{id}` completed with status: `{status}`. Duration: `{duration}`. Prompt: `{preview}"*`
- **OS banner**: Native notification titled "Devin" with the same message

### Devin x Sisyphus Dual-Primary Architecture

This fork introduces a **clear separation of responsibilities** between two primary agents. Pick the right tool for the job:

| Agent | Mode | What It Does | What It Does NOT Do | When to Use |
|-------|------|-------------|---------------------|-------------|
| **Devin** (default) | primary | Local execution (read, edit, grep, LSP) + Devin CLI sandbox delegation for background/long-running tasks | NEVER calls specialist agents (Oracle, Librarian, Explore, Hephaestus, Atlas, Metis, Momus). Never routes to Sisyphus. | Quick edits, file reads, greps, background Devin CLI jobs, sandboxed execution |
| **Sisyphus** | primary | Full specialist agent orchestration. Plans, delegates to Oracle/Librarian/Explore/Hephaestus/Atlas/Metis/Momus, and executes complex multi-file changes. | Does not use Devin CLI sandbox | Deep research, architecture decisions, multi-file refactoring, external doc searches, multi-agent coordination |

**Key principle:** You choose the agent. They don't choose for you.

- **Devin** is the **default** when you start OpenCode. Use Devin for local work + Devin CLI background tasks.
- **Sisyphus** is available anytime. Use Sisyphus when you need specialist agent coordination.
- **Switching:** Start a new session with the agent you want. They operate independently.
- Both agents are **eligible for Team Mode** — you can spawn a team with either Devin or Sisyphus as the lead.

#### Devin CLI Model Tiers

When the Devin agent delegates to the Devin CLI sandbox, it uses **explicit keyword-based tier selection** based on task complexity. The agent picks a tier keyword; the MCP server resolves it to the actual Devin model before spawning the session. The Devin agent itself runs on free OpenCode Zen models; the CLI sandbox sessions can be routed to any available model.

| Tier | How to invoke | Resolved model | Use for |
|------|---------------|----------------|---------|
| **Standard** | Omit `model` | `kimi-k2.6` | Most tasks — good balance of capability and cost (default) |
| **Fast/Cheap** | `model: "swe"` | `swe-1.6` | Simple edits, typos, single-file fixes |
| **Code Gen** | `model: "codex"` | `codex` | Boilerplate, CRUD, test scaffolding |
| **Balanced** | `model: "sonnet"` | `sonnet` | Moderate complexity, general purpose |
| **Deep** | `model: "opus"` | `opus` | Architecture refactors, multi-file, complex debugging |

**Selection heuristics:**
- Default to **Standard** (omit `model`) for almost everything — `kimi-k2.6` handles most engineering tasks well
- Use **Fast** (`"swe"`) only for trivial tasks where speed matters more than reasoning
- Use **Code Gen** (`"codex"`) for pure scaffolding and repetitive patterns
- Use **Deep** (`"opus"`) sparingly — reserve for architectural refactors or critical correctness
- Use **Balanced** (`"sonnet"`) when you need more than `swe` but don't want `opus` cost

#### Devin CLI Reliability

The MCP server includes multiple safeguards for production use:

| Feature | What it does |
|---------|-------------|
| **Max duration cap** | `maxDurationMs` option (default 2h, min 1m) auto-cancels runaway sessions |
| **Log size caps** | Warns at 100MB; auto-cancels at 500MB to prevent disk exhaustion |
| **Structured error hints** | Spawn failures return tagged errors: `RATE_LIMIT`, `QUOTA_EXCEEDED`, `CONTEXT_LIMIT`, `UNKNOWN` with recovery guidance |
| **Model fallback chain** | `opus` → `sonnet` → `kimi-k2.6` → `swe` — agents can retry with the next tier when quota is hit |
| **Auto-fallback** | `autoFallback: true` on `devin_start` automatically retries down the chain on `QUOTA_EXCEEDED` |
| **Tool error wrapping** | All tool handlers catch unexpected errors and return text results instead of crashing |
| **Concurrent limit** | Maximum 50 running sessions enforced at spawn time |
| **Idle detection** | Sessions with no output growth for 30 minutes are marked `stalled` |
| **Stdin EOF handler** | Detects parent process crash and cancels all sessions to avoid burning credits |

**Override the Devin agent model** in `~/.config/opencode/oh-my-openagent.jsonc`:

```jsonc
{
  "agents": {
    "devin": {
      "model": "github-copilot/claude-opus-4.6",
      "variant": "high"
    }
  }
}
```

Restart OpenCode after changing. The agent model is separate from the CLI sandbox tier — the agent's model config does not affect CLI session routing.

**Agent assembly order:** `Devin → Sisyphus → Hephaestus → Prometheus → Atlas`

Canonical order is enforced by `installAgentSortShim()` so Devin always appears first when both Devin and Sisyphus are registered. Devin is the default primary agent; Sisyphus is available when you need specialist orchestration.

#### Architecture Diagram

```
  +-------------------+                          +-----------------------+
  |  Devin (primary)  |                          | Sisyphus (primary)    |
  |   Default Agent   |                          |  Deep-work Agent      |
  +-------------------+                          +-----------------------+
          |                                                  |
          | Local execution OR Devin CLI                     | Specialist agent
          | sandbox delegation ONLY                          | orchestration ONLY
          |                                                  |
    +-------+-------+                                +-------+-------+
    |               |                                |               |
    v               v                                v               v
+--------+  +-----------+                      +----------+          +----------+
| Local  |  | Devin CLI |                      |  Oracle  |          |Hephaestus|
| Tools  |  |  Sandbox  |                      | (review) |          |  (deep)  |
|        |  |           |                      +----------+          +----------+
| read   |  | devin_    |                          |                     |
| edit   |  | start     |                      +----------+          +----------+
| grep   |  | status    |                      | Librarian|          | Explore  |
| LSP    |  | wait      |                      |  (docs)  |          | (search) |
|        |  | cancel    |                      +----------+          +----------+
+--------+  +-----------+                          |
                                               +----------+
                                               |  Atlas   |
                                               | (todos)  |
                                               +----------+
                                               |  Metis   |
                                               |  (plan)  |
                                               +----------+
                                               |  Momus   |
                                               | (review) |
                                               +----------+
```

#### Devin Decision Flow

```
User Request
    |
    +-- Simple? (single-file edit, read, grep)
    |      +--> Execute locally with read/edit/grep/LSP tools
    |
    +-- Long-running? (>30s, background, sandbox)
    |      +--> Delegate to Devin CLI via devin_start
    |      +--> Monitor with devin_status / devin_wait
    |
    +-- Needs specialist agents? (Oracle, Hephaestus, Librarian, Explore, etc.)
           +--> Suggest user switches to Sisyphus
           +--> "I don't delegate to specialist agents. Use Sisyphus for this."
```

---

## Installation

### Quick Install (Recommended)

For most users, the easiest way to install this fork is using the global installer:

```bash
curl -fsSL https://raw.githubusercontent.com/fredotran/oh-my-opendevin/dev/install-global.sh | bash
```

Or clone and run:

```bash
git clone https://github.com/fredotran/oh-my-opendevin.git
cd oh-my-opendevin
./install-global.sh
```

**What the installer does:**
- Checks prerequisites (npm required, bun required for MCP integration)
- Installs Bun automatically if not found (needed for Devin MCP server)
- Installs `oh-my-opendevin` globally from npm
- Configures OpenCode automatically
- Configures MCP servers for Devin CLI integration
- Runs verification checks

**Usage:**
```bash
./install-global.sh              # Install globally
./install-global.sh --uninstall  # Remove global installation
./install-global.sh --restore    # Restore configs from most recent backup
./install-global.sh --fix-mcp    # Repair MCP configuration without reinstalling
./install-global.sh --no-verify  # Skip verification step
./install-global.sh --help       # Show help
```

**After installation:**
- Restart OpenCode to load the plugin
- CLI commands available: `oh-my-opendevin` or `oh-my-opencode`
- Run `oh-my-opendevin doctor` to verify installation
- Or run `./check-installation.sh` for a quick diagnostic of all components

**Resuming sessions:**
When running `oh-my-opencode run "<task>"`, if you interrupt with Ctrl+C or the session completes, the CLI prints a resume hint with the session ID:
```
oh-my-opencode run --session-id <id> "Continue the work"
```
This lets you easily resume exactly where you left off.

### Alternative: Direct npm Install

If you prefer to install directly via npm:

```bash
npm install -g oh-my-opendevin
```

Then manually configure OpenCode by editing `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["oh-my-opendevin"]
}
```

### Development Installation

For contributors who want to work on the code:

```bash
git clone https://github.com/fredotran/oh-my-opendevin.git
cd oh-my-opendevin
bun install  # Bun is required for development
bun run build
```

Then manually configure OpenCode to use the local build:

```json
{
  "plugin": ["file:///path/to/oh-my-opendevin/dist/index.js"]
}
```

**Development workflow:**
1. Make changes to the code
2. Run `bun run build` to rebuild
3. Restart OpenCode to pick up changes
4. Test your changes

### MCP Integration Requirements

The Devin CLI MCP server requires **Bun** to run. This is because the MCP server is built specifically for the Bun runtime to ensure optimal performance and compatibility.

**For users installing via the global installer:**
- Bun is automatically installed if not present on your system
- The installer handles all MCP configuration automatically
- No manual setup required

**For users installing via npm directly:**
- You must have Bun installed on your system
- Install Bun: `curl -fsSL https://bun.sh/install | bash`
- Manually configure MCP in `~/.claude/.mcp.json`:
  ```json
  {
    "mcpServers": {
      "devin": {
        "type": "stdio",
        "command": "bun",
        "args": ["run", "$(npm root -g)/oh-my-opendevin/dist/mcp-servers/devin/index.js"],
        "env": {}
      }
    }
  }
  ```

The plugin also checks `~/.config/opencode/.mcp.json` as a fallback for manual configurations.

**For developers:**
- Bun is required for both development and MCP integration
- The `.mcp.json` in the repo root points to built files in `dist/`
- Run `bun run build` before using MCP integration in development

### Troubleshooting

#### Bun not found or MCP integration not working

If you see errors about Bun not being installed or MCP integration fails:

1. **Install Bun manually:**
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```

2. **Restart your shell** to pick up the new PATH (the global installer does this automatically for bash and zsh):
   ```bash
   source ~/.bashrc  # or ~/.zshrc, .bash_profile, .zprofile
   ```

3. **Verify Bun installation:**
   ```bash
   bun --version
   ```

4. **Re-run the installer:**
   ```bash
   ./install-global.sh
   ```

If you prefer not to use Bun, the plugin will still work without MCP integration. You just won't be able to use the Devin CLI delegation features.

If MCP was previously configured but stopped working, run `./install-global.sh --fix-mcp` to repair the configuration without reinstalling.

#### Installation fails with permission errors

If you encounter permission errors during npm installation:

```bash
# Fix npm permissions (recommended)
mkdir -p ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc

# Then re-run the installer
./install-global.sh
```

#### Plugin not loading in OpenCode

1. Restart OpenCode after running the installer
2. Check OpenCode logs for errors
3. Run `oh-my-opendevin doctor` to verify installation
4. Ensure the plugin entry in OpenCode config is correct

See [INSTALL-GLOBAL.md](INSTALL-GLOBAL.md) for detailed installation instructions and troubleshooting.

---

## Upstream Features

This fork inherits all core features from [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent). See the upstream README for the full feature list including:

- **Discipline Agents** — Sisyphus, Hephaestus, Prometheus, Oracle, Librarian, Explore, Atlas, Metis, Momus
- **Team Mode** — Parallel multi-agent coordination with tmux visualization
- **Hash-Anchored Edit Tool** (`LINE#ID`) — Zero stale-line errors
- **LSP + AST-Grep** — IDE-precision refactoring and code search
- **Background Agents** — Fire specialists in parallel
- **Built-in MCPs** — Exa, Context7, Grep.app
- **Tmux Integration** — Full interactive terminal support
- **Claude Code Compatibility** — Hooks, commands, skills, MCPs, plugins
- **IntentGate** — True intent analysis before acting
- **Ralph Loop / `/ulw-loop`** — Self-referential completion loop
- **Todo Enforcer** — Auto-resume idle agents
- **`/init-deep`** — Hierarchical `AGENTS.md` generation

[Full upstream documentation →](https://github.com/code-yeongyu/oh-my-openagent#oh-my-openagent)

*Special thanks to [@junhoyeo](https://github.com/junhoyeo) for this amazing hero image.*
