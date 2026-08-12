export type SchemaNode = {
  type:
    "array" | "boolean" | "null" | "number" | "object" | "string" | "unknown";
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
};

export function inferSchema(value: unknown): SchemaNode {
  if (value === null) return { type: "null" };
  if (Array.isArray(value))
    return {
      type: "array",
      items: value.length > 0 ? inferSchema(value[0]) : { type: "unknown" },
    };
  if (typeof value === "object") {
    return {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, inferSchema(child)]),
      ),
    };
  }
  if (typeof value === "string") return { type: "string" };
  if (typeof value === "number") return { type: "number" };
  if (typeof value === "boolean") return { type: "boolean" };
  return { type: "unknown" };
}
