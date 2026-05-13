import { describe, expect, it } from "bun:test"
import { devinWaitInputSchema, safeToolHandler } from "./server"
import { z } from "zod"

// Build a Zod object schema from the shape exported by the server
const waitSchema = z.object(devinWaitInputSchema)

describe("devin_wait input schema", () => {
  it("accepts timeout_ms at exactly 30000", () => {
    const result = waitSchema.safeParse({
      session_id: "test-1",
      timeout_ms: 30000,
    })
    expect(result.success).toBe(true)
  })

  it("accepts timeout_ms at the minimum 1000", () => {
    const result = waitSchema.safeParse({
      session_id: "test-1",
      timeout_ms: 1000,
    })
    expect(result.success).toBe(true)
  })

  it("rejects timeout_ms above 30000", () => {
    const result = waitSchema.safeParse({
      session_id: "test-1",
      timeout_ms: 60000,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const issues = result.error.issues.map((i) => i.message).join(", ")
      expect(issues).toContain("30000")
    }
  })

  it("rejects timeout_ms below 1000", () => {
    const result = waitSchema.safeParse({
      session_id: "test-1",
      timeout_ms: 500,
    })
    expect(result.success).toBe(false)
  })

  it("accepts undefined timeout_ms", () => {
    const result = waitSchema.safeParse({
      session_id: "test-1",
    })
    expect(result.success).toBe(true)
  })
})

describe("safeToolHandler", () => {
  it("returns successful handler result directly", async () => {
    const handler = safeToolHandler("devin_test", async () => "ok" as unknown as ReturnType<typeof import("./server").safeToolHandler>)
    const result = await handler({})
    expect(result).toBe("ok")
  })

  it("catches errors and returns a text result with the error message", async () => {
    const handler = safeToolHandler("devin_test", async () => {
      throw new Error("something broke")
    })
    const result = await handler({})
    expect(result).toEqual({
      content: [{ type: "text", text: expect.stringContaining("something broke") }],
    })
    expect(result.content[0].text).toContain("[devin_test]")
  })

  it("catches non-Error throws and stringifies them", async () => {
    const handler = safeToolHandler("devin_test", async () => {
      throw "weird throw"
    })
    const result = await handler({})
    expect(result.content[0].text).toContain("weird throw")
  })
})
