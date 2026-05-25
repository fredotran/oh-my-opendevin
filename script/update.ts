#!/usr/bin/env bun
// script/update.ts
// Automated upstream sync updater for fredotran/dev

import { $ } from "bun"
import { existsSync, readFileSync, writeFileSync } from "node:fs"

const DRY_RUN = process.argv.includes("--dry-run")
const UPSTREAM_BRANCH = "upstream/dev"
const TARGET_BRANCH = "fredotran/dev"
const FORK_VERSION = "2.0.0"
const FORK_NAME = "oh-my-opendevin"
const LEGACY_NAME = "oh-my-opencode"

type ConflictStrategy = "ours" | "theirs" | "custom"

interface ConflictRule {
  pattern: RegExp | string
  strategy: ConflictStrategy
  customResolver?: (filePath: string) => Promise<void>
}

function log(msg: string, detail?: unknown): void {
  const prefix = DRY_RUN ? "[DRY-RUN]" : "[UPDATE]"
  if (detail !== undefined) {
    console.log(`${prefix} ${msg}`, JSON.stringify(detail))
  } else {
    console.log(`${prefix} ${msg}`)
  }
}

function fatal(msg: string): never {
  console.error(`[FATAL] ${msg}`)
  process.exit(1)
}

async function checkPreconditions(): Promise<void> {
  const branch = (await $`git rev-parse --abbrev-ref HEAD`.text()).trim()
  if (branch !== TARGET_BRANCH) {
    fatal(`Must be on ${TARGET_BRANCH}, currently on ${branch}`)
  }

  const status = (await $`git status --porcelain`.text()).trim()
  if (status.length > 0) {
    fatal("Working tree must be clean. Stash or commit changes first.")
  }
}

async function createBackup(): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000)
  const backupBranch = `backup-${TARGET_BRANCH.replace(/\//g, "-")}-${timestamp}`
  log(`Creating backup branch: ${backupBranch}`)
  if (!DRY_RUN) {
    await $`git branch -f ${backupBranch} ${TARGET_BRANCH}`
  }
  return backupBranch
}

async function fetchUpstream(): Promise<void> {
  log("Fetching upstream...")
  await $`git fetch upstream`
  log("Upstream fetched")
}

async function attemptMerge(): Promise<boolean> {
  log(`Attempting merge of ${UPSTREAM_BRANCH} into ${TARGET_BRANCH}...`)
  try {
    if (DRY_RUN) {
      log("Would run: git merge --no-edit", UPSTREAM_BRANCH)
      return true
    }
    await $`git merge ${UPSTREAM_BRANCH} --no-edit`
    log("Merge completed cleanly")
    return true
  } catch {
    log("Merge has conflicts, will attempt resolution...")
    return false
  }
}

async function getConflictedFiles(): Promise<string[]> {
  const output = (await $`git diff --name-only --diff-filter=U`.text()).trim()
  return output ? output.split("\n").filter(Boolean) : []
}

function matchesPattern(filePath: string, pattern: RegExp | string): boolean {
  if (pattern instanceof RegExp) {
    return pattern.test(filePath)
  }
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
  return new RegExp(`^${escaped}$`).test(filePath)
}

