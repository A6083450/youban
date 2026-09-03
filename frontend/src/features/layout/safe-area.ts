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

export interface MobileMenuButtonRect {
  left?: number
  top?: number
  height?: number
  bottom?: number
}

export function mobileHeaderMetrics(
  windowWidth: number | undefined,
  safeAreaTop: number | undefined,
  menuButton?: MobileMenuButtonRect,
) {
  const safeTop = Math.max(0, Number(safeAreaTop) || 0)
  const rawTop = Number(menuButton?.top)
  const top = Number.isFinite(rawTop) && rawTop >= 0 ? rawTop : safeTop + 6
  const rawHeight = Number(menuButton?.height)
  const height = Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : 32
  const rawBottom = Number(menuButton?.bottom)
  const bottom = Number.isFinite(rawBottom) && rawBottom > top ? rawBottom : top + height

  return {
    safeTop: `${Math.round(safeTop)}px`,
    actionsRight: mobileActionsRightCss(windowWidth, menuButton?.left),
    menuTop: `${Math.round(top)}px`,
    menuHeight: `${Math.round(height)}px`,
    menuCenter: `${Math.round(top + height / 2)}px`,
    headerHeight: `${Math.round(Math.max(safeTop + 52, bottom + 8))}px`,
  }
}
