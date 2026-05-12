import type { BuiltinSkill } from "../types"

export const devinCliSkill: BuiltinSkill = {
  name: "devin-cli",
  description:
    "Delegate tasks to the Devin CLI as a background coworker. Use when the user asks to hand off work to Devin, leverage their Devin/Windsurf subscription, or run a long task in parallel.",
  argumentHint: "<task description>",
  template: `# Devin CLI Delegation

You can delegate self-contained engineering tasks to the \`devin\` CLI as a background subprocess via the \`devin\` MCP server. The MCP server is registered at the repo root in \`.mcp.json\` and exposes 6 tools.

---

## When to delegate

Delegate to Devin when ANY of the following holds:

- The user explicitly asks ("delegate this to Devin", "use my Devin subscription", "hand off to Devin")
- The task is long-running, self-contained, and can proceed without your continuous attention (e.g. "refactor module X to use the new API", "write tests for file Y", "investigate why the build is slow")
- You want to parallelize: spawn Devin on subtask B while you work on subtask A
- The user wants to leverage a Devin-only model not available in the active provider

DO NOT delegate when:

- The task requires real-time back-and-forth with the user
- You can do it yourself in a few tool calls
- The task touches the same files you are about to edit (avoid merge conflicts)
- You have no actionable prompt yet — clarify with the user first

---

## Tools (provided by the \`devin\` MCP server)

| Tool | Purpose | Key arguments |
|------|---------|---------------|
| \`devin_start\` | Spawn \`devin -p <prompt>\` in the background | \`prompt\` (required), \`model?\`, \`cwd?\`, \`permission_mode?\` (\`auto\` \| \`dangerous\`, default: \`dangerous\`), \`resume?\` |
| \`devin_status\` | Get current status + tail of stdout/stderr log | \`session_id\`, \`tail_bytes?\` (default 8192), \`since_bytes?\` (incremental read) |
| \`devin_wait\` | Block until exit or timeout | \`session_id\`, \`timeout_ms?\` (default 60000), \`tail_bytes?\` |
| \`devin_cancel\` | Kill the background subprocess | \`session_id\` |
| \`devin_cancel_batch\` | Kill multiple background subprocesses in one call | \`session_ids\` (array, max 50) |
| \`devin_list\` | Enumerate sessions in this MCP process | \`include_output?\` |

Each tool returns a human-readable text snapshot. \`session_id\` is a UUID — store it; you will need it for every subsequent call.

---

## Standard workflow

1. **Compose a self-contained prompt.** Devin will not see your conversation history. The prompt must contain everything Devin needs: goal, constraints, file paths, acceptance criteria. Treat it like delegating to a remote engineer.
2. **Pick a working directory (required).** Always pass \`cwd\` explicitly — the MCP server's default directory is fixed at startup and may differ from the current session's working directory (e.g. after a session fork). Use the repository root unless the task belongs to a sibling project.
3. **Pick a model tier (optional).** The Devin agent (you) runs on free models. When delegating to Devin CLI, choose the tier based on task complexity:
   - **Standard** — omit \`model\` → defaults to \`kimi-k2.6\` (most tasks)
   - **Fast/Cheap** — \`model: "swe"\` (simple edits, typos)
   - **Code Gen** — \`model: "codex"\` (boilerplate, scaffolding)
   - **Deep** — \`model: "opus"\` (architecture, complex debugging)
   - **Balanced** — \`model: "sonnet"\` (moderate complexity)
4. **Start the session.** Call \`devin_start({ prompt, cwd?, model? })\`. Save the returned \`session_id\`.
5. **Tell the user.** Briefly note that Devin is running in the background and return to whatever else you were doing.
6. **Poll periodically (incremental).**
   - **First call**: \`devin_status({ session_id, tail_bytes: 8192 })\` — note the \`output_bytes\` field in the response.
   - **Subsequent calls**: \`devin_status({ session_id, since_bytes: <previous_output_bytes> })\` — this returns only *new* output since your last poll, avoiding redundant context bloat.
   - If \`since_bytes\` returns "(no new output)", wait 10–15 seconds before polling again.
   - Use \`tail_bytes\` instead of \`since_bytes\` only when you want a fresh full tail (e.g., user asks for "full output").
7. **Wait if you have nothing else to do.** Call \`devin_wait({ session_id, timeout_ms })\` instead of busy-polling. \`timeout_ms\` max is 600000 (10 min); chain \`devin_wait\` calls if you need longer.
8. **Report results.** When \`status\` is \`completed\`, summarize Devin's output for the user. If \`error\`, surface the error and either retry or fall back to handling it yourself.
9. **Cancel if needed.** \`devin_cancel({ session_id })\` if the user changes their mind or Devin goes off-rails.

---

## Model selection guidelines

The Devin agent (you) runs on free models. When delegating to the Devin CLI sandbox, you choose the model tier. Default to standard tier unless the task clearly demands a different capability level.

### Model tiers

| Tier | How to invoke | Resolved model | Use for |
|------|---------------|----------------|---------|
| **Standard** | Omit \`model\` | \`kimi-k2.6\` | Most tasks — good balance of capability and cost |
| **Fast/Cheap** | \`model: "swe"\` | \`swe-1-6\` | Simple edits, typos, single-file fixes, cost-sensitive batches |
| **Code Gen** | \`model: "codex"\` | \`codex\` | Boilerplate, CRUD, test scaffolding, repetitive patterns |
| **Balanced** | \`model: "sonnet"\` | \`sonnet\` | Moderate complexity, general purpose, documentation |
| **Deep** | \`model: "opus"\` | \`opus\` | Architecture refactors, multi-file, complex debugging, critical correctness |

### Selection heuristics

- **Default to standard tier** (omit \`model\`) for almost everything. \`kimi-k2.6\` handles most engineering tasks well.
- Use **\`"swe"\`** only for trivial tasks where speed matters more than reasoning (typos, import fixes).
- Use **\`"codex"\`** for pure code generation (scaffolding, repetitive patterns).
- Use **\`"opus"\`** sparingly — reserve for architectural refactors, deep debugging, or when correctness is critical.
- Use **\`"sonnet"\`** when you need more than \`swe\` but don't want \`opus\` cost.

### Examples

**Task**: "Refactor the entire auth module to use the new TokenStore interface across 15 files."
→ **Tier**: Deep (\`model: "opus"\`)

**Task**: "Fix the typo in the error message on line 42."
→ **Tier**: Standard (omit \`model\`) or Fast (\`model: "swe"\`)

**Task**: "Generate unit tests for all service methods in src/services/."
→ **Tier**: Code Gen (\`model: "codex"\`)

**Task**: "Update the README with the new deployment steps."
→ **Tier**: Standard (omit \`model\`) or Balanced (\`model: "sonnet"\`)

**Task**: "Investigate why the build is failing and fix it."
→ **Tier**: Deep (\`model: "opus"\`) or Standard (omit \`model\`)

---

## Prompt-writing rules for Devin

- Start with a one-line goal.
- Provide absolute file paths (relative-to-repo also works since \`cwd\` is set).
- List acceptance criteria explicitly: tests pass, lint clean, etc.
- State what NOT to do (e.g. "do not modify the build config").
- Ask Devin to commit only if the user wants it; otherwise say "do not commit".
- Keep it under ~2000 characters when possible — long prompts work but cost tokens.

Example prompt:

\`\`\`
Refactor src/auth/session.ts to use the new TokenStore interface from src/auth/token-store.ts.
- Replace all direct cookie reads with TokenStore.get()
- Update src/auth/session.test.ts accordingly
- Run \`bun test src/auth\` and confirm it passes
- Do NOT commit. Do NOT touch any other file.
- When done, print a summary of changed files and remaining concerns.
\`\`\`

---

## Anti-patterns

- **Don't spawn duplicate sessions for the same task.** Check \`devin_list\` first if unsure.
- **Don't pass conversation transcripts as the prompt.** Distill to a clear, self-contained brief.
- **Don't poll in a tight loop.** Wait 5–15 seconds between \`devin_status\` calls or use \`devin_wait\`.
- **Default is \`dangerous\`** — all Devin CLI sessions bypass permission prompts automatically. Use \`permission_mode: "auto"\` only if the user explicitly wants Devin to ask for dangerous operations.
- **Don't forget to cancel.** Stale background sessions waste subscription budget. Use \`devin_cancel_batch\` when cancelling multiple sessions at once.

---

## Example interactions

### User: "Delegate the auth refactor to Devin while you work on the UI."

\`\`\`
1. Analyze task: multi-file refactor with architectural impact → choose Deep tier ("opus")
2. devin_start({
     prompt: "<self-contained refactor brief>",
     cwd: "/path/to/repo",
     model: "opus",
   }) → session_id "abc-123"
3. Tell user: "Started Devin (session abc-123, model opus) on the auth refactor. Working on the UI now."
4. Continue with UI work.
5. First poll: devin_status({ session_id: "abc-123", tail_bytes: 8192 })
   → Note output_bytes: 2048 from the response
6. Subsequent polls: devin_status({ session_id: "abc-123", since_bytes: 2048 })
   → Only new output since byte 2048 is returned
   → Update tracker: output_bytes is now 4096
7. Next poll: devin_status({ session_id: "abc-123", since_bytes: 4096 })
8. When complete: report Devin's output and continue.
\`\`\`

### User: "Ask Devin to fix the typo in the error message."

\`\`\`
1. Analyze task: single-file, straightforward → use Standard tier (omit model) or Fast ("swe")
2. devin_start({
     prompt: "Fix the typo in the error message on line 42 of src/errors.ts",
     cwd: "/path/to/repo",
   }) → session_id "def-456"
3. Tell user: "Started Devin (session def-456, standard tier) on the typo fix."
4. devin_wait({ session_id: "def-456" })
5. Report: "Devin fixed the typo. Here's the change: ..."
\`\`\`

### User: "How is Devin doing?"

\`\`\`
1. devin_list({ include_output: true }) — find active session(s)
2. devin_status({ session_id, tail_bytes: 16384 }) — get fuller output
3. Summarize status + any blockers.
\`\`\`

### User: "Stop Devin."

\`\`\`
1. devin_list() — confirm session id
2. devin_cancel({ session_id })
3. Confirm to user.
\`\`\`

### User: "Stop all Devin sessions."

\`\`\`
1. devin_list() — collect all running session ids
2. devin_cancel_batch({ session_ids: ["abc-123", "def-456", "ghi-789"] })
3. Confirm to user.
\`\`\`
`,
}
