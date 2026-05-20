/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"
import { cpSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import { tool } from "@opencode-ai/plugin"
import { normalizeToolArgSchemas, sanitizeJsonSchema } from "./normalize-tool-arg-schemas"

const tempDirectories: string[] = []

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getNestedRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key]
  return isRecord(value) ? value : undefined
}

async function loadSeparateHostZodModule(): Promise<typeof import("zod")> {
  const pluginPackageDirectory = dirname(Bun.resolveSync("@opencode-ai/plugin/package.json", import.meta.dir))
  const sourceZodDirectory = dirname(Bun.resolveSync("zod/package.json", pluginPackageDirectory))
  const tempDirectory = mkdtempSync(join(tmpdir(), "omo-host-zod-"))
  const copiedZodDirectory = join(tempDirectory, "zod")

  cpSync(sourceZodDirectory, copiedZodDirectory, { recursive: true })
  tempDirectories.push(tempDirectory)

  return await import(pathToFileURL(join(copiedZodDirectory, "index.js")).href)
}

function serializeWithHostZod(
  hostZod: typeof import("zod"),
  args: Record<string, object>,
): Record<string, unknown> {
  return hostZod.z.toJSONSchema(Reflect.apply(hostZod.z.object, hostZod.z, [args]))
}

describe("normalizeToolArgSchemas", () => {
  afterEach(() => {
    for (const tempDirectory of tempDirectories.splice(0)) {
      rmSync(tempDirectory, { recursive: true, force: true })
    }
  })

  it("preserves nested descriptions and metadata natively in zod 4.4.3+", async () => {
    // given
    const myTool = tool({
      description: "Search tool",
      args: {
        filters: tool.schema
          .object({
            query: tool.schema
              .string()
              .describe("Free-text search query")
              .meta({ title: "Query", examples: ["issue 2314"] }),
          })
          .describe("Filter options")
          .meta({ title: "Filters" }),
      },
      async execute(): Promise<string> {
        return "ok"
      },
    })

    // when: zod 4.4.3+ preserves descriptions and metadata natively;
    // normalizeToolArgSchemas is now a no-op because the monkey-patch
    // corrupted schema internal state during nested toJSONSchema calls.
    normalizeToolArgSchemas(myTool)
    const schema = tool.schema.toJSONSchema(tool.schema.object(myTool.args))
    const properties = getNestedRecord(schema, "properties")
    const filters = properties ? getNestedRecord(properties, "filters") : undefined
    const filterProperties = filters ? getNestedRecord(filters, "properties") : undefined
    const query = filterProperties ? getNestedRecord(filterProperties, "query") : undefined

    // then
    expect(filters?.description).toBe("Filter options")
    expect(filters?.title).toBe("Filters")
    expect(query?.description).toBe("Free-text search query")
    expect(query?.title).toBe("Query")
    expect(query?.examples).toEqual(["issue 2314"])
  })
})

describe("sanitizeJsonSchema", () => {
  it("rewrites bare $ref values to $defs JSON pointers", () => {
    // given
    const schema = {
      type: "object",
      properties: {
        new_encoding: { $ref: "Encoding" },
        existing_pointer: { $ref: "#/$defs/AlreadyValid" },
      },
      $defs: {
        Encoding: { type: "string" },
        AlreadyValid: { type: "string" },
      },
    }

    // when
    const sanitized = sanitizeJsonSchema(schema)

    // then
    expect(sanitized).toEqual({
      type: "object",
      properties: {
        new_encoding: { $ref: "#/$defs/Encoding" },
        existing_pointer: { $ref: "#/$defs/AlreadyValid" },
      },
      $defs: {
        Encoding: { type: "string" },
        AlreadyValid: { type: "string" },
      },
    })
  })
})
