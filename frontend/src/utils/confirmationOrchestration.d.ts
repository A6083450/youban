import type {
  ChatMessage,
  ParsedTripDraft,
  TripConfirmReplyResponse,
  TripFormData,
} from '@/types'
import type { ConfirmationEffect } from './confirmationState.js'

export interface ConfirmationOrchestrationInput {
  text: string
  draft: ParsedTripDraft
  cardId: number
  language: string
  history: ChatMessage[]
}

export type PlanGenerationOutcome =
  | { status: 'completed' }
  | { status: 'submit_failed' }
  | { status: 'watch_failed'; taskId: string }

export function shouldClearActiveTask(outcome: PlanGenerationOutcome): boolean

export function buildTripPlanRequest(
  draft: ParsedTripDraft,
  executionToken: string,
  language: string
): TripFormData | null

export interface ConfirmationOrchestrationDependencies {
  confirmReply: (
    text: string,
    draft: ParsedTripDraft,
    language: string,
    history: ChatMessage[]
  ) => Promise<TripConfirmReplyResponse>
  generate: (draft: ParsedTripDraft, executionToken: string) => Promise<PlanGenerationOutcome>
}

export interface PendingConfirmation {
  cardId: number
  draft: ParsedTripDraft
}

export interface ConfirmationOrchestrationResult {
  effect: ConfirmationEffect
  pending: PendingConfirmation | null
  generation?: PlanGenerationOutcome
}

export function orchestrateConfirmationReply(
  input: ConfirmationOrchestrationInput,
  dependencies: ConfirmationOrchestrationDependencies
): Promise<ConfirmationOrchestrationResult>
