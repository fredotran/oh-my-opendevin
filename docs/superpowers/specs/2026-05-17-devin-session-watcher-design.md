# Devin Session Watcher — Design Spec

**Date:** 2026-05-17  
**Branch:** `fredotran/dev`  
**Status:** Approved

## Problem

The Devin MCP server (`src/mcp-servers/devin/`) runs Devin CLI sessions as background subprocesses and writes `.meta.json` files when they exit. However, there is no notification path back to OpenCode — the agent must poll `devin_status` or `devin_wait` to know when a session finishes. This wastes context window and annoys users.

## Goal

Add a lightweight watcher inside the oh-my-openagent plugin that detects Devin session completion by monitoring `.meta.json` files, then notifies the user through two channels:

1. **System reminder** injected into the parent chat session
2. **OS notification** (native toast)

## Architecture

```
┌─────────────────┐     poll every 5s     ┌─────────────────┐
│  MCP server     │ ───────────────────► │  Plugin watcher │
│  writes .meta   │                       │  reads .meta    │
│  json on exit   │                       │  detects change │
└─────────────────┘                       └────────┬────────┘
                                                   │
                    ┌──────────────────────────────┼──────────────┐
                    ▼                              ▼              ▼
              ┌──────────┐               ┌─────────────────┐  ┌──────────┐
              │ Known    │               │ System reminder │  │ OS notif │
              │ state    │               │ injected into   │  │ (native) │
              │ Map      │               │ parent session  │  │          │
              └──────────┘               └─────────────────┘  └──────────┘
```

## Components

| File | Purpose | LOC (est) |
|------|---------|-----------|
| `src/features/devin-session-watcher/watcher.ts` | Core `DevinSessionWatcher` class: scan, diff, dispatch | ~80 |
| `src/features/devin-session-watcher/meta-reader.ts` | Safe `.meta.json` reader with race-condition handling | ~30 |
| `src/features/devin-session-watcher/notifier.ts` | Dispatches system reminders + OS notifications | ~40 |
| `src/features/devin-session-watcher/types.ts` | `WatchedSession`, `DevinWatcherConfig` | ~15 |
| `src/features/devin-session-watcher/index.ts` | Barrel export + `createDevinSessionWatcher()` factory | ~10 |
| `src/features/devin-session-watcher/watcher.test.ts` | Unit tests | ~120 |

## Data Flow

1. **Poll** — `setInterval` scans `LOG_DIR/*.meta.json` every `watcher_poll_interval_ms`
2. **Read** — `meta-reader.ts` reads each file, validates JSON, extracts `id`, `status`, `exitCode`, `endedAt`
3. **Diff** — Compare against `KnownState` Map (key: session id)
4. **Detect transition** — `running` → (`completed` | `error` | `cancelled`)
5. **Notify** — Fire both notification paths in parallel
6. **Update** — Update `KnownState` with new status

## Configuration

New optional block in oh-my-openagent config (all fields have defaults):

```jsonc
{
  "devin": {
    "watcher_enabled": true,
    "watcher_poll_interval_ms": 5000,
    "watcher_os_notifications": true,
    "watcher_system_reminders": true
  }
}
```

- `watcher_enabled`: Master switch. Default `true`.
- `watcher_poll_interval_ms`: Poll interval. Default `5000` (5s). Min `1000`.
- `watcher_os_notifications`: Send OS toasts. Default `true`.
- `watcher_system_reminders`: Inject system reminders. Default `true`.

## Notification Details

### System reminder (into parent session)

Uses the existing `backgroundNotificationHook` pattern. The watcher injects a `<system-reminder>` into the parent session's message stream:

```
[system-reminder] Devin session "abc-123" completed with status: completed (exit 0).
Duration: 12m 34s. Log: /tmp/oh-my-opencode-devin-mcp/abc-123.log
```

The agent sees this and can tell the user or act on the result.

### OS notification

Reuses the existing `sessionNotification` hook infrastructure. Calls the OpenCode client's notification API if available. Falls back silently if unavailable (headless environments).

## Error Handling

| Scenario | Behavior |
|----------|----------|
| `.meta.json` read fails | Log warning, skip file, retry next poll |
| Invalid JSON | Log warning, skip file |
| MCP server writing mid-read | Use read-then-validate pattern; inconsistent state detected on next poll |
| `LOG_DIR` missing | Watch for directory creation; if never appears, watcher stays idle |
| Parent session closed | System reminder dropped silently; OS notification still fires |
| Duplicate notification | Track `notified` flag in `KnownState`; never notify same session twice |

## Lifecycle

- **Start**: Created in `createManagers()` alongside `BackgroundManager` and `TmuxSessionManager`
- **Stop**: Cleaned up in plugin shutdown hook (clear interval, flush pending)
- **Idle**: When no `.meta.json` files exist, sleeps at full interval (no busy-wait)

## Integration Points

| Point | File | Change |
|-------|------|--------|
| Manager creation | `src/create-managers.ts` | Add `createDevinSessionWatcher()` call |
| Config schema | `src/config/schema/` | Add `devin` block to root schema |
| Shutdown | `src/plugin/event.ts` | Stop watcher on `session.deleted` |

## Testing Strategy

| Test file | Coverage |
|-----------|----------|
| `watcher.test.ts` | Status transition detection, interval behavior, duplicate suppression |
| `meta-reader.test.ts` | Safe JSON parsing, race condition handling, missing files |
| `notifier.test.ts` | Both notification paths fire, disabled flags respected |

## Out of Scope

- Real-time notifications (file watcher / inotify) — polling is sufficient and simpler
- Retry logic for failed notifications — log and move on
- Integration with `backgroundNotificationHook`'s queueing — direct injection is simpler for MVP

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Watcher adds overhead | Poll interval is configurable; idle state is cheap |
| Conflicts with MCP server file writes | Read-then-validate pattern; skip inconsistent files |
| Notifications feel spammy | Only fire on terminal transitions; deduplicated via `notified` flag |
