/** Helpers for small structured model calls (checks and questions), not research. */
export type JsonSchema = Record<string, unknown>;

/** OpenAI strict mode needs every object closed and every property required. */
export function strictSchema(schema: JsonSchema): JsonSchema {
  if (schema.type === "object" && schema.properties) {
    const properties = Object.fromEntries(
      Object.entries(schema.properties as Record<string, JsonSchema>).map(
        ([k, v]) => [k, strictSchema(v)],
      ),
    );
    return {
      ...schema,
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    };
  }
  if (schema.type === "array" && schema.items)
    return { ...schema, items: strictSchema(schema.items as JsonSchema) };
  return schema;
}

/** Parse JSON that may arrive wrapped in a Markdown code fence. */
export function parseJsonText(raw: string): unknown {
  return JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
}
