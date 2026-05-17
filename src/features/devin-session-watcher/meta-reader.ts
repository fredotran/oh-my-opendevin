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
