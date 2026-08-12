export function parseInboxIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return [
      ...new Set(
        value.filter(
          (id): id is string => typeof id === "string" && id.trim().length > 0,
        ),
      ),
    ];
  } catch {
    return [];
  }
}

export function addInboxId(ids: string[], id: string): string[] {
  return [id, ...ids.filter((existingId) => existingId !== id)];
}