const CONFLICT_RULES: ConflictRule[] = [
  // Auto-generated docs — always take upstream
  { pattern: "AGENTS.md", strategy: "theirs" },
  { pattern: /^src\/agents\/AGENTS\.md$/, strategy: "theirs" },

  // README: take upstream (regenerated frequently), fork header can be reapplied
  {
    pattern: "README.md",
    strategy: "custom",
    async customResolver(filePath: string) {
      await $`git checkout --theirs ${filePath}`
      await $`git add ${filePath}`
      log("Resolved README.md: took upstream (fork header can be re-applied manually)")
    },
  },

  // Root package: keep fork name/version, keep upstream everything else
  {
    pattern: "package.json",
    strategy: "custom",
    async customResolver(filePath: string) {
      await $`git checkout --theirs ${filePath}`
      const content = readFileSync(filePath, "utf-8")
      let patched = content
        .replace(/"name":\s*"oh-my-opencode"/, `"name": "${FORK_NAME}"`)
        .replace(/"version":\s*"[\d.]+"/, `"version": "${FORK_VERSION}"`)
        .replace(
          /"description":\s*"[^"]+"/,
          `"description": "The Best AI Agent Harness - Batteries-Included OpenCode Plugin with Multi-Model Orchestration, Parallel Background Agents, and Crafted LSP/AST Tools - Fork with Devin CLI integration"`
        )
      // Patch optionalDependencies names to fork prefix
      patched = patched.replace(
        /"oh-my-opencode-(darwin|linux|windows)-/g,
        `"${FORK_NAME}-$1-`
      )
      writeFileSync(filePath, patched)
      await $`git add ${filePath}`
      log("Resolved package.json: kept fork name/version, took upstream deps/workspaces")
    },
  },

  // Platform binary packages: keep fork version
  {
    pattern: /^packages\/oh-my-opencode-[^/]+\/package\.json$/,
    strategy: "custom",
    async customResolver(filePath: string) {
      await $`git checkout --ours ${filePath}`
      await $`git add ${filePath}`
      log(`Resolved ${filePath}: kept fork version`)
    },
  },

  // Agent overrides: keep devin agent + catchall from upstream
  {
    pattern: "src/config/schema/agent-overrides.ts",
    strategy: "custom",
    async customResolver(filePath: string) {
      await $`git checkout --theirs ${filePath}`
      let content = readFileSync(filePath, "utf-8")
      // Add devin agent if missing
      if (!content.includes('devin: AgentOverrideConfigSchema.optional()')) {
        content = content.replace(
          '}).catchall(AgentOverrideConfigSchema.optional())',
          '  devin: AgentOverrideConfigSchema.optional(),\n}).catchall(AgentOverrideConfigSchema.optional())'
        )
        writeFileSync(filePath, content)
      }
      await $`git add ${filePath}`
      log("Resolved agent-overrides.ts: kept devin agent + upstream catchall")
    },
  },

  // Plugin config tests: take upstream (has our test additions now)
  {
    pattern: "src/plugin-config.test.ts",
    strategy: "theirs",
  },

  // Model requirements: take upstream (now re-exports from model-core)
  {
    pattern: "src/shared/model-requirements.ts",
    strategy: "theirs",
  },

  // Model resolution pipeline: take upstream
  {
    pattern: "src/shared/model-resolution-pipeline.ts",
    strategy: "theirs",
  },

  // Agent source files: take upstream (agent logic is upstream-owned)
  {
    pattern: /^src\/agents\/builtin-agents\/.*\.ts$/,
    strategy: "theirs",
  },
  {
    pattern: /^src\/agents\/types\.ts$/,
    strategy: "theirs",
  },

  // CLI/handlers: take upstream
  {
    pattern: /^src\/cli\/cli-program\.ts$/,
    strategy: "theirs",
  },
  {
    pattern: /^src\/plugin-handlers\/.*\.ts$/,
    strategy: "theirs",
  },

  // NOTE: bun.lock is handled separately after post-merge fixes
  // (bun install triggers prepare -> build, so it must run after all fixes)
]

async function resolveFile(filePath: string): Promise<void> {
  for (const rule of CONFLICT_RULES) {
    if (matchesPattern(filePath, rule.pattern)) {
      if (rule.strategy === "ours") {
        if (!DRY_RUN) {
          await $`git checkout --ours ${filePath}`
          await $`git add ${filePath}`
        }
        log(`Resolved ${filePath}: kept ours`)
      } else if (rule.strategy === "theirs") {
        if (!DRY_RUN) {
          await $`git checkout --theirs ${filePath}`
          await $`git add ${filePath}`
        }
        log(`Resolved ${filePath}: took upstream`)
      } else if (rule.strategy === "custom" && rule.customResolver) {
        if (!DRY_RUN) {
          await rule.customResolver(filePath)
        } else {
          log(`[DRY-RUN] Would custom-resolve ${filePath}`)
        }
      }
      return
    }
  }

  fatal(
    `Unknown conflict in ${filePath}. No resolution strategy registered.\n` +
      `Please add a rule to CONFLICT_RULES in script/update.ts, or resolve manually.\n` +
      `To restore from backup: git reset --hard HEAD && git checkout ${TARGET_BRANCH}`
  )
}

