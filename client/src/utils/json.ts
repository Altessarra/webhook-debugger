export function parseJsonValue(value: string | null | undefined): unknown {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
