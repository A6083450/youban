export const ACTIVE_TRIP_TASK_UPDATED_EVENT = 'youban:active-trip-task-updated'

export interface ActiveTripTaskRecord {
  readonly taskId: string
  readonly city: string
  readonly days: number
  readonly userText: string
  readonly startDate?: string
  readonly endDate?: string
}

const storageKey = (ownerId: string): string => `tripstar.active_task.${ownerId}`

const isOptionalString = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === 'string'

const isActiveTripTaskRecord = (value: unknown): value is ActiveTripTaskRecord => {
  if (typeof value !== 'object' || value === null) return false
  if (!('taskId' in value) || typeof value.taskId !== 'string' || !value.taskId) return false
  if (!('city' in value) || typeof value.city !== 'string') return false
  if (!('days' in value) || typeof value.days !== 'number') return false
  if (!('userText' in value) || typeof value.userText !== 'string') return false

  return (!('startDate' in value) || isOptionalString(value.startDate))
    && (!('endDate' in value) || isOptionalString(value.endDate))
}

const notifyActiveTripTaskUpdated = (): void => {
  window.dispatchEvent(new CustomEvent(ACTIVE_TRIP_TASK_UPDATED_EVENT))
}

export const readActiveTripTask = (ownerId: string): ActiveTripTaskRecord | null => {
  try {
    const raw = localStorage.getItem(storageKey(ownerId))
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    return isActiveTripTaskRecord(value) ? value : null
  } catch {
    return null
  }
}

export const saveActiveTripTask = (
  record: ActiveTripTaskRecord,
  ownerId: string,
): boolean => {
  try {
    localStorage.setItem(storageKey(ownerId), JSON.stringify(record))
    notifyActiveTripTaskUpdated()
    return true
  } catch {
    return false
  }
}

export const clearActiveTripTask = (taskId: string, ownerId: string): boolean => {
  if (readActiveTripTask(ownerId)?.taskId !== taskId) return false
  try {
    localStorage.removeItem(storageKey(ownerId))
    notifyActiveTripTaskUpdated()
    return true
  } catch {
    return false
  }
}
