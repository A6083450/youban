export interface HorizontalPageItem {
  offsetLeft: number
  offsetWidth: number
}

const POSITION_TOLERANCE = 2

export function buildHorizontalPageTargets(
  items: readonly HorizontalPageItem[],
  viewportWidth: number,
  maxScroll: number,
): number[] {
  const boundedMax = Math.max(0, Math.round(maxScroll))
  if (boundedMax <= POSITION_TOLERANCE || viewportWidth <= 0)
    return [0]

  const orderedItems = [...items]
    .filter(item => item.offsetWidth > 0 && item.offsetLeft >= 0)
    .sort((left, right) => left.offsetLeft - right.offsetLeft)
  const targets = [0]
  let current = 0

  while (current < boundedMax - POSITION_TOLERANCE) {
    const viewportEnd = current + viewportWidth
    const firstClippedItem = orderedItems.find(item => (
      item.offsetLeft > current + POSITION_TOLERANCE
      && item.offsetLeft + item.offsetWidth > viewportEnd + POSITION_TOLERANCE
    ))
    if (!firstClippedItem)
      break
    const next = Math.min(boundedMax, Math.round(firstClippedItem.offsetLeft))
    if (next <= current + POSITION_TOLERANCE)
      break
    targets.push(next)
    current = next
  }

  return targets
}

export function buildFixedItemPageTargets(
  itemCount: number,
  viewportWidth: number,
  itemWidth: number,
  gap: number,
): number[] {
  const count = Math.max(0, Math.floor(itemCount))
  const width = Math.max(0, itemWidth)
  const stride = width + Math.max(0, gap)
  if (!count || !width || !stride)
    return [0]
  const items = Array.from({ length: count }, (_, index) => ({
    offsetLeft: index * stride,
    offsetWidth: width,
  }))
  return buildHorizontalPageTargets(items, viewportWidth, (count - 1) * stride)
}

export function findHorizontalPageIndex(targets: readonly number[], scrollLeft: number): number {
  let nearestIndex = 0
  let nearestDistance = Number.POSITIVE_INFINITY
  targets.forEach((target, index) => {
    const distance = Math.abs(target - scrollLeft)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestIndex = index
    }
  })
  return nearestIndex
}
