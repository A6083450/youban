export function resolveAvailableResultSection<T extends string>(
  current: T,
  requested: T,
  available: readonly T[],
): T {
  if (available.includes(requested))
    return requested
  if (available.includes(current))
    return current
  return available[0] || current
}

export function resultSectionAnchor(section: string): string {
  return `result-section-${section}`
}
