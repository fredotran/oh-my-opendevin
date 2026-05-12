#!/usr/bin/env bun

import { $ } from "bun"

const DEVIN_FEATURES_PATH = "DEVIN-FEATURES.md"
const SINCE_COMMIT = "7d09d2c8"

async function getCommitLog(): Promise<string[]> {
  const log = await $`git log ${SINCE_COMMIT}..HEAD --oneline --format="%h %s" --reverse`.text()
  return log
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse()
}

async function getHeadShort(): Promise<string> {
  const log = await $`git log --format=%h%x00%B%x00`.text()
  const entries = log.split("\0").filter(Boolean)
  for (let i = 0; i < entries.length; i += 2) {
    const sha = entries[i].trim()
    const msg = entries[i + 1] ?? ""
    if (!/\[\s*skip ci\s*\]/.test(msg)) {
      return sha
    }
  }
  const fallback = await $`git rev-parse --short HEAD`.text()
  return fallback.trim()
}

async function main() {
  const headShort = await getHeadShort()
  const commitLog = await getCommitLog()

  const content = await Bun.file(DEVIN_FEATURES_PATH).text()

  // Guard against merge-conflict debris
  if (/<<<<<<<|=======|>>>>>>>/.test(content)) {
    console.error(`ERROR: ${DEVIN_FEATURES_PATH} contains merge conflict markers. Resolve them before running this script.`)
    process.exit(1)
  }

  // Update Last updated line
  const updatedContent = content.replace(
    /(\*\*Last updated:\*\* `)[a-f0-9]+(`)/,
    `$1${headShort}$2`
  )

  // Update Full Commit Log block
  const logBlock = ["```", ...commitLog, "```"].join("\n")
  const commitLogRegex = /(## Full Commit Log\n\n)```[\s\S]*?```/

  if (!commitLogRegex.test(updatedContent)) {
    console.error("Could not find Full Commit Log block in DEVIN-FEATURES.md")
    process.exit(1)
  }

  const finalContent = updatedContent.replace(commitLogRegex, `$1${logBlock}`)

  if (finalContent === content) {
    console.log("DEVIN-FEATURES.md is already up to date")
    process.exit(0)
  }

  await Bun.write(DEVIN_FEATURES_PATH, finalContent)
  console.log(`Updated ${DEVIN_FEATURES_PATH} — Last updated: ${headShort}, ${commitLog.length} commits`)
}

main()
