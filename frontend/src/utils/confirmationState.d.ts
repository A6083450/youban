import type { ParsedTripDraft, TripConfirmReplyResponse } from '@/types'

export interface ConfirmationState {
  draft: ParsedTripDraft
  cardId: number
}

export type ConfirmationEffect =
  | { type: 'message'; message: string; keepDraft: true }
  | { type: 'update'; draft: ParsedTripDraft; cardId: number; message: string; keepDraft: true }
  | { type: 'cancel'; message: string; cardId: number; keepDraft: false }
  | { type: 'error'; message: string; keepDraft: true }
  | { type: 'generate'; draft: ParsedTripDraft; token: string; keepDraft: false }

export function reduceConfirmationDecision(
  state: ConfirmationState,
  response: TripConfirmReplyResponse
): ConfirmationEffect
