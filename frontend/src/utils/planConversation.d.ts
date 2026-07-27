import type { ChatMessage, TripPlanResponse } from '@/types'

export const NEW_PLAN_EVENT: string

export function buildArchivedConversation(
  items: Array<{ role?: string; type?: string; text?: unknown }>
): ChatMessage[]

export function completeTripPlanResponse(
  result: TripPlanResponse,
  eventPlanId?: string,
  taskId?: string
): TripPlanResponse

export function canUseCachedPlan(
  data: string | null,
  storedPlanId?: string | null,
  targetPlanId?: string | null
): boolean
