export function buildConversationHistory(items, currentUserItemId, limit = 10) {
  return items
    .flatMap((item) => {
      if (item.id === currentUserItemId) return []
      if (item.type === 'text' || item.type === 'draft') {
        return [{ role: item.role, content: item.text }]
      }
      return []
    })
    .slice(-limit)
}
