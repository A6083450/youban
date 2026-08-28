import type { ParsedTripDraft, TripConfirmReplyResponse, TripParseApiResponse } from '@/types'

export interface ConfirmationState {
  draft: ParsedTripDraft
  cardId: number
}

export type ConfirmationEffect =
  | { type: 'message'; message: string; readyToGenerate?: boolean; readinessToken?: string; offerGeneration?: boolean; keepDraft: true }
  | { type: 'update'; draft: ParsedTripDraft; cardId: number; message: string; readyToGenerate?: boolean; readinessToken: string; keepDraft: true }
  | { type: 'cancel'; message: string; cardId: number; keepDraft: false }
  | { type: 'error'; message: string; readyToGenerate?: boolean; readinessToken?: string; offerGeneration?: boolean; keepDraft: true }
  | { type: 'generate'; draft: ParsedTripDraft; token: string; keepDraft: false }

export function reduceConfirmationDecision(
  state: ConfirmationState,
  response: TripConfirmReplyResponse
): ConfirmationEffect

export type TripParseEffect =
  | { type: 'message' }
  | { type: 'draft'; draft: ParsedTripDraft; readyToGenerate: boolean; readinessToken: string }
  | { type: 'generate'; draft: ParsedTripDraft; token: string }

export function reduceTripParseDecision(response: TripParseApiResponse): TripParseEffect
