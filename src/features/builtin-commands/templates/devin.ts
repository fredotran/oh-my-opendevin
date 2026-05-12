export const DEVIN_STATUS_TEMPLATE = `# Devin Status Command

The user invoked \`/devin-status\` to check on running Devin sessions.

---

## Your task

1. Call \`devin_list({ include_output: true })\` to enumerate all sessions in the current MCP server process.
2. If there are no sessions, tell the user "No active Devin sessions." and stop.
3. Otherwise, for each session render a compact summary:
   - Session ID (short form: first 8 chars)
   - Status (running / completed / error / cancelled)
   - Duration
   - Model (if known)
   - One-line prompt preview
4. If the user passed a specific session id in the \`<user-request>\` block (e.g. \`/devin-status abc-123\`), call \`devin_status({ session_id, tail_bytes: 16384 })\` for that session and render the full tail.
5. End with a hint: "Use \`/devin-cancel <id>\` to stop a session, or \`/devin-status <id>\` for full output."

---

## Optional flag

- \`--full\` → render full output (tail_bytes: 65536) for every session, not just the targeted one.
`

export const DEVIN_CANCEL_TEMPLATE = `# Devin Cancel Command

The user invoked \`/devin-cancel\` to stop one or more Devin sessions.

---

## Your task

1. **If the user passed a session id** in the \`<user-request>\` block (e.g. \`/devin-cancel abc-123\` or a partial prefix):
   - Call \`devin_list()\` to find the matching session id (allow prefix match — pick the unique session whose id starts with the provided string)
   - If no match, tell the user and stop.
   - If multiple matches, list them and ask the user to disambiguate.
   - Otherwise, call \`devin_cancel({ session_id })\` and report the result.
2. **If the user passed \`--all\`**, cancel every running session:
   - Call \`devin_list()\`
   - For each session with \`status: "running"\`, call \`devin_cancel({ session_id })\`
   - Report a summary of how many were cancelled.
3. **If the user passed nothing**, render the running sessions and ask which to cancel:
   - Call \`devin_list({ include_output: false })\`
   - List running sessions (id + prompt preview)
   - Wait for the user's reply.

---

## Anti-pattern

Never silently cancel multiple sessions when the user only asked about one. Confirm intent on \`--all\`.
`
