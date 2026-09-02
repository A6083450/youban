import type {
  ChatMessageDto,
  ParsedTripDraftDto,
  TripParseResponseDto,
  TripPlanRequestDto,
} from '@youban/contracts'
import { getCurrentLocale, t } from '@/locale'

export type ParseDecision
  = | { type: 'message', text: string }
    | {
      type: 'draft'
      draft: ParsedTripDraftDto
      text: string
      readyToGenerate: boolean
      readinessToken: string
    }
    | { type: 'generate', draft: ParsedTripDraftDto, text: string, token: string }

export function pickSuggestionBatch(
  values: string[],
  limit = 5,
  random: () => number = Math.random,
): string[] {
  const shuffled = [...new Set(values.filter(Boolean))]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    ;[shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]]
  }
  return shuffled.slice(0, Math.max(0, limit))
}

export function formatAgentReply(response: TripParseResponseDto): string {
  const parts: string[] = []
  const reply = response.reply?.trim() || response.summary?.trim() || response.clarify_question?.trim()
  if (reply)
    parts.push(reply)
  if (response.recommendations?.length) {
    parts.push(response.recommendations
      .map(item => t('chatHome.format.recommendation', {
        destination: item.destination,
        reason: item.reason,
        days: item.suggested_days,
      }))
      .join('\n'))
  }
  const question = response.follow_up_question?.trim()
  if (question && !parts.some(part => part.includes(question)))
    parts.push(question)
  return parts.join('\n\n') || t('chatHome.format.fallback')
}

export function formatTripDraft(draft: ParsedTripDraftDto): string {
  const route = draft.cities
    .map(item => `${item.city} ${t('chatHome.format.days', { days: item.days })}`)
    .join(' → ')
  const budget = draft.budget_amount === null
    ? ''
    : `\n${t('chatHome.format.budget', {
      currency: t('chatHome.format.currency'),
      amount: Math.round(draft.budget_amount).toLocaleString(getCurrentLocale()),
      basis: t(draft.budget_basis === 'per_person' ? 'chatHome.format.perPerson' : 'chatHome.format.groupTotal'),
    })}`
  const preferences = draft.preferences.length
    ? `\n${t('chatHome.format.preferences', {
      value: draft.preferences.join(t('chatHome.format.preferenceSeparator')),
    })}`
    : ''
  return [
    `${draft.city} · ${t('chatHome.format.days', { days: draft.travel_days })}`,
    t('chatHome.format.route', { route }),
    t('chatHome.format.date', { start: draft.start_date, end: draft.end_date }),
    t('chatHome.format.transport', { value: draft.transportation }),
    t('chatHome.format.accommodation', { value: draft.accommodation }),
    `${t('chatHome.format.travelersRooms', {
      travelers: draft.traveler_count,
      rooms: draft.room_count,
    })}${budget}${preferences}`,
  ].join('\n')
}

export function reduceParseResult(response: TripParseResponseDto): ParseDecision {
  const text = formatAgentReply(response)
  if (response.action !== 'plan' || !response.trip)
    return { type: 'message', text }
  if (response.auto_generate === true && response.execution_token) {
    return {
      type: 'generate',
      draft: response.trip,
      text,
      token: response.execution_token,
    }
  }
  return {
    type: 'draft',
    draft: response.trip,
    text,
    readyToGenerate: response.ready_to_generate === true && Boolean(response.readiness_token),
    readinessToken: response.readiness_token || '',
  }
}

export function buildTripPlanRequest(
  draft: ParsedTripDraftDto,
  executionToken: string,
  language: string,
  sessionId = '',
  conversation: ChatMessageDto[] = [],
): TripPlanRequestDto | null {
  if (!Number.isInteger(draft.travel_days) || draft.travel_days < 1 || draft.travel_days > 30)
    return null
  const travelerCount = Number.isInteger(draft.traveler_count) && draft.traveler_count >= 1 && draft.traveler_count <= 50
    ? draft.traveler_count
    : 1
  const roomCount = Number.isInteger(draft.room_count) && draft.room_count >= 1 && draft.room_count <= 50
    ? draft.room_count
    : Math.ceil(travelerCount / 2)
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
    budget_amount: Number.isFinite(draft.budget_amount) && Number(draft.budget_amount) >= 0
      ? draft.budget_amount
      : null,
    budget_basis: draft.budget_basis === 'per_person' ? 'per_person' : 'group_total',
    preferences: draft.preferences,
    free_text_input: draft.free_text_input,
    origin_text: draft.origin_text,
    execution_token: executionToken,
    language,
    ...(sessionId ? { session_id: sessionId } : {}),
    ...(conversation.length ? { conversation } : {}),
  }
}
