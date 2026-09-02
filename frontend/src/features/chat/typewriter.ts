export interface TypewriterOptions {
  charactersPerTick?: number
  intervalMs?: number
  delay?: (milliseconds: number) => Promise<void>
}

function defaultDelay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

export function createTypewriter(
  onText: (value: string) => void,
  options: TypewriterOptions = {},
) {
  const charactersPerTick = Math.max(1, Math.floor(options.charactersPerTick ?? 1))
  const intervalMs = Math.max(0, Math.floor(options.intervalMs ?? 28))
  const delay = options.delay ?? defaultDelay
  let target: string[] = []
  let visibleCharacters = 0
  let lastValue = ''
  let cancelled = false
  let queue = Promise.resolve()

  const emit = () => {
    const value = target.slice(0, visibleCharacters).join('')
    if (value === lastValue)
      return
    lastValue = value
    onText(value)
  }

  const reveal = async () => {
    while (visibleCharacters < target.length) {
      if (cancelled)
        break
      visibleCharacters = Math.min(target.length, visibleCharacters + charactersPerTick)
      emit()
      if (visibleCharacters < target.length)
        await delay(intervalMs)
    }
  }

  const schedule = () => {
    queue = queue.then(reveal)
  }

  return {
    push(chunk: string) {
      if (cancelled || !chunk)
        return
      target.push(...Array.from(chunk))
      schedule()
    },
    async finish(value: string) {
      if (cancelled)
        return
      const visibleText = target.slice(0, visibleCharacters).join('')
      const finalCharacters = Array.from(value)
      if (!value.startsWith(visibleText)) {
        target = finalCharacters
        visibleCharacters = finalCharacters.length
        emit()
        await queue
        return
      }
      visibleCharacters = Math.min(visibleCharacters, finalCharacters.length)
      target = finalCharacters
      schedule()
      await queue
      emit()
    },
    cancel() {
      cancelled = true
    },
  }
}
