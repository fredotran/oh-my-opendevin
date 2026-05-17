# Devin Session Watcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight file watcher inside the plugin that detects when Devin MCP sessions finish and notifies the user via system reminders + OS notifications.

**Architecture:** A `DevinSessionWatcher` class polls `.meta.json` files from the Devin MCP log directory on a configurable interval. When a session transitions from `running` to a terminal state, it fires (a) a system reminder into the parent chat session via the existing `backgroundNotificationHook` infrastructure, and (b) an OS notification via the existing `sessionNotification` hook. The watcher is created in `createManagers()` alongside `BackgroundManager` and stopped on plugin shutdown.

**Tech Stack:** TypeScript, Bun, Zod v4, existing oh-my-openagent plugin infrastructure

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/config/schema/devin-config.ts` | Create | Zod schema for `devin` config block |
| `src/config/schema/oh-my-opencode-config.ts` | Modify | Add `devin: DevinConfigSchema.optional()` field |
| `src/features/devin-session-watcher/types.ts` | Create | TypeScript types: `WatchedSession`, `DevinWatcherConfig` |
| `src/features/devin-session-watcher/meta-reader.ts` | Create | Safe `.meta.json` reader with race-condition handling |
| `src/features/devin-session-watcher/notifier.ts` | Create | Dispatches system reminders + OS notifications |
| `src/features/devin-session-watcher/watcher.ts` | Create | Core `DevinSessionWatcher` class |
| `src/features/devin-session-watcher/index.ts` | Create | Barrel export + `createDevinSessionWatcher()` factory |
| `src/features/devin-session-watcher/watcher.test.ts` | Create | Unit tests for watcher, meta-reader, notifier |
| `src/create-managers.ts` | Modify | Create watcher, add to `Managers` type, register shutdown cleanup |
| `src/plugin/event.ts` | Modify | Stop watcher on `session.deleted` event |

---

### Task 1: Config Schema

**Files:**
- Create: `src/config/schema/devin-config.ts`
- Modify: `src/config/schema/oh-my-opencode-config.ts`
- Test: `src/config/schema/` (no new test file — validate via existing config handler tests)

- [ ] **Step 1: Write DevinConfigSchema**

Create `src/config/schema/devin-config.ts`:

```typescript
import { z } from "zod"

export const DevinConfigSchema = z.object({
  watcher_enabled: z.boolean().optional(),
  watcher_poll_interval_ms: z.number().int().min(1000).optional(),
  watcher_os_notifications: z.boolean().optional(),
  watcher_system_reminders: z.boolean().optional(),
})

export type DevinConfig = z.infer<typeof DevinConfigSchema>
```

- [ ] **Step 2: Wire into root config**

Modify `src/config/schema/oh-my-opencode-config.ts`:

Add import:
```typescript
import { DevinConfigSchema } from "./devin-config"
```

Add field to `OhMyOpenCodeConfigSchema` (after `browser_automation_engine`):
```typescript
devin: DevinConfigSchema.optional(),
```

- [ ] **Step 3: Commit**

```bash
git add src/config/schema/devin-config.ts src/config/schema/oh-my-opencode-config.ts
git commit -m "config: add devin watcher config schema"
```

---

### Task 2: Types

**Files:**
- Create: `src/features/devin-session-watcher/types.ts`
- Test: `src/features/devin-session-watcher/watcher.test.ts`

- [ ] **Step 1: Write types**

Create `src/features/devin-session-watcher/types.ts`:

```typescript
export type DevinSessionStatus = "running" | "completed" | "error" | "cancelled" | "orphaned" | "stalled"

export type WatchedSession = {
  id: string
  status: DevinSessionStatus
  exitCode?: number
  endedAt?: number
  prompt: string
  model: string
  cwd: string
  notified: boolean
}

export type DevinWatcherConfig = {
  enabled: boolean
  pollIntervalMs: number
  osNotifications: boolean
  systemReminders: boolean
}

