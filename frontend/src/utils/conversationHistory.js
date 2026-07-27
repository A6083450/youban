export const CONFIRMATION_CARD_HISTORY_MESSAGE = '当前行程草稿已展示，正在等待用户确认是否生成或继续修改。'

export function buildConversationHistory(items, currentUserItemId, limit = 10) {
  return items
    .flatMap((item) => {
      if (item.id === currentUserItemId) return []
      if (item.type === 'text') {
        return [{ role: item.role, content: item.text }]
      }
      if (item.type === 'confirm') {
        return [{ role: 'assistant', content: CONFIRMATION_CARD_HISTORY_MESSAGE }]
      }
      return []
    })
    .slice(-limit)
}
