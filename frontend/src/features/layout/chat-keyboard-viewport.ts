import { computed, ref } from 'vue'

interface KeyboardHeightChangeEvent {
  detail?: {
    height?: unknown
  }
}

export function useChatKeyboardViewport(onResize: () => void = () => undefined) {
  const height = ref(0)
  const style = computed(() => ({
    '--chat-keyboard-height': `${height.value}px`,
  }))

  function setHeight(value: unknown): void {
    const next = Math.max(0, Math.round(Number(value) || 0))
    if (next === height.value)
      return
    height.value = next
    onResize()
  }

  return {
    style,
    update: (event: KeyboardHeightChangeEvent) => setHeight(event.detail?.height),
    reset: () => setHeight(0),
  }
}