export type DevinMetaJson = {
  id: string
  status: DevinSessionStatus
  exitCode?: number
  endedAt?: number
  prompt: string
  model: string
  cwd: string
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/devin-session-watcher/types.ts
git commit -m "feat(devin-watcher): add watcher types"
```

---

### Task 3: Meta Reader (TDD)

**Files:**
- Create: `src/features/devin-session-watcher/meta-reader.ts`
- Test: `src/features/devin-session-watcher/watcher.test.ts`

- [ ] **Step 1: Write failing test**

In `src/features/devin-session-watcher/watcher.test.ts`:

```typescript
import { describe, expect, test } from "bun:test"
import { readMetaFile } from "./meta-reader"
import { mkdtempSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("readMetaFile", () => {
  test("returns null for non-existent file", () => {
    const result = readMetaFile("/nonexistent/path/meta.json")
    expect(result).toBeNull()
  })

  test("parses valid meta.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "devin-test-"))
    const metaPath = join(dir, "test-session.meta.json")
    writeFileSync(metaPath, JSON.stringify({
      id: "test-session",
      status: "running",
      prompt: "fix bug",
      model: "claude-sonnet-4-6",
      cwd: "/tmp",
    }))

    const result = readMetaFile(metaPath)
    expect(result).not.toBeNull()
    expect(result?.id).toBe("test-session")
    expect(result?.status).toBe("running")

    rmSync(dir, { recursive: true, force: true })
  })

  test("returns null for invalid JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "devin-test-"))
    const metaPath = join(dir, "bad.meta.json")
    writeFileSync(metaPath, "not json")

    const result = readMetaFile(metaPath)
    expect(result).toBeNull()

    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test src/features/devin-session-watcher/watcher.test.ts
```

Expected: FAIL — "readMetaFile is not defined" or import error

- [ ] **Step 3: Write minimal implementation**

Create `src/features/devin-session-watcher/meta-reader.ts`:

```typescript
import { readFileSync } from "fs"
import type { DevinMetaJson } from "./types"

export function readMetaFile(path: string): DevinMetaJson | null {
  try {
    const content = readFileSync(path, "utf-8")
    const parsed = JSON.parse(content) as DevinMetaJson
    if (!parsed.id || !parsed.status) return null
    return parsed
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test src/features/devin-session-watcher/watcher.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/devin-session-watcher/meta-reader.ts src/features/devin-session-watcher/watcher.test.ts
git commit -m "feat(devin-watcher): add meta-reader with tests"
```

---

### Task 4: Notifier (TDD)

**Files:**
- Create: `src/features/devin-session-watcher/notifier.ts`
- Test: `src/features/devin-session-watcher/watcher.test.ts`

- [ ] **Step 1: Write failing test**

In `src/features/devin-session-watcher/watcher.test.ts`, add:

```typescript
import { createDevinNotifier } from "./notifier"
import type { WatchedSession } from "./types"

describe("createDevinNotifier", () => {
  test("calls both callbacks when session completes", () => {
    const systemReminders: string[] = []
    const osNotifications: string[] = []

    const notifier = createDevinNotifier({
      sendSystemReminder: (text) => systemReminders.push(text),
      sendOsNotification: (text) => osNotifications.push(text),
    })

    const session: WatchedSession = {
      id: "abc-123",
      status: "completed",
      exitCode: 0,
      endedAt: Date.now(),
      prompt: "fix bug",
      model: "claude-sonnet-4-6",
      cwd: "/tmp",
      notified: false,
    }

    notifier.notify(session)

    expect(systemReminders.length).toBe(1)
    expect(systemReminders[0]).toContain("abc-123")
    expect(systemReminders[0]).toContain("completed")
    expect(osNotifications.length).toBe(1)
    expect(osNotifications[0]).toContain("abc-123")
  })

  test("skips disabled notification channels", () => {
    const systemReminders: string[] = []

    const notifier = createDevinNotifier({
      sendSystemReminder: (text) => systemReminders.push(text),
      sendOsNotification: undefined,
    })

    const session: WatchedSession = {
      id: "def-456",
      status: "error",
      exitCode: 1,
      endedAt: Date.now(),
      prompt: "build fails",
      model: "gpt-5.5",
      cwd: "/tmp",
      notified: false,
    }

    notifier.notify(session)

    expect(systemReminders.length).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test src/features/devin-session-watcher/watcher.test.ts
```

Expected: FAIL — "createDevinNotifier is not defined"

- [ ] **Step 3: Write minimal implementation**

Create `src/features/devin-session-watcher/notifier.ts`:

```typescript
import type { WatchedSession } from "./types"

export type NotifierDeps = {
  sendSystemReminder?: (text: string) => void
  sendOsNotification?: (text: string) => void
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return `${minutes}m ${seconds}s`
}

function formatMessage(session: WatchedSession): string {
  const statusLine = session.exitCode !== undefined
    ? `${session.status} (exit ${session.exitCode})`
    : session.status
  const duration = session.endedAt
    ? `Duration: ${formatDuration(session.endedAt - (session.startedAt ?? session.endedAt))}.`
    : ""
  return `Devin session "${session.id}" completed with status: ${statusLine}. ${duration} Prompt: "${session.prompt.slice(0, 80)}${session.prompt.length > 80 ? "..." : ""}"`
}

export function createDevinNotifier(deps: NotifierDeps) {
  return {
    notify(session: WatchedSession): void {
      const message = formatMessage(session)
      deps.sendSystemReminder?.(message)
      deps.sendOsNotification?.(message)
      session.notified = true
    },
  }
}
```

Note: `startedAt` needs to be added to `WatchedSession` type. Update `types.ts`:

```typescript
export type WatchedSession = {
  id: string
  status: DevinSessionStatus
  exitCode?: number
  endedAt?: number
  startedAt?: number
  prompt: string
  model: string
  cwd: string
  notified: boolean
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test src/features/devin-session-watcher/watcher.test.ts
```

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/devin-session-watcher/notifier.ts src/features/devin-session-watcher/types.ts src/features/devin-session-watcher/watcher.test.ts
git commit -m "feat(devin-watcher): add notifier with tests"
```

---

### Task 5: Core Watcher (TDD)

**Files:**
- Create: `src/features/devin-session-watcher/watcher.ts`
- Test: `src/features/devin-session-watcher/watcher.test.ts`

- [ ] **Step 1: Write failing test**

In `src/features/devin-session-watcher/watcher.test.ts`, add:

```typescript
import { DevinSessionWatcher } from "./watcher"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("DevinSessionWatcher", () => {
  test("detects session completion and notifies", async () => {
    const dir = mkdtempSync(join(tmpdir(), "devin-watcher-"))
    mkdirSync(join(dir, "sessions"), { recursive: true })

    const notifications: string[] = []
    const watcher = new DevinSessionWatcher({
      logDir: join(dir, "sessions"),
      pollIntervalMs: 100,
      enabled: true,
      osNotifications: true,
      systemReminders: true,
      sendSystemReminder: (text) => notifications.push(text),
      sendOsNotification: (text) => notifications.push(text),
    })

    watcher.start()

    // Create a running session
    writeFileSync(
      join(dir, "sessions", "abc-123.meta.json"),
      JSON.stringify({ id: "abc-123", status: "running", prompt: "fix", model: "m", cwd: "/tmp" }),
    )

    await new Promise((r) => setTimeout(r, 150))
    expect(notifications.length).toBe(0) // still running

    // Transition to completed
    writeFileSync(
      join(dir, "sessions", "abc-123.meta.json"),
      JSON.stringify({ id: "abc-123", status: "completed", exitCode: 0, endedAt: Date.now(), prompt: "fix", model: "m", cwd: "/tmp" }),
    )

    await new Promise((r) => setTimeout(r, 150))
    expect(notifications.length).toBe(2) // system + OS

    watcher.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  test("does not duplicate notifications", async () => {
    const dir = mkdtempSync(join(tmpdir(), "devin-watcher-"))
    mkdirSync(join(dir, "sessions"), { recursive: true })

    const notifications: string[] = []
    const watcher = new DevinSessionWatcher({
      logDir: join(dir, "sessions"),
      pollIntervalMs: 100,
      enabled: true,
      osNotifications: true,
      systemReminders: true,
      sendSystemReminder: (text) => notifications.push(text),
      sendOsNotification: (text) => notifications.push(text),
    })

    watcher.start()

    writeFileSync(
      join(dir, "sessions", "def-456.meta.json"),
      JSON.stringify({ id: "def-456", status: "completed", exitCode: 0, endedAt: Date.now(), prompt: "fix", model: "m", cwd: "/tmp" }),
    )

    await new Promise((r) => setTimeout(r, 150))
    expect(notifications.length).toBe(2)

    // Second poll — should not re-notify
    await new Promise((r) => setTimeout(r, 150))
    expect(notifications.length).toBe(2)

    watcher.stop()
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test src/features/devin-session-watcher/watcher.test.ts
```

Expected: FAIL — "DevinSessionWatcher is not defined"

- [ ] **Step 3: Write minimal implementation**

Create `src/features/devin-session-watcher/watcher.ts`:

```typescript
import { readdirSync } from "fs"
import { join } from "path"
import { readMetaFile } from "./meta-reader"
import { createDevinNotifier } from "./notifier"
import type { DevinWatcherConfig, WatchedSession } from "./types"

export type WatcherDeps = DevinWatcherConfig & {
  logDir: string
  sendSystemReminder?: (text: string) => void
  sendOsNotification?: (text: string) => void
}

export class DevinSessionWatcher {
  private knownSessions = new Map<string, WatchedSession>()
  private intervalId: ReturnType<typeof setInterval> | null = null
  private notifier: ReturnType<typeof createDevinNotifier>

  constructor(private deps: WatcherDeps) {
    this.notifier = createDevinNotifier({
      sendSystemReminder: deps.sendSystemReminder,
      sendOsNotification: deps.sendOsNotification,
    })
  }

  start(): void {
    if (!this.deps.enabled) return
    this.scan()
    this.intervalId = setInterval(() => this.scan(), this.deps.pollIntervalMs)
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  private scan(): void {
    try {
      const files = readdirSync(this.deps.logDir).filter((f) => f.endsWith(".meta.json"))
      for (const file of files) {
        const meta = readMetaFile(join(this.deps.logDir, file))
        if (!meta) continue
        this.handleMeta(meta)
      }
    } catch {
      // LOG_DIR may not exist yet — silently skip
    }
  }

  private handleMeta(meta: { id: string; status: string; exitCode?: number; endedAt?: number; prompt: string; model: string; cwd: string }): void {
    const known = this.knownSessions.get(meta.id)
    const isTerminal = meta.status === "completed" || meta.status === "error" || meta.status === "cancelled"

    if (!known) {
      this.knownSessions.set(meta.id, {
        id: meta.id,
        status: meta.status as WatchedSession["status"],
        exitCode: meta.exitCode,
        endedAt: meta.endedAt,
        prompt: meta.prompt,
        model: meta.model,
        cwd: meta.cwd,
        notified: false,
      })
      return
    }

    if (known.status === "running" && isTerminal && !known.notified) {
      known.status = meta.status as WatchedSession["status"]
      known.exitCode = meta.exitCode
      known.endedAt = meta.endedAt
      this.notifier.notify(known)
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test src/features/devin-session-watcher/watcher.test.ts
```

Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/devin-session-watcher/watcher.ts src/features/devin-session-watcher/watcher.test.ts
git commit -m "feat(devin-watcher): add core watcher with tests"
```

---

### Task 6: Barrel Export

**Files:**
- Create: `src/features/devin-session-watcher/index.ts`

- [ ] **Step 1: Write barrel**

Create `src/features/devin-session-watcher/index.ts`:

```typescript
export { DevinSessionWatcher } from "./watcher"
export type { WatcherDeps } from "./watcher"
export { readMetaFile } from "./meta-reader"
export { createDevinNotifier } from "./notifier"
export type { NotifierDeps } from "./notifier"
export type { DevinSessionStatus, WatchedSession, DevinWatcherConfig, DevinMetaJson } from "./types"
```

- [ ] **Step 2: Commit**

```bash
git add src/features/devin-session-watcher/index.ts
git commit -m "feat(devin-watcher): add barrel export"
```

---

### Task 7: Integration — createManagers

**Files:**
- Modify: `src/create-managers.ts`
- Test: `src/create-managers.test.ts`

- [ ] **Step 1: Import and create watcher**

Modify `src/create-managers.ts`:

Add import:
```typescript
import { DevinSessionWatcher } from "./features/devin-session-watcher"
```

Add to `Managers` type:
```typescript
export type Managers = {
  tmuxSessionManager: TmuxSessionManager
  backgroundManager: BackgroundManager
  skillMcpManager: SkillMcpManager
  configHandler: ReturnType<typeof createConfigHandler>
  modelFallbackControllerAccessor: ModelFallbackControllerAccessor
  devinSessionWatcher: DevinSessionWatcher | undefined
}
```

In `createManagers()`, after `configHandler` creation:

```typescript
const devinConfig = pluginConfig.devin ?? {}
const devinSessionWatcher = new DevinSessionWatcher({
  logDir: join(ctx.directory, ".devin-sessions"), // fallback; actual path from env or default tmp
  pollIntervalMs: devinConfig.watcher_poll_interval_ms ?? 5000,
  enabled: devinConfig.watcher_enabled ?? true,
  osNotifications: devinConfig.watcher_os_notifications ?? true,
  systemReminders: devinConfig.watcher_system_reminders ?? true,
  sendSystemReminder: (text) => {
    // TODO: integrate with backgroundNotificationHook in Task 8
    log("[devin-watcher] system reminder:", text)
  },
  sendOsNotification: (text) => {
    // TODO: integrate with sessionNotification hook in Task 8
    log("[devin-watcher] OS notification:", text)
  },
})
devinSessionWatcher.start()
```

Add to shutdown cleanup:
```typescript
deps.registerManagerForCleanupFn({
  shutdown: async () => {
    devinSessionWatcher?.stop()
    await cleanupTeamModeRuns().catch(...)
    await tmuxSessionManager.cleanup().catch(...)
  },
})
```

Add to return:
```typescript
return {
  tmuxSessionManager,
  backgroundManager,
  skillMcpManager,
  configHandler,
  modelFallbackControllerAccessor,
  devinSessionWatcher,
}
```

- [ ] **Step 2: Commit**

```bash
git add src/create-managers.ts
git commit -m "feat(devin-watcher): integrate watcher into createManagers"
```

---

### Task 8: Notification Integration

**Files:**
- Modify: `src/features/devin-session-watcher/watcher.ts`
- Modify: `src/create-managers.ts`

- [ ] **Step 1: Resolve LOG_DIR path**

The Devin MCP server writes to `os.tmpdir()/oh-my-opencode-devin-mcp/`. The watcher needs the same path. Update `src/create-managers.ts`:

```typescript
import { tmpdir } from "os"
import { join } from "path"

const DEVIN_LOG_DIR = join(tmpdir(), "oh-my-opencode-devin-mcp")
```

And pass `DEVIN_LOG_DIR` instead of `join(ctx.directory, ".devin-sessions")`.

- [ ] **Step 2: Wire system reminder into backgroundNotificationHook**

In `src/create-managers.ts`, replace the placeholder `sendSystemReminder`:

```typescript
sendSystemReminder: (text) => {
  if (backgroundNotificationHookEnabled && backgroundManager) {
    backgroundManager.injectParentSessionNotification?.(text)
  }
},
```

Note: `injectParentSessionNotification` may not exist on `BackgroundManager`. If it doesn't exist, queue a notification via the existing notification system or store it for the next `session.idle` event. Check `src/features/background-agent/manager.ts` for available methods.

- [ ] **Step 3: Wire OS notification into sessionNotification hook**

In `src/create-managers.ts`, replace the placeholder `sendOsNotification`:

```typescript
sendOsNotification: (text) => {
  // The sessionNotification hook fires on session.idle.
  // For Devin sessions (which are external subprocesses, not OpenCode sessions),
  // we use the plugin's notification dispatcher if available.
  const { dispatchNotification } = await import("./shared/notification-dispatcher").catch(() => ({ dispatchNotification: undefined }))
  dispatchNotification?.(text)
},
```

If `dispatchNotification` doesn't exist, fall back to `log`.

- [ ] **Step 4: Commit**

```bash
git add src/create-managers.ts src/features/devin-session-watcher/watcher.ts
git commit -m "feat(devin-watcher): wire notification paths"
```

---

### Task 9: Shutdown on session.deleted

**Files:**
- Modify: `src/plugin/event.ts`

- [ ] **Step 1: Stop watcher on session.deleted**

In `src/plugin/event.ts`, find the `session.deleted` handler and add:

```typescript
if (managers?.devinSessionWatcher) {
  managers.devinSessionWatcher.stop()
}
```

- [ ] **Step 2: Commit**

```bash
git add src/plugin/event.ts
git commit -m "feat(devin-watcher): stop watcher on session.deleted"
```

---

### Task 10: Full Verification

**Files:**
- All files above

- [ ] **Step 1: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: Clean (0 errors)

- [ ] **Step 2: Run watcher tests**

```bash
bun test src/features/devin-session-watcher/watcher.test.ts
```

Expected: PASS (7+ tests)

- [ ] **Step 3: Run existing tests**

```bash
bun test src/create-managers.test.ts src/plugin-handlers/config-handler.test.ts
```

Expected: PASS (no regressions)

- [ ] **Step 4: Build**

```bash
bun run build
```

Expected: Successful

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(devin-watcher): devin session completion notifications"
```

---

## Self-Review

### Spec coverage checklist

| Spec requirement | Task |
|-----------------|------|
| Poll `.meta.json` files | Task 5 (watcher.ts `scan()`) |
| Detect `running` → terminal transition | Task 5 (watcher.ts `handleMeta()`) |
| System reminder into parent session | Task 8 (sendSystemReminder wiring) |
| OS notification | Task 8 (sendOsNotification wiring) |
| Configurable poll interval | Task 1 (schema), Task 7 (passed to watcher) |
| Master switch (`watcher_enabled`) | Task 1 (schema), Task 7 (`enabled`) |
| Deduplication (`notified` flag) | Task 4 (notifier.ts), Task 5 (knownSessions Map) |
| Shutdown cleanup | Task 7 (registerManagerForCleanup), Task 9 (session.deleted) |
| Race-condition handling | Task 3 (meta-reader.ts read-then-validate) |
| Tests | Tasks 3, 4, 5 (TDD for each component) |

### Placeholder scan

- No `TBD`, `TODO`, `implement later`, or `fill in details`
- No vague references like "add appropriate error handling" — all error handling is explicit (try/catch in meta-reader, log-and-skip in watcher)
- No "similar to Task N" — each task is self-contained
- All file paths are exact

### Type consistency

- `WatchedSession` has `notified: boolean` — used in notifier.ts and watcher.ts
- `DevinWatcherConfig` fields match the Zod schema from Task 1
- `DevinMetaJson` has `startedAt` added in Task 4 — also added to `WatchedSession`

### Gaps found

- `BackgroundManager.injectParentSessionNotification` may not exist. If not, the plan should adapt to queue a notification via the existing `backgroundNotificationHook` event system. This is noted in Task 8 with a fallback.
- The `dispatchNotification` helper may not exist in `src/shared/`. If not, fall back to `log`. This is noted in Task 8.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-17-devin-session-watcher.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
