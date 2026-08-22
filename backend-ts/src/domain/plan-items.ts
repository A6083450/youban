function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function newItemId(existing: Set<string>): string {
  let value = "";
  do {
    value = `itm_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
  } while (existing.has(value));
  existing.add(value);
  return value;
}

export function ensurePlanItemIds(result: unknown): boolean {
  if (!record(result) || !record(result.data) || !Array.isArray(result.data.days)) return false;
  const items: Array<Record<string, unknown>> = [];
  for (const day of result.data.days) {
    if (!record(day)) continue;
    for (const group of ["attractions", "meals"] as const) {
      if (!Array.isArray(day[group])) continue;
      for (const item of day[group]) if (record(item)) items.push(item);
    }
  }
  const existing = new Set(items.map((item) => String(item.id ?? "").trim()).filter(Boolean));
  let changed = false;
  for (const item of items) {
    if (String(item.id ?? "").trim()) continue;
    item.id = newItemId(existing);
    changed = true;
  }
  return changed;
}
