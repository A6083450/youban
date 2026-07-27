export function isConversationNearBottom(container, threshold = 48) {
  if (!container) return true
  return container.scrollHeight - container.clientHeight - container.scrollTop <= threshold
}

export function scrollConversationToBottom(container, anchor) {
  if (container) {
    container.scrollTop = container.scrollHeight
    return
  }
  if (anchor && typeof anchor.scrollIntoView === 'function') {
    anchor.scrollIntoView({ block: 'end', inline: 'nearest' })
  }
}
