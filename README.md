# Oh My OpenDevin

**This is a customized fork of [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) with Devin CLI integration, live session completion notifications, and dual-primary agent architecture.**

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

> [!NOTE]
> **Multi-Harness Agent OS Refactor in Progress**
>
> We are restructuring the codebase to support multiple agent harnesses (OpenCode, Codex, Pi, and others). If you are interested in contributing, please read the [ROADMAP](./ROADMAP.md) first. PRs related to roadmap work should use the `ROADMAP` label.

> [!TIP]
> **Building in Public**
>
> The maintainer builds and maintains oh-my-openagent in real-time with Jobdori, an AI assistant running on a heavily customized fork of OpenClaw.
> Every feature, every fix, every issue triage — live in our Discord.
>
> [![Building in Public](./.github/assets/building-in-public.png)](https://discord.gg/PUwSMR9XNk)
>
> [**→ Watch it happen in #building-in-public**](https://discord.gg/PUwSMR9XNk)

> [!NOTE]
>
> [![Sisyphus Labs - Meet Dori. Not a demo. Subscribes to everything.](./.github/assets/sisyphuslabs.png?v=4)](https://sisyphuslabs.ai)
> > **OmO is maintained by Jobdori, the AI assistant shown above. Meet your own Jobdori — Dori. <br />Join the waitlist [here](https://sisyphuslabs.ai).**

> [!TIP]
> Be with us!
>
> | [<img alt="Discord link" src="https://img.shields.io/discord/1452487457085063218?color=5865F2&label=discord&labelColor=black&logo=discord&logoColor=white&style=flat-square" width="156px" />](https://discord.gg/PUwSMR9XNk) | Join our [Discord community](https://discord.gg/PUwSMR9XNk) to connect with contributors and fellow `oh-my-openagent` users. |
> | :-----| :----- |
> | [<img alt="X link" src="https://img.shields.io/badge/Follow-%40justsisyphus-00CED1?style=flat-square&logo=x&labelColor=black" width="156px" />](https://x.com/justsisyphus) | Updates for `oh-my-openagent` used to be posted on my X account. <br /> Since it was mistakenly suspended, [@justsisyphus](https://x.com/justsisyphus) now posts updates on my behalf. |
> | [<img alt="GitHub Follow" src="https://img.shields.io/github/followers/code-yeongyu?style=flat-square&logo=github&labelColor=black&color=24292f" width="156px" />](https://github.com/code-yeongyu) | Follow [@code-yeongyu](https://github.com/code-yeongyu) on GitHub for more projects. |

<!-- <CENTERED SECTION FOR GITHUB DISPLAY> -->

<div align="center">

<a href="https://github.com/code-yeongyu/oh-my-openagent#oh-my-openagent"><img src="./.github/assets/omo-logo.png" alt="OmO" width="200" /></a>

[![Oh My OpenAgent](./.github/assets/hero.jpg)](https://github.com/code-yeongyu/oh-my-openagent#oh-my-openagent)

[![Preview](./.github/assets/omo.png)](https://github.com/code-yeongyu/oh-my-openagent#oh-my-openagent)

</div>

> This is oh-my-openagent, running Team Mode. With Kimi K2.6 and GPT-5.5.

> Anthropic [**blocked OpenCode because of us.**](https://x.com/thdxr/status/2010149530486911014) **Yes, this is true.**
> They want you locked in. Claude Code is a nice prison, but it's still a prison.
>
> You don't need to pay $200 for 2 hours of work.
> The future isn't picking one winner; it's orchestrating them all. Models get cheaper every month. Smarter every month. No single provider will dominate. We're building for that open market, not their walled gardens.

<div align="center">

[![GitHub Release](https://img.shields.io/github/v/release/code-yeongyu/oh-my-openagent?color=369eff&labelColor=black&logo=github&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/releases)
[![npm downloads](https://img.shields.io/endpoint?url=https%3A%2F%2Fohmyopenagent.com%2Fapi%2Fnpm-downloads&style=flat-square)](https://www.npmjs.com/package/oh-my-opencode)
[![GitHub Contributors](https://img.shields.io/github/contributors/code-yeongyu/oh-my-openagent?color=c4f042&labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/graphs/contributors)
[![GitHub Forks](https://img.shields.io/github/forks/code-yeongyu/oh-my-openagent?color=8ae8ff&labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/network/members)
[![GitHub Stars](https://img.shields.io/github/stars/code-yeongyu/oh-my-openagent?color=ffcb47&labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/stargazers)
[![GitHub Issues](https://img.shields.io/github/issues/code-yeongyu/oh-my-openagent?color=ff80eb&labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/issues)
[![License](https://img.shields.io/badge/license-SUL--1.0-white?labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/LICENSE.md)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/code-yeongyu/oh-my-openagent)
[![Docs](https://img.shields.io/badge/docs-omo.vibetip.help-369eff?labelColor=black&logo=readthedocs&logoColor=white&style=flat-square)](https://omo.vibetip.help/docs)

</div>

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/install.sh | bash
```

```bash
# For oh-my-opencode (the OpenCode Plugin):
opencode plugins add oh-my-opencode
```

> For detailed instructions and troubleshooting, see [Installation Guide](docs/guide/installation.md).

## What is Oh My OpenAgent?

**Oh My OpenAgent (OmO)** is an opinionated, batteries-included plugin for [OpenCode](https://opencode.ai) that turns a basic code editor into a multi-agent powerhouse.

Instead of one generic assistant, you get **11 specialist agents** — each with their own role, model requirements, and lifecycle hooks:

| Agent | Role | When to Use |
|-------|------|-------------|
| **Sisyphus** | Main orchestrator | General coding tasks |
| **Prometheus** | Planner | Complex multi-step tasks |
| **Oracle** | Architecture/debugging | System design, debugging |
| **Librarian** | Documentation/code search | Finding relevant code/docs |
| **Explore** | Fast codebase grep | Quick codebase navigation |
| **Hephaestus** | Refactoring specialist | Code restructuring |
| **Atlas** | Infrastructure/ops | DevOps, deployment |
| **Metis** | Plan consultant | Reviewing/refining plans |
| **Momus** | Critic | Code review, quality checks |
| **Multimodal Looker** | Vision | Image analysis, UI review |
| **Sisyphus-Junior** | Lightweight delegate | Quick subtasks |

**Key Features:**

- **Team Mode** — Parallel multi-agent coordination (like Claude Code Agent Teams, but open)
- **Hash-Anchored Edit Tool** (`LINE#ID`) — Zero stale-line errors, guaranteed
- **LSP + AST-Grep** — IDE-precision refactoring and code search
- **Background Agents** — Fire specialists in parallel, come back when done
- **Built-in MCPs** — Exa websearch, Context7 docs, Grep.app
- **Tmux Integration** — Full interactive terminal support
- **Claude Code Compatibility** — Hooks, commands, skills, MCPs, plugins
- **IntentGate** — True intent analysis before acting
- **Ralph Loop** — Self-referential completion loop
- **Todo Enforcer** — Auto-resume idle agents
- **`/init-deep`** — Hierarchical `AGENTS.md` generation

**Quick Overview:**
- **Agents**: Sisyphus (the main agent), Prometheus (planner), Oracle (architecture/debugging), Librarian (docs/code search), Explore (fast codebase grep), Multimodal Looker
- **Background Agents**: Run multiple agents in parallel like a real dev team
- **LSP & AST Tools**: Refactoring, rename, diagnostics, AST-aware code search
- **Hash-anchored Edit Tool**: `LINE#ID` references validate content before applying every change. Surgical edits, zero stale-line errors
- **Context Injection**: Auto-inject AGENTS.md, README.md, conditional rules
- **Claude Code Compatibility**: Full hook system, commands, skills, agents, MCPs
- **Built-in MCPs**: websearch (Exa), context7 (docs), grep_app (GitHub search) — injected at runtime by the plugin; not visible in `opencode mcp list` (see [MCP docs](docs/reference/features.md#native-vs-plugin-injected-mcps))
- **Session Tools**: List, read, search, and analyze session history
- **Productivity Features**: Ralph Loop, Todo Enforcer, Comment Checker, Think Mode, and more
- **Doctor Command**: Built-in diagnostics (`bunx oh-my-opendevin doctor`) verify plugin registration, config, models, and environment
- **Model Fallbacks**: `fallback_models` can mix plain model strings with per-fallback object settings in the same array
- **File Prompts**: Load prompts from files with `file://` support in agent configurations
- **Session Recovery**: Automatic recovery from session errors, context window limits, and API failures
- **Model Setup**: Agent-model matching is built into the [Installation Guide](docs/guide/installation.md#step-5-understand-your-model-setup)

**Quick Overview:**
- **Config Locations**: User config plus walked `.opencode/oh-my-openagent.json[c]` configs up to `$HOME`; closest wins. Legacy `oh-my-opencode.json[c]` still works.
- **JSONC Support**: Comments and trailing commas supported
- **Agents**: Override models, temperatures, prompts, and permissions for any agent
- **Built-in Skills**: `playwright` (browser automation), `git-master` (atomic commits)
- **Sisyphus Agent**: Main orchestrator with Prometheus (Planner) and Metis (Plan Consultant)
- **Background Tasks**: Configure concurrency limits per provider/model
- **Categories**: Domain-specific task delegation (`visual`, `business-logic`, custom)
- **Hooks**: 54+ lifecycle hooks (61 with Team Mode), all configurable via `disabled_hooks`
- **MCPs**: Built-in websearch (Exa), context7 (docs), grep_app (GitHub search) — runtime-injected, not shown in `opencode mcp list`
- **LSP**: Full LSP support with refactoring tools
- **Experimental**: Aggressive truncation, auto-resume, and more

## Documentation

Full docs at [omo.vibetip.help](https://omo.vibetip.help/docs):

- [Installation Guide](docs/guide/installation.md)
- [Feature Reference](docs/reference/features.md)
- [Team Mode Guide](docs/guide/team-mode.md)
- [Troubleshooting](docs/troubleshooting.md)

## Architecture

OmO is built as a modular plugin system:

- **Agents** — 11 specialist agents with model requirements, permissions, and lifecycle hooks
- **Hooks** — 54+ lifecycle hooks (61 with Team Mode) across 5 tiers: Session, ToolGuard, Transform, Continuation, Skill
- **Tools** — 20-39 tools depending on config: LSP, AST-grep, session management, background tasks, delegation, skills
- **MCPs** — 3 built-in remote MCPs (Exa, Context7, Grep.app) + skill-embedded MCPs
- **Config** — JSONC multi-level config with Zod v4 validation, deep merge, and automatic migration
- **Team Mode** — Parallel multi-agent coordination modeled after Claude Code Agent Teams

See [AGENTS.md](AGENTS.md) for the full architecture overview.

## Fork Installation

If you are using this fork:

```bash
# Install the fork globally
./install-global.sh
```

If you prefer not to use Bun, the plugin will still work without MCP integration. You just won't be able to use the Devin CLI delegation features.

If MCP was previously configured but stopped working, run `./install-global.sh --fix-mcp` to repair the configuration without reinstalling.

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
