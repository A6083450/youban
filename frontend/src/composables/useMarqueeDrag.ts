import { nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

const DRAG_THRESHOLD = 6
const MARQUEE_SPEED = 45

export const useMarqueeDrag = (
  viewportRef: Ref<HTMLElement | null>,
  stripRef: Ref<HTMLElement | null>,
  source: Ref<unknown>,
) => {
  const loop = ref(false)
  const duration = ref(20)
  const manual = ref(false)
  const dragging = ref(false)

  let observer: ResizeObserver | null = null
  let observedViewport: HTMLElement | null = null
  let activePointerId: number | null = null
  let dragStartX = 0
  let dragStartScrollLeft = 0
  let dragStartTime = 0
  let suppressClick = false
  let clickResetTimer: number | null = null

  const update = () => {
    const viewport = viewportRef.value
    const group = stripRef.value?.firstElementChild
    if (!(group instanceof HTMLElement) || !viewport) {
      loop.value = false
      return
    }
    const groupWidth = Math.max(group.scrollWidth, group.offsetWidth)
    loop.value = groupWidth > viewport.clientWidth
    duration.value = Math.max(14, Math.round(groupWidth / MARQUEE_SPEED))
  }

  const refresh = () => void nextTick(() => {
    const viewport = viewportRef.value
    if (viewport && viewport !== observedViewport) {
      observer ??= new ResizeObserver(update)
      if (observedViewport) observer.unobserve(observedViewport)
      observer.observe(viewport)
      observedViewport = viewport
    }
    update()
  })

  const onPointerDown = (event: PointerEvent) => {
    const viewport = viewportRef.value
    if (!viewport || (event.pointerType === 'mouse' && event.button !== 0)) return
    activePointerId = event.pointerId
    dragStartX = event.clientX
    dragStartScrollLeft = viewport.scrollLeft
    dragStartTime = Number(stripRef.value?.getAnimations()[0]?.currentTime ?? 0)
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
    manual.value = true
    suppressClick = true

    const animation = stripRef.value?.getAnimations()[0]
    if (!loop.value || !animation) {
      viewport.scrollLeft = dragStartScrollLeft - delta
      return
    }
    const cycle = duration.value * 1000
    const nextTime = dragStartTime - (delta / MARQUEE_SPEED) * 1000
    animation.currentTime = ((nextTime % cycle) + cycle) % cycle
  }

  const onPointerEnd = (event: PointerEvent) => {
    const viewport = viewportRef.value
    if (!viewport || event.pointerId !== activePointerId) return
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId)
    activePointerId = null
    dragging.value = false
    if (event.type === 'pointercancel' || event.pointerType !== 'mouse' || !viewport.matches(':hover')) {
      manual.value = false
    }
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

  const onPointerLeave = () => {
    if (!dragging.value) manual.value = false
  }

  onMounted(refresh)
  onBeforeUnmount(() => {
    observer?.disconnect()
    if (clickResetTimer !== null) window.clearTimeout(clickResetTimer)
  })
  watch(source, () => {
    manual.value = false
    refresh()
  })

  return {
    loop,
    duration,
    manual,
    dragging,
    onPointerDown,
    onPointerMove,
    onPointerEnd,
    onPointerLeave,
    onClickCapture,
  }
}
