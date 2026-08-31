export function resolveH5Element(value: unknown): HTMLElement | null {
  if (value instanceof HTMLElement)
    return value
  if (value && typeof value === 'object' && '$el' in value && value.$el instanceof HTMLElement)
    return value.$el
  return null
}
