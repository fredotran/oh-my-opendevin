import { describe, expect, it } from "bun:test"
import { resolveTierLabel, resolveTierInfo, MODEL_TIER_MAP, KNOWN_DEVIN_MODELS } from "./tiers"

describe("tiers", () => {
  describe("#given resolveTierLabel", () => {
    it("returns Standard when model is undefined", () => {
      expect(resolveTierLabel(undefined)).toBe("Standard")
    })

    it("returns Standard for kimi-k2.6", () => {
      expect(resolveTierLabel("kimi-k2.6")).toBe("Standard")
    })

    it("returns Fast/Cheap for both 'swe' keyword and 'swe-1-6' fully-qualified", () => {
      expect(resolveTierLabel("swe")).toBe("Fast/Cheap")
      expect(resolveTierLabel("swe-1-6")).toBe("Fast/Cheap")
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
    it("includes both 'swe' keyword and 'swe-1-6' fully-qualified", () => {
      expect(KNOWN_DEVIN_MODELS).toContain("swe")
      expect(KNOWN_DEVIN_MODELS).toContain("swe-1-6")
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
})
