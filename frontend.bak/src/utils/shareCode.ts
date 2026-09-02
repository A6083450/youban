export function normalizeShareCode(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, '').toLowerCase()
}

export function isValidShareCode(value: unknown): boolean {
  return /^[0-9a-f]{32}$/.test(normalizeShareCode(value))
}
