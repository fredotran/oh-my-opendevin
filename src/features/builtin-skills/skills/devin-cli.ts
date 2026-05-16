import type { BuiltinSkill } from "../types"

export const devinCliSkill: BuiltinSkill = {
  name: "devin-cli",
  description:
    "Delegate tasks to the Devin CLI as a background coworker. Use when the user asks to hand off work to Devin, leverage their Devin/Windsurf subscription, or run a long task in parallel.",
  argumentHint: "<task description>",
  template: `# Devin CLI Delegation

You can delegate self-contained engineering tasks to the \`devin\` CLI as a background subprocess via the \`devin\` MCP server. The MCP server is registered at the repo root in \`.mcp.json\` and exposes 8 tools.

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
| \`devin_start\` | Spawn \`devin -p <prompt>\` in the background | \`prompt\` (required), \`model?\`, \`cwd?\`, \`permission_mode?\` (\`auto\` \| \`dangerous\`, default: \`dangerous\`), \`resume?\`, \`max_duration_ms?\` (default 2h), \`auto_fallback?\` (default false) |
| \`devin_status\` | Get current status + tail of stdout/stderr log | \`session_id\`, \`tail_bytes?\` (default 8192), \`since_bytes?\` (incremental read) |
| \`devin_wait\` | Block until exit or timeout | \`session_id\`, \`timeout_ms?\` (default 30000), \`tail_bytes?\` |
| \`devin_cancel\` | Kill the background subprocess | \`session_id\` |
| \`devin_cancel_batch\` | Kill multiple background subprocesses in one call | \`session_ids\` (array, max 50) |
| \`devin_list\` | Enumerate sessions in this MCP process | \`include_output?\` |
| \`devin_health\` | Check MCP server health (binary, disk, slots, orphans) | (no args) |
| \`devin_resumable\` | Discover completed/error sessions eligible for resume | \`limit?\` (default 20, max 50) |

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
5. **Tell the user the resolved model — this is MANDATORY.** The \`devin_start\` response includes the resolved model and tier in the FIRST line. ALWAYS echo this back to the user immediately. Do NOT bury it or skip it. Examples:
   - "Started Devin (session abc-123, **Standard tier**, model **kimi-k2.6**) on the auth refactor."
   - "Started Devin (session def-456, **Deep tier**, model **opus**) on the architecture review."
   This gives the user visibility into cost and capability level. Then return to whatever else you were doing.
   - **In CLI mode:** the model appears inline in the tool output. Read the first line of the \`devin_start\` result and repeat it to the user verbatim.
6. **Poll incrementally — CRITICAL.**
   - **First call**: \`devin_status({ session_id, tail_bytes: 8192 })\` — note the \`output_bytes\` field in the response.
   - **ALL subsequent calls**: **ALWAYS use \`since_bytes\`**, never \`tail_bytes\` again:
     \`devin_status({ session_id, since_bytes: <previous_output_bytes> })\`
     This returns ONLY new output since your last poll. Using \`tail_bytes\` repeatedly re-fetches the same output and wastes context window.
   - If \`since_bytes\` returns "(no new output)", wait 15–30 seconds before polling again.
   - Use \`tail_bytes\` ONLY when the user explicitly asks for "full output" or you're checking a session for the first time.
7. **Do productive work while waiting — don't just poll.** The point of delegating to Devin is to parallelize. While Devin runs:
   - Work on a different subtask yourself
   - Address other user requests or todo items
   - Only check Devin status periodically (every 1–2 minutes is fine for long tasks)
   - **Do NOT sit in a tight loop repeatedly calling \`devin_wait\` or \`devin_status\`** — this wastes your own context window and adds no value
8. **Report cleanly — avoid log spam.** When updating the user on Devin's progress:
   - **Say something once, then be quiet.** Do NOT repeat "Let me wait more..." or "Still running..." every few seconds
   - Only speak up when there is meaningful news: new output, a status change (completed/error/cancelled/stalled), or a reasonable milestone (e.g., every 2–3 minutes for very long tasks)
   - If the user asks "How is Devin doing?", give a concise one-line status + any blockers
9. **Very long tasks (Docker builds, compilations, downloads).**
   - \`devin_wait\` always caps at **30 seconds per call** regardless of \`timeout_ms\` — MCP clients timeout tool calls. Do NOT pass huge \`timeout_ms\` values expecting it to block for minutes.
   - A 20-minute Docker build means you will call \`devin_wait\` roughly 40 times if you loop every 30s. **This is wasteful and annoying.** Instead:
     - Call \`devin_wait\` once → it returns "still running" after 30s
     - **Tell the user ONCE:** "Devin is working on the Docker build. This typically takes 15–30 minutes. I'll check back periodically and let you know when it's done."
     - Then **be completely silent** about this session until there is actual news
     - For tasks expected to take >10 minutes, check every **5 minutes** (not every 2–3 minutes)
     - Call \`devin_status({ session_id, since_bytes: <last_output_bytes> })\` → if still \`running\` with no new output, that is completely normal. Wait another 5 minutes.
     - **Only break silence when:** \`completed\`, \`error\`, \`cancelled\`, \`stalled\`, or the user explicitly asks for a status update
   - **Do NOT call \`devin_wait\` repeatedly in a tight loop.** It will never block longer than 30s. Space out your checks.
10. **Report results.** When \`status\` is \`completed\`, summarize Devin's output for the user. If \`error\`, surface the error and either retry or fall back to handling it yourself.
11. **Cancel if needed.** \`devin_cancel({ session_id })\` if the user changes their mind or Devin goes off-rails.

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

## Limit & Error Recovery

When \`devin_start\` fails, the response includes a **structured error tag**. Read it and take the matching action — do NOT guess.

### Fallback chain

If a model is unavailable due to quota or usage limits, fall back in this order:

\`opus\` → \`sonnet\` → \`kimi-k2.6\` → \`swe-1-6\`

(Deep → Balanced → Standard → Fast/Cheap)

### Error tag actions

| Tag | What happened | Agent action |
|-----|---------------|--------------|
| \`RATE_LIMIT\` | Too many requests | Wait \`retryAfterMs\`, then **retry with same model** |
| \`QUOTA_EXCEEDED\` | Model quota exhausted | **Retry with \`suggestedFallback\`** (next in chain). After the chain is exhausted, safety-net retries are \`kimi-k2.6\` first, then \`swe-1-6\`. Do NOT do the work locally — keep retrying with fallback models |
| \`CONTEXT_LIMIT\` | Prompt too long | **Summarize the prompt** (remove files, shorten instructions) or pick a model with larger context |
| \`UNKNOWN\` | Unclear error | Read the full log, diagnose, ask the user if stuck |

### Recovery workflow

1. If \`RATE_LIMIT\` → wait the specified duration, call \`devin_start\` again with **same model**
2. If \`QUOTA_EXCEEDED\` → call \`devin_start\` with \`model: suggestedFallback\`
3. If \`CONTEXT_LIMIT\` → shorten the prompt, retry with same model (or omit model for default)
4. If the fallback chain is exhausted → first retry with \`model: "kimi-k2.6"\` (default), then if that also fails retry with \`model: "swe-1-6"\` (cheap). Only tell the user after all safety-net fallbacks fail
5. **Do NOT silently skip the error or switch models without telling the user** — model selection affects cost and capability
6. **Do NOT do the work locally when Devin CLI hits a quota error** — always retry with fallback models \`kimi-k2.6\` then \`swe-1-6\` first

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
- **DON'T use \`tail_bytes\` for repeated polling — always use \`since_bytes\` after the first status call.** Using \`tail_bytes\` repeatedly re-fetches the same output, wastes context window, and causes the MCP client to time out on large outputs. Track \`output_bytes\` from each response and pass it as \`since_bytes\` on the next poll.
- **Don't poll in a tight loop.** Wait 15–30 seconds between \`devin_status\` calls. More importantly: **do OTHER work while waiting**, don't just sit there calling \`devin_wait\` repeatedly. That wastes your own context window and annoys the user.
- **Don't spam the user with repetitive "waiting" messages.** Say it once when you start waiting, then be silent until there is meaningful news (new output, status change, or a 2–3 minute milestone). The user does not need to hear "Let me wait more..." 20 times.
- **Don't expect \`devin_wait\` to block for minutes.** It caps at 30 seconds per call to avoid MCP client timeout errors (-32001). If the session is still running, the response gives you \`output_bytes\` — use it with \`devin_status({ since_bytes })\` for incremental polling, or go do something else and come back later.
- **Default is \`dangerous\`** — all Devin CLI sessions bypass permission prompts automatically. Use \`permission_mode: "auto"\` only if the user explicitly wants Devin to ask for dangerous operations.
- **Don't forget to cancel.** Stale background sessions waste subscription budget. Use \`devin_cancel_batch\` when cancelling multiple sessions at once.

---

## Ultrawork loop integration (safeguard)

When you are running inside an **ultrawork loop** (\`/ulw-loop\` or \`ultrawork\` keyword detected), the loop requires **Oracle verification** before declaring completion. Devin runs as an isolated background subprocess and **cannot participate in Oracle verification**. This creates a critical orchestration requirement:

**DO NOT emit \`<promise>DONE</promise>\` until:**
1. Devin's session has fully completed (status is \`completed\`, \`error\`, or \`cancelled\`)
2. You have read and fully integrated all of Devin's output into your own work
3. The combined result (your work + Devin's output) represents the complete deliverable

**If you emit \`<promise>DONE</promise>\` while Devin is still running**, the Oracle will review an incomplete result and likely reject it, causing the loop to restart with a "Verification failed" prompt.

**Practical workflow in ultrawork mode:**
- Delegate a self-contained subtask to Devin via \`devin_start\`
- Continue working on your own portion of the task in parallel
- Poll Devin incrementally with \`devin_status({ since_bytes: ... })\`
- When Devin reports \`completed\`, read the final output and apply/integrate it
- Only after everything is integrated and verified by you, emit \`<promise>DONE</promise>\`
- The loop will then trigger Oracle verification of the combined result

If Devin's output is incomplete or errored, fix the issues yourself or restart Devin with a clearer prompt before claiming completion.

---

## Resilience features

### Session re-attachment
If the MCP server restarts, sessions from the previous run are automatically recovered as **orphaned** status. They appear in \`devin_list\` with their logs still readable via \`devin_status\`, but cannot be cancelled or waited on (the process is gone). This prevents "ghost" sessions that disappear silently.

### Pre-flight validation
Before spawning, \`devin_start\` validates:
- The \`devin\` binary exists in PATH (cached after first check)
- The model name is recognized — typos like \`"sonet"\` or \`"opsu"\` are caught with "did you mean?" suggestions
- The working directory exists and is a directory
This avoids silent spawn failures that waste time debugging.

### Auto-cleanup
Completed, errored, cancelled, and orphaned sessions are automatically removed from memory after 1 hour. Log and metadata files remain on disk for the \`devin-report\` CLI command.

### Idle detection
Running sessions are periodically checked for output growth. If a session produces no new output for 30 minutes, it is marked as **stalled**. Stalled sessions are NOT auto-cancelled — you decide whether to cancel or wait longer. Check \`devin_status\` and look for \`status: "stalled"\`.

### CLI reporting
Run \`bunx oh-my-opencode devin-report\` to see a full session report with model tiers, durations, estimated costs, and outcomes. Use \`--json\` for CI or \`--tier Deep\` to filter.

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
3. Tell user: "Started Devin (session abc-123, **Deep tier**, model **opus**) on the auth refactor. Working on the UI now."
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
3. Tell user: "Started Devin (session def-456, **Standard tier**, model **kimi-k2.6**) on the typo fix."
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
