export function reduceConfirmationDecision(state, response) {
  if (response.action === 'confirm') {
    if (!response.execution_token) {
      return {
        type: 'error',
        message: response.message || '',
        keepDraft: true,
      }
    }
    return {
      type: 'generate',
      draft: response.trip || state.draft,
      token: response.execution_token,
      keepDraft: false,
    }
  }

  if (response.action === 'cancel') {
    return {
      type: 'cancel',
      message: response.message || '',
      cardId: state.cardId,
      keepDraft: false,
    }
  }

  if (response.action === 'update' && response.trip) {
    return {
      type: 'update',
      draft: response.trip,
      cardId: state.cardId,
      message: response.message || '',
      ...(typeof response.ready_to_generate === 'boolean'
        ? { readyToGenerate: response.ready_to_generate }
        : {}),
      readinessToken: response.readiness_token || '',
      keepDraft: true,
    }
  }

  return {
    type: response.action === 'chat' || response.action === 'ask_confirmation' ? 'message' : 'error',
    message: response.message || '',
    ...(typeof response.ready_to_generate === 'boolean'
      ? { readyToGenerate: response.ready_to_generate }
      : {}),
    ...(typeof response.readiness_token === 'string'
      ? { readinessToken: response.readiness_token }
      : {}),
    ...(response.next_step === 'offer_generation'
      ? { offerGeneration: true }
      : {}),
    keepDraft: true,
  }
}

export function reduceTripParseDecision(response) {
  if (response.action === 'plan' && response.trip) {
    if (response.auto_generate === true && response.execution_token) {
      return {
        type: 'generate',
        draft: response.trip,
        token: response.execution_token,
      }
    }
    return {
      type: 'draft',
      draft: response.trip,
      readyToGenerate: response.ready_to_generate === true && Boolean(response.readiness_token),
      readinessToken: response.readiness_token || '',
    }
  }
  return { type: 'message' }
}
