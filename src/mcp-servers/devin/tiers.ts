/**
 * Devin CLI model tier mapping — single source of truth.
 *
 * Agents use keywords (e.g. "swe", "opus") which are passed directly to the
 * devin CLI as --model. The CLI itself accepts these keywords and the
 * fully-qualified model IDs (e.g. "swe-1-6"). Both representations should
 * resolve to the same tier label in user-facing output (devin_start response,
 * devin-report CLI, etc.).
 */

export type DevinTier = "Standard" | "Fast/Cheap" | "Code Gen" | "Balanced" | "Deep" | "Custom"

export type TierEntry = {
  tier: DevinTier
  /** How the agent invokes this tier in devin_start (the keyword) */
  keyword: string
}

/** Map of model identifier (keyword OR fully-qualified) to tier info. */
export const MODEL_TIER_MAP: Record<string, TierEntry> = {
  // Standard tier
  "kimi-k2.6": { tier: "Standard", keyword: "omit model" },
  // Fast/Cheap tier — both the keyword and the fully-qualified model ID
  "swe": { tier: "Fast/Cheap", keyword: '"swe"' },
  "swe-1-6": { tier: "Fast/Cheap", keyword: '"swe"' },
  // Code Gen tier
  "codex": { tier: "Code Gen", keyword: '"codex"' },
  // Balanced tier
  "sonnet": { tier: "Balanced", keyword: '"sonnet"' },
  // Deep tier
  "opus": { tier: "Deep", keyword: '"opus"' },
}

/**
 * Models recognized for pre-flight validation. Includes both keywords and
 * fully-qualified IDs so agents can use either form.
 */
export const KNOWN_DEVIN_MODELS = Object.keys(MODEL_TIER_MAP)

/** Resolve a model string to its tier label. Returns "Custom" if unrecognized. */
export function resolveTierLabel(model: string | undefined): DevinTier {
  if (!model) return "Standard"
  return MODEL_TIER_MAP[model]?.tier ?? "Custom"
}

/** Resolve a model string to full tier info. Returns Unknown for unrecognized. */
export function resolveTierInfo(model: string | undefined): TierEntry {
  if (!model) return { tier: "Standard", keyword: "omit model" }
  return MODEL_TIER_MAP[model] ?? { tier: "Custom", keyword: model }
}
