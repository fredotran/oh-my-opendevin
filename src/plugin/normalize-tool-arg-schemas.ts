import type { ToolDefinition } from "@opencode-ai/plugin"

export function normalizeToolArgSchemas<TDefinition extends Pick<ToolDefinition, "args">>(
  toolDefinition: TDefinition,
): TDefinition {
  // No-op: zod 4.4.3+ preserves descriptions and metadata natively in
  // toJSONSchema. The previous monkey-patch corrupted schema internal state
  // when nested toJSONSchema calls occurred. $schema at the root is harmless.
  return toolDefinition
}

const UNSUPPORTED_SCHEMA_KEYWORDS = new Set(["contentEncoding", "contentMediaType"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeJsonSchemaRef(value: string): string {
  if (value.startsWith("#") || value.includes(":") || value.startsWith("/")) {
    return value
  }

  return `#/$defs/${value}`
}

export function sanitizeJsonSchema(value: unknown, depth = 0, isPropertyName = false): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonSchema(item, depth + 1, false))
  }

  if (!isRecord(value)) {
    return value
  }

  const sanitized: Record<string, unknown> = {}

  for (const [key, nestedValue] of Object.entries(value)) {
    if (!isPropertyName && UNSUPPORTED_SCHEMA_KEYWORDS.has(key)) {
      continue
    }

    if (depth === 0 && key === "$schema") {
      continue
    }

    if (!isPropertyName && key === "$ref" && typeof nestedValue === "string") {
      sanitized[key] = normalizeJsonSchemaRef(nestedValue)
      continue
    }

    const childIsPropertyName = key === "properties" && !isPropertyName
    sanitized[key] = sanitizeJsonSchema(nestedValue, depth + 1, childIsPropertyName)
  }

  return sanitized
}
