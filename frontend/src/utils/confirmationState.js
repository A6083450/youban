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
      keepDraft: true,
    }
  }

  return {
    type: response.action === 'chat' || response.action === 'ask_confirmation' ? 'message' : 'error',
    message: response.message || '',
    keepDraft: true,
  }
}
