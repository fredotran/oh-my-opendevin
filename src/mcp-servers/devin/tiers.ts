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

/** Fallback chain when a model hits quota or is unavailable.
 *  Ordered from most to least capable: Deep → Balanced → Standard → Fast/Cheap.
 */
export const FALLBACK_CHAIN = ["opus", "sonnet", "kimi-k2.6", "swe-1-6"]

/** Rough per-second cost estimates (USD) for Devin CLI models.
 *  Used by devin-report for directional spend estimation only.
 *  These are placeholders — adjust to match actual Devin pricing. */
export const TIER_COST_MAP: Record<DevinTier, number> = {
  Standard: 0.003,
  "Fast/Cheap": 0.001,
  "Code Gen": 0.002,
  Balanced: 0.005,
  Deep: 0.015,
  Custom: 0.003,
}

/** Default model used when no model is explicitly specified. */
export const DEFAULT_DEVIN_MODEL = "kimi-k2.6"

/** Returns the next model in the fallback chain.
 *  When the chain is exhausted, falls back to the default model instead of
 *  giving up, so quota errors always have a safety-net retry.
 */
export function getFallbackModel(current: string | undefined): string | undefined {
  const idx = FALLBACK_CHAIN.indexOf(current ?? "")
  if (idx === -1) return FALLBACK_CHAIN[0]
  const next = FALLBACK_CHAIN[idx + 1]
  if (next) return next
  // End of chain — loop back to the default model as a last resort
  return DEFAULT_DEVIN_MODEL
}
