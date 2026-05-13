# Devin CLI Limit & Error Recovery — Design Spec

**Date**: 2026-05-13
**Status**: Approved for implementation

## Problem

When a Devin CLI session hits usage limits (rate limit, quota cap, context window), the `devin-cli` skill template gives the agent no recovery guidance. The agent sees `status: error` and raw stderr, but does not know whether to:
- Retry with backoff (rate limit)
- Fallback to a cheaper model (quota cap)
- Truncate the prompt (context limit)
- Ask the user (irrecoverable)

## Solution: Agent-Driven Fallback Chain

The MCP server detects limit errors and returns **structured error tags**. The agent decides the recovery action using a documented fallback chain.

## Architecture

```
+----------------------------+      +---------------------------+
|  devin_start spawn fails   |      |  Skill template guidance  |
|  (rate/quota/context)      |      |  - Fallback chain         |
|                            |      |  - Retry patterns           |
|  Server parses stderr -->    | -->  |  - Error tag actions      |
|  Returns tagged error      |      |                             |
|  with suggested fallback   |      |  Agent decides action      |
+----------------------------+      +---------------------------+
```

## MCP Server Changes

### 1. Error Detection (session-store.ts)

Add `detectSpawnError(error, logContent)` that inspects the spawn failure or log tail and returns:

```typescript
type SpawnErrorHint = {
  tag: "RATE_LIMIT" | "QUOTA_EXCEEDED" | "CONTEXT_LIMIT" | "UNKNOWN"
  message: string
  retryAfterMs?: number          // for RATE_LIMIT
  suggestedFallback?: string     // for QUOTA_EXCEEDED
  suggestedAction?: string       // for CONTEXT_LIMIT
}
```

Detection patterns (case-insensitive):
- `RATE_LIMIT`: `rate limit`, `too many requests`, `429`, `retry after`
- `QUOTA_EXCEEDED`: `quota exceeded`, `usage limit`, `out of credits`, `billing limit`
- `CONTEXT_LIMIT`: `context length`, `token limit`, `maximum context`, `too many tokens`

### 2. Fallback Chain (tiers.ts)

Add:
```typescript
export const FALLBACK_CHAIN = ["opus", "sonnet", "kimi-k2.6", "swe"]
export function getFallbackModel(current: string | undefined): string | undefined
```

Returns the next model in the chain, or `undefined` if at the end.

### 3. Auto-fallback Flag (session-store.ts + types.ts)

Add `autoFallback?: boolean` to `StartOptions`. When `true` and `devin_start` fails with `QUOTA_EXCEEDED`, the server automatically retries with `getFallbackModel()` until success or chain exhaustion.

**Default: `false`** — agent-driven by default. Auto-fallback is an opt-in convenience.

### 4. devin_start Response Enhancement (server.ts)

If spawn fails with a detected limit error, return a text result containing:
```
[devin_start] FAILED — {tag}

{message}

SUGGESTED ACTION: {action}
```

Where `action` is:
- `RATE_LIMIT`: "Wait {retryAfterMs}ms then retry with same model."
- `QUOTA_EXCEEDED`: "Retry with fallback model: {suggestedFallback}."
- `CONTEXT_LIMIT`: "Shorten prompt or use model with larger context window."

## Skill Template Changes (devin-cli.ts)

Add a "Limit & Error Recovery" section:

### Fallback chain
`opus` → `sonnet` → `kimi-k2.6` → `swe`

Use `getFallbackModel(current)` to find the next option.

### Error tag actions

| Tag | What happened | Agent action |
|-----|---------------|--------------|
| `RATE_LIMIT` | Too many requests | Wait `retryAfterMs`, retry same model |
| `QUOTA_EXCEEDED` | Model quota exhausted | Retry with `suggestedFallback`; if chain exhausted, ask user |
| `CONTEXT_LIMIT` | Prompt too long | Summarize prompt, remove files, or use larger-context model |
| `UNKNOWN` | Unclear error | Read full log, diagnose, ask user if stuck |

### Workflow when devin_start returns an error tag

1. Read the error tag and suggested action
2. If `RATE_LIMIT`: wait, retry same model
3. If `QUOTA_EXCEEDED`: call `devin_start` with `model: suggestedFallback`
4. If `CONTEXT_LIMIT`: reduce prompt size, retry with same or larger-context model
5. If chain exhausted or error persists: tell the user and ask for direction

## Testing Plan

1. **Error detection tests** — mock stderr strings, verify correct tag assignment
2. **Fallback chain tests** — verify `getFallbackModel()` returns correct next model
3. **Auto-fallback tests** — verify `autoFallback=true` retries down the chain
4. **End-to-end tests** — verify `devin_start` returns structured error on limit failure

## Files Modified

- `src/mcp-servers/devin/tiers.ts` — add `FALLBACK_CHAIN`, `getFallbackModel()`
- `src/mcp-servers/devin/session-store.ts` — add error detection, auto-fallback
- `src/mcp-servers/devin/server.ts` — format structured errors in `devin_start`
- `src/mcp-servers/devin/types.ts` — add `SpawnErrorHint`, `autoFallback`
- `src/features/builtin-skills/skills/devin-cli.ts` — add recovery section
- `src/mcp-servers/devin/tiers.test.ts` — fallback chain tests
- `src/mcp-servers/devin/session-store.test.ts` — error detection tests
