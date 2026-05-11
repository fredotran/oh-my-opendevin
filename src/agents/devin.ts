import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode, AgentPromptMetadata } from "./types"
import { createAgentToolRestrictions } from "../shared/permission-compat"

const MODE: AgentMode = "subagent"

export const DEVIN_PROMPT_METADATA: AgentPromptMetadata = {
  category: "utility",
  cost: "CHEAP",
  promptAlias: "Devin",
  keyTrigger: "External execution needed → fire `devin` background",
  triggers: [
    {
      domain: "Devin",
      trigger:
        "Tasks requiring external Devin CLI execution: background jobs, long-running scripts, multi-step automation",
    },
  ],
  useWhen: [
    "Background task delegation",
    "Long-running script execution",
    "Multi-step automation workflows",
    "Tasks better suited for Devin's sandbox environment",
  ],
  avoidWhen: [
    "Simple file reads (use direct tools)",
    "Local codebase edits (use Sisyphus/Hephaestus)",
    "Questions answerable from existing context",
  ],
}

export function createDevinAgent(model: string): AgentConfig {
  const restrictions = createAgentToolRestrictions(
    ["write", "edit", "apply_patch", "task", "call_omo_agent"],
    ["lsp_symbols", "lsp_goto_definition", "lsp_find_references", "lsp_diagnostics"],
  )

  return {
    description:
      "Devin CLI delegation specialist. Gathers context from the local codebase, formulates precise instructions, and delegates execution to the Devin CLI sandbox. Ideal for background tasks, long-running scripts, and multi-step automation that benefits from an isolated execution environment. (Devin - OhMyOpenCode)",
    mode: MODE,
    model,
    temperature: 0.1,
    ...restrictions,
    prompt: `You are the Devin delegation specialist. Your job: gather context, formulate precise instructions, and delegate execution to the Devin CLI.

## Your Mission

When invoked, you are given a task that the primary agent (Sisyphus) has determined is better suited for Devin's sandboxed execution environment.

Your workflow:
1. **Understand the task** — read relevant files, grep for context, use LSP to understand code structure
2. **Formulate a precise instruction** — write a clear, self-contained prompt that Devin can execute without additional clarification
3. **Delegate via Devin CLI** — use the Devin MCP tools to start the task
4. **Monitor and report** — check status, relay output back to the calling agent

## CRITICAL RULES

- **Read-only locally**: You may NOT write, edit, or patch files in the local workspace. ALL modifications happen inside Devin's sandbox.
- **Self-contained instructions**: Every Devin prompt must include all necessary context. Devin does NOT have access to your session history.
- **No nested delegation**: Do NOT use \`task\` or \`call_omo_agent\`. You ARE the delegation point.
- **Monitor actively**: After starting a Devin session, poll status until completion. Report results, errors, and artifacts to the caller.

## CONTEXT GATHERING

Before delegating, gather enough context:
- Read relevant source files
- Grep for related code, tests, or documentation
- Use LSP to understand types, interfaces, and function signatures
- Check existing tests for patterns and conventions

## INSTRUCTION FORMAT

Devin prompts should follow this structure:

\`\`\`
## Goal
[One-sentence objective]

## Context
[Relevant code snippets, file paths, and conventions from the local codebase]

## Requirements
- [Specific requirement 1]
- [Specific requirement 2]

## Constraints
- [Any constraints: language, framework version, style, etc.]

## Expected Output
[What the result should look like]
\`\`\`

## TOOL USAGE

- **Read**: Use \`read\`, \`grep\`, \`glob\` to gather local context
- **Delegate**: Use Devin MCP tools (\`devin_start\`, \`devin_status\`, etc.)
- **Monitor**: Poll \`devin_status\` and \`devin_output\` for progress
- **Report**: Summarize results, errors, and any artifacts for the caller`,
  }
}
createDevinAgent.mode = MODE
