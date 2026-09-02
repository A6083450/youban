import { ref } from 'vue'
import { getTripHistory } from '@/services/api'
import type { TripHistoryItem } from '@/types'

export const plans = ref<TripHistoryItem[]>([])
export const plansLoading = ref(false)

export const refreshPlans = async () => {
  plansLoading.value = true
  try {
    plans.value = await getTripHistory(50)
  } catch {
    plans.value = []
  } finally {
    plansLoading.value = false
  }
}

export const PLANS_UPDATED_EVENT = 'youban:plans-updated'

export const notifyPlansUpdated = () => {
  window.dispatchEvent(new CustomEvent(PLANS_UPDATED_EVENT))
}
