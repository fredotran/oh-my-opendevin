import { extractSemverFromOutput } from "../../../shared/extract-semver"
import { spawnWithTimeout } from "../spawn-with-timeout"

export interface DevinBinaryInfo {
  found: boolean
  path: string | null
  version: string | null
}

export async function findDevinBinary(): Promise<DevinBinaryInfo> {
  const path = Bun.which("devin")
  if (!path) {
    return { found: false, path: null, version: null }
  }
  try {
    const result = await spawnWithTimeout(["devin", "--version"], { stdout: "pipe", stderr: "pipe" })
    if (result.timedOut || result.exitCode !== 0) {
      return { found: true, path, version: null }
    }
    const version = extractSemverFromOutput(result.stdout)
    return { found: true, path, version }
  } catch {
    return { found: true, path, version: null }
  }
}