async function resolveAllConflicts(files: string[]): Promise<void> {
  // Sort to ensure package.json is resolved first
  const sorted = files.sort((a, b) => {
    if (a === "package.json") return -1
    if (b === "package.json") return 1
    return a.localeCompare(b)
  })
  for (const file of sorted) {
    // Skip bun.lock — remove it from index, regenerate after post-merge fixes
    if (file === "bun.lock") {
      if (!DRY_RUN) {
        await $`git rm -f ${file}`
      }
      log("Marked bun.lock as resolved (will regenerate after post-merge fixes)")
      continue
    }
    await resolveFile(file)
  }
}

async function regenerateLockfile(): Promise<void> {
  log("Regenerating lockfile...")
  if (DRY_RUN) {
    log("[DRY-RUN] Would run: rm -f bun.lock && bun install")
    return
  }
  await $`rm -f bun.lock package-lock.json`
  await $`bun install`
  log("Lockfile regenerated")
}

// Post-merge semantic fixes for files that auto-merged textually
// but have semantic incompatibilities
async function applyPostMergeFixes(): Promise<void> {
  // Add known post-merge fixes here as they are discovered.
  // Example: if upstream auto-merges a file but breaks types,
  // add a targeted fix here.
  log("Checking for post-merge semantic fixes...")
  // No fixes currently needed
}

async function verifyBuild(): Promise<void> {
  log("Running build...")
  if (!DRY_RUN) {
    await $`bun run build`
  }
  log("Build passed")
}

async function verifyTests(): Promise<void> {
  log("Running dependency-security test...")
  if (!DRY_RUN) {
    await $`bun test src/dependency-security.test.ts`
  }
  log("Tests passed")
}

async function commitMerge(): Promise<void> {
  if (DRY_RUN) {
    log("Would commit merge")
    return
  }
  await $`git commit -m "Merge upstream/dev into ${TARGET_BRANCH}"`
  const sha = (await $`git rev-parse --short HEAD`.text()).trim()
  log(`Merge committed: ${sha}`)
}

async function main(): Promise<void> {
  log(`Starting upstream sync: ${UPSTREAM_BRANCH} -> ${TARGET_BRANCH}`)
  if (DRY_RUN) log("DRY RUN — no changes will be made")

  await checkPreconditions()
  const backup = await createBackup()

  try {
    await fetchUpstream()
    const clean = await attemptMerge()

    if (!clean) {
      const conflicts = await getConflictedFiles()
      log(`Found ${conflicts.length} conflicted file(s):`, conflicts)
      await resolveAllConflicts(conflicts)

      // Check for remaining conflicts
      const remaining = await getConflictedFiles()
      if (remaining.length > 0) {
        fatal(`Unresolved conflicts remain: ${remaining.join(", ")}`)
      }
    }

    // Apply semantic fixes for auto-merged files with incompatibilities
    // BEFORE regenerating lockfile (bun install triggers prepare -> build)
    await applyPostMergeFixes()

    // Regenerate lockfile AFTER all fixes (bun install triggers prepare -> build)
    await regenerateLockfile()

    await verifyBuild()
    await verifyTests()
    await commitMerge()

    log("Upstream sync complete!")
    log(`Backup branch: ${backup}`)
  } catch (err) {
    console.error("\n[ERROR] Update failed:", err)
    log(
      `To restore: git reset --hard HEAD && git checkout ${TARGET_BRANCH} && git reset --hard ${backup}`
    )
    process.exit(1)
  }
}

main()
