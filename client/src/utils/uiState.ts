export type PayloadFormat = "pretty" | "raw";

export function nextPayloadFormat(format: PayloadFormat): PayloadFormat {
  return format === "pretty" ? "raw" : "pretty";
}
