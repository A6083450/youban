import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

const DRAG_THRESHOLD = 6
const POSITION_TOLERANCE = 2

export interface HorizontalPageItem {
  offsetLeft: number
  offsetWidth: number
}

export const buildHorizontalPageTargets = (
  items: readonly HorizontalPageItem[],
  viewportWidth: number,
  maxScroll: number,
): number[] => {
  const boundedMax = Math.max(0, Math.round(maxScroll))
  if (boundedMax <= POSITION_TOLERANCE || viewportWidth <= 0) return [0]

  const orderedItems = [...items]
    .filter((item) => item.offsetWidth > 0 && item.offsetLeft >= 0)
    .sort((left, right) => left.offsetLeft - right.offsetLeft)
  const targets = [0]
  let current = 0

  while (current < boundedMax - POSITION_TOLERANCE) {
    const viewportEnd = current + viewportWidth
    const firstClippedItem = orderedItems.find((item) => (
      item.offsetLeft > current + POSITION_TOLERANCE
      && item.offsetLeft + item.offsetWidth > viewportEnd + POSITION_TOLERANCE
    ))
    if (!firstClippedItem) break
    const next = Math.min(boundedMax, Math.round(firstClippedItem.offsetLeft))
    if (next <= current + POSITION_TOLERANCE) break
    targets.push(next)
    current = next
  }

  return targets
}

