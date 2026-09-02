export function safeAreaTopCss(value: number | undefined): string {
  return `${Math.max(0, Number(value) || 0)}px`
}

export function mobileActionsRightCss(
  windowWidth: number | undefined,
  menuButtonLeft: number | undefined,
  gap = 8,
): string {
  const width = Number(windowWidth)
  const left = Number(menuButtonLeft)
  if (!Number.isFinite(width) || !Number.isFinite(left) || left <= 0 || left >= width)
    return '12px'
  return `${Math.max(12, Math.round(width - left + gap))}px`
}
