import { reduceConfirmationDecision } from './confirmationState.js'

export function shouldClearActiveTask(outcome) {
  return outcome.status === 'completed'
}

export function buildTripPlanRequest(draft, executionToken, language) {
  if (!Number.isInteger(draft.travel_days) || draft.travel_days < 1 || draft.travel_days > 30) {
    return null
  }
  return {
    city: draft.city,
    cities: draft.cities,
    start_date: draft.start_date,
    end_date: draft.end_date,
    travel_days: draft.travel_days,
    transportation: draft.transportation,
    accommodation: draft.accommodation,
    preferences: draft.preferences,
    free_text_input: draft.free_text_input,
    origin_text: draft.origin_text,
    execution_token: executionToken,
    language,
  }
}

export async function orchestrateConfirmationReply(input, dependencies) {
  const originalPending = { cardId: input.cardId, draft: input.draft }
  let response

  try {
    response = await dependencies.confirmReply(
      input.text,
      input.draft,
      input.language,
      input.history
    )
  } catch (error) {
    return {
      effect: {
        type: 'error',
        message: error instanceof Error ? error.message : '',
        keepDraft: true,
      },
      pending: originalPending,
    }
  }

  const effect = reduceConfirmationDecision(
    { draft: input.draft, cardId: input.cardId },
    response
  )

  if (effect.type === 'generate') {
    const generation = await dependencies.generate(effect.draft, effect.token)
    return {
      effect,
      generation,
      pending: generation.status === 'submit_failed'
        ? { cardId: input.cardId, draft: effect.draft }
        : null,
    }
  }

  if (effect.type === 'cancel') {
    return { effect, pending: null }
  }

  if (effect.type === 'update') {
    return { effect, pending: { cardId: input.cardId, draft: effect.draft } }
  }

  return { effect, pending: originalPending }
}
