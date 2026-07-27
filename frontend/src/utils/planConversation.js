export const NEW_PLAN_EVENT = 'tripstar:new-plan'

export function buildArchivedConversation(items) {
  return items
    .filter((item) => item?.type === 'text' && (item.role === 'user' || item.role === 'assistant'))
    .map((item) => ({ role: item.role, content: String(item.text ?? '').trim() }))
    .filter((message) => message.content)
}

export function completeTripPlanResponse(result, eventPlanId, taskId) {
  return {
    ...result,
    plan_id: result?.plan_id || eventPlanId || taskId,
  }
}

export function canUseCachedPlan(data, storedPlanId, targetPlanId) {
  if (!data) return false

  const stored = String(storedPlanId || '')
  const target = String(targetPlanId || '')
  if (target) return Boolean(stored) && stored === target
  return Boolean(stored)
}