export const findHorizontalPageIndex = (targets: readonly number[], scrollLeft: number): number => {
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

export const shouldSnapHorizontalPointerEnd = (
  dragging: boolean,
  _pointerType: string,
  eventType: string,
): boolean => dragging && eventType !== 'pointercancel'

export const useHorizontalPager = (
  viewportRef: Ref<HTMLElement | null>,
  stripRef: Ref<HTMLElement | null>,
  source: Ref<unknown>,
) => {
  const overflowing = ref(false)
  const dragging = ref(false)
  const currentPage = ref(0)
  const pageCount = ref(1)
  const canPrevious = computed(() => overflowing.value && currentPage.value > 0)
  const canNext = computed(() => overflowing.value && currentPage.value < pageCount.value - 1)

  let targets = [0]
  let resizeObserver: ResizeObserver | null = null
  let observedViewport: HTMLElement | null = null
  let observedGroup: HTMLElement | null = null
  let activePointerId: number | null = null
  let dragStartX = 0
  let dragStartScrollLeft = 0
  let suppressClick = false
  let clickResetTimer: number | null = null
  let scrollFrame: number | null = null
  let reducedMotion = false
  let motionQuery: MediaQueryList | null = null

  const syncPageFromScroll = () => {
    const viewport = viewportRef.value
    if (!viewport) return
    currentPage.value = findHorizontalPageIndex(targets, viewport.scrollLeft)
  }

  const update = () => {
    const viewport = viewportRef.value
    const group = stripRef.value?.firstElementChild
    if (!viewport || !(group instanceof HTMLElement)) {
      targets = [0]
      overflowing.value = false
      currentPage.value = 0
      pageCount.value = 1
      return
    }

    const maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
    const items = [...group.children]
      .filter((child): child is HTMLElement => (
        child instanceof HTMLElement && child.hasAttribute('data-pager-item')
      ))
      .map((child) => ({ offsetLeft: child.offsetLeft, offsetWidth: child.offsetWidth }))
    targets = buildHorizontalPageTargets(items, viewport.clientWidth, maxScroll)
    overflowing.value = targets.length > 1
    pageCount.value = targets.length
    syncPageFromScroll()
  }

  const observe = (viewport: HTMLElement, group: HTMLElement) => {
    resizeObserver ??= new ResizeObserver(update)
    if (observedViewport !== viewport) {
      if (observedViewport) resizeObserver.unobserve(observedViewport)
      resizeObserver.observe(viewport)
      observedViewport = viewport
    }
    if (observedGroup !== group) {
      if (observedGroup) resizeObserver.unobserve(observedGroup)
      resizeObserver.observe(group)
      observedGroup = group
    }
  }

  const refresh = () => void nextTick(() => {
    const viewport = viewportRef.value
    const group = stripRef.value?.firstElementChild
    if (viewport && group instanceof HTMLElement) observe(viewport, group)
    update()
  })

  const scrollToPage = (page: number) => {
    const viewport = viewportRef.value
    if (!viewport || targets.length <= 1) return
    const boundedPage = Math.max(0, Math.min(targets.length - 1, page))
    currentPage.value = boundedPage
    viewport.scrollTo({
      left: targets[boundedPage],
      behavior: reducedMotion ? 'auto' : 'smooth',
    })
  }

  const previous = () => scrollToPage(currentPage.value - 1)
  const next = () => scrollToPage(currentPage.value + 1)

  const onScroll = () => {
    if (scrollFrame !== null) return
    scrollFrame = window.requestAnimationFrame(() => {
      scrollFrame = null
      syncPageFromScroll()
    })
  }

  const onPointerDown = (event: PointerEvent) => {
    const viewport = viewportRef.value
    if (!viewport || (event.pointerType === 'mouse' && event.button !== 0)) return
    activePointerId = event.pointerId
    dragStartX = event.clientX
    dragStartScrollLeft = viewport.scrollLeft
    suppressClick = false
  }

  const onPointerMove = (event: PointerEvent) => {
    const viewport = viewportRef.value
    if (!viewport || event.pointerId !== activePointerId) return
    const delta = event.clientX - dragStartX
    if (!dragging.value && Math.abs(delta) < DRAG_THRESHOLD) return

    event.preventDefault()
    if (!dragging.value) {
      viewport.setPointerCapture(event.pointerId)
      const activeElement = document.activeElement
      if (activeElement instanceof HTMLElement && viewport.contains(activeElement)) activeElement.blur()
    }
    dragging.value = true
    suppressClick = true
    viewport.scrollLeft = dragStartScrollLeft - delta
  }

  const onPointerEnd = (event: PointerEvent) => {
    const viewport = viewportRef.value
    if (!viewport || event.pointerId !== activePointerId) return
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId)
    activePointerId = null
    const shouldSnap = shouldSnapHorizontalPointerEnd(dragging.value, event.pointerType, event.type)
    dragging.value = false
    if (shouldSnap) scrollToPage(findHorizontalPageIndex(targets, viewport.scrollLeft))
    if (event.type === 'pointercancel') suppressClick = false
    if (clickResetTimer !== null) window.clearTimeout(clickResetTimer)
    clickResetTimer = window.setTimeout(() => {
      suppressClick = false
      clickResetTimer = null
    }, 0)
  }

  const onClickCapture = (event: MouseEvent) => {
    if (!suppressClick) return
    event.preventDefault()
    event.stopPropagation()
    suppressClick = false
  }

  const onMotionChange = (event: MediaQueryListEvent) => {
    reducedMotion = event.matches
  }

  onMounted(() => {
    motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    reducedMotion = motionQuery.matches
    motionQuery.addEventListener('change', onMotionChange)
    refresh()
  })
  onBeforeUnmount(() => {
    resizeObserver?.disconnect()
    motionQuery?.removeEventListener('change', onMotionChange)
    if (scrollFrame !== null) window.cancelAnimationFrame(scrollFrame)
    if (clickResetTimer !== null) window.clearTimeout(clickResetTimer)
  })
  watch(source, () => {
    currentPage.value = 0
    viewportRef.value?.scrollTo({ left: 0, behavior: 'auto' })
    refresh()
  })

  return {
    overflowing,
    dragging,
    currentPage,
    pageCount,
    canPrevious,
    canNext,
    previous,
    next,
    onScroll,
    onPointerDown,
    onPointerMove,
    onPointerEnd,
    onClickCapture,
  }
}
