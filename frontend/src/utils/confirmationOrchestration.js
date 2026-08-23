import { reduceConfirmationDecision } from './confirmationState.js'

export function shouldClearActiveTask(outcome) {
  return outcome.status === 'completed'
}

export function buildTripPlanRequest(draft, executionToken, language) {
  if (!Number.isInteger(draft.travel_days) || draft.travel_days < 1 || draft.travel_days > 30) {
    return null
  }
  const travelerCount = Number.isInteger(draft.traveler_count)
    && draft.traveler_count >= 1 && draft.traveler_count <= 50
    ? draft.traveler_count
    : 1
  const roomCount = Number.isInteger(draft.room_count)
    && draft.room_count >= 1 && draft.room_count <= 50
    ? draft.room_count
    : Math.ceil(travelerCount / 2)
  const budgetAmount = Number.isFinite(draft.budget_amount) && draft.budget_amount >= 0
    ? draft.budget_amount
    : null
  return {
    city: draft.city,
    cities: draft.cities,
    start_date: draft.start_date,
    end_date: draft.end_date,
    travel_days: draft.travel_days,
    transportation: draft.transportation,
    accommodation: draft.accommodation,
    traveler_count: travelerCount,
    room_count: roomCount,
    budget_amount: budgetAmount,
    budget_basis: draft.budget_basis === 'per_person' ? 'per_person' : 'group_total',
    preferences: draft.preferences,
    free_text_input: draft.free_text_input,
    origin_text: draft.origin_text,
    execution_token: executionToken,
    language,
  }
}

export async function orchestrateConfirmationReply(input, dependencies) {
  const originalPending = {
    cardId: input.cardId,
    draft: input.draft,
    readinessToken: input.readinessToken,
  }
  let response

  try {
    response = await dependencies.confirmReply(
      input.text,
      input.draft,
      input.language,
      input.history,
      input.readinessToken
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
        ? { cardId: input.cardId, draft: effect.draft, readinessToken: input.readinessToken }
        : null,
    }
  }

  if (effect.type === 'cancel') {
    return { effect, pending: null }
  }

  if (effect.type === 'update') {
    return {
      effect,
      pending: {
        cardId: input.cardId,
        draft: effect.draft,
        readinessToken: effect.readinessToken,
      },
    }
  }

  const readinessToken = 'readinessToken' in effect
    ? effect.readinessToken ?? input.readinessToken
    : input.readinessToken
  return { effect, pending: { ...originalPending, readinessToken } }
}
