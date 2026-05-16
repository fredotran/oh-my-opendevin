import { describe, expect, it } from "bun:test"
import { resolveTierLabel, resolveTierInfo, MODEL_TIER_MAP, KNOWN_DEVIN_MODELS, FALLBACK_CHAIN, getFallbackModel, TIER_COST_MAP, DEFAULT_DEVIN_MODEL } from "./tiers"

describe("tiers", () => {
  describe("#given resolveTierLabel", () => {
    it("returns Standard when model is undefined", () => {
      expect(resolveTierLabel(undefined)).toBe("Standard")
    })

    it("returns Standard for kimi-k2.6", () => {
      expect(resolveTierLabel("kimi-k2.6")).toBe("Standard")
    })

    it("returns Fast/Cheap for both 'swe' keyword and 'swe-1.6' fully-qualified", () => {
      expect(resolveTierLabel("swe")).toBe("Fast/Cheap")
      expect(resolveTierLabel("swe-1.6")).toBe("Fast/Cheap")
    })

    it("returns Code Gen for codex", () => {
      expect(resolveTierLabel("codex")).toBe("Code Gen")
    })

    it("returns Balanced for sonnet", () => {
      expect(resolveTierLabel("sonnet")).toBe("Balanced")
    })

    it("returns Deep for opus", () => {
      expect(resolveTierLabel("opus")).toBe("Deep")
    })

    it("returns Custom for unrecognized models", () => {
      expect(resolveTierLabel("gpt-99")).toBe("Custom")
      expect(resolveTierLabel("unknown")).toBe("Custom")
    })
  })

  describe("#given resolveTierInfo", () => {
    it("returns full info for known models", () => {
      expect(resolveTierInfo("opus")).toEqual({ tier: "Deep", keyword: '"opus"' })
      expect(resolveTierInfo("swe")).toEqual({ tier: "Fast/Cheap", keyword: '"swe"' })
    })

    it("returns Custom info for unrecognized models with the model as keyword", () => {
      expect(resolveTierInfo("gpt-99")).toEqual({ tier: "Custom", keyword: "gpt-99" })
    })

    it("returns Standard for undefined", () => {
      expect(resolveTierInfo(undefined)).toEqual({ tier: "Standard", keyword: "omit model" })
    })
  })

  describe("#given KNOWN_DEVIN_MODELS", () => {
    it("includes both 'swe' keyword and 'swe-1.6' fully-qualified", () => {
      expect(KNOWN_DEVIN_MODELS).toContain("swe")
      expect(KNOWN_DEVIN_MODELS).toContain("swe-1.6")
    })

    it("includes all five tier models", () => {
      expect(KNOWN_DEVIN_MODELS).toContain("kimi-k2.6")
      expect(KNOWN_DEVIN_MODELS).toContain("codex")
      expect(KNOWN_DEVIN_MODELS).toContain("sonnet")
      expect(KNOWN_DEVIN_MODELS).toContain("opus")
    })
  })

  describe("#given MODEL_TIER_MAP", () => {
    it("has all known models mapped", () => {
      for (const model of KNOWN_DEVIN_MODELS) {
        expect(MODEL_TIER_MAP[model]).toBeDefined()
      }
    })
  })

  describe("#given FALLBACK_CHAIN", () => {
    it("orders models from most to least capable", () => {
      expect(FALLBACK_CHAIN).toEqual(["opus", "sonnet", "kimi-k2.6", "swe-1.6"])
    })
  })

  describe("#given getFallbackModel", () => {
    it("returns sonnet from opus", () => {
      expect(getFallbackModel("opus")).toBe("sonnet")
    })

    it("returns kimi-k2.6 from sonnet", () => {
      expect(getFallbackModel("sonnet")).toBe("kimi-k2.6")
    })

    it("returns swe-1.6 from kimi-k2.6", () => {
      expect(getFallbackModel("kimi-k2.6")).toBe("swe-1.6")
    })

    it("returns default model at end of chain", () => {
      expect(getFallbackModel("swe-1.6")).toBe("kimi-k2.6")
    })

    it("returns first model for unknown input", () => {
      expect(getFallbackModel("unknown-model")).toBe("opus")
    })

    it("returns first model for undefined", () => {
      expect(getFallbackModel(undefined)).toBe("opus")
    })
  })

  describe("#given DEFAULT_DEVIN_MODEL", () => {
    it("is kimi-k2.6", () => {
      expect(DEFAULT_DEVIN_MODEL).toBe("kimi-k2.6")
    })
  })

  describe("#given TIER_COST_MAP", () => {
    it("has a positive cost for every defined tier", () => {
      expect(TIER_COST_MAP.Standard).toBeGreaterThan(0)
      expect(TIER_COST_MAP["Fast/Cheap"]).toBeGreaterThan(0)
      expect(TIER_COST_MAP["Code Gen"]).toBeGreaterThan(0)
      expect(TIER_COST_MAP.Balanced).toBeGreaterThan(0)
      expect(TIER_COST_MAP.Deep).toBeGreaterThan(0)
      expect(TIER_COST_MAP.Custom).toBeGreaterThan(0)
    })

    it("orders Deep as the most expensive tier", () => {
      const costs = Object.values(TIER_COST_MAP)
      expect(Math.max(...costs)).toBe(TIER_COST_MAP.Deep)
    })
  })
})
