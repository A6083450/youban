export function isConversationNearBottom(
  container: Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'> | null,
  threshold?: number
): boolean

export function scrollConversationToBottom(
  container: Pick<HTMLElement, 'scrollTop' | 'scrollHeight'> | null,
  anchor: Pick<HTMLElement, 'scrollIntoView'> | null
): void
