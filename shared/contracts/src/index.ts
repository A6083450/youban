import { Type, type Static } from '@sinclair/typebox'

export const API_V2_PREFIX = '/api/v2' as const

export const ApiV2Routes = {
  runtimeSettings: '/api/v2/settings',
  authMe: '/api/v2/auth/me',
  authLogout: '/api/v2/auth/logout',
  authNicknameLogin: '/api/v2/auth/nickname',
  authWechatLogin: '/api/v2/auth/wechat/login',
  authWebChallengeCreate: '/api/v2/auth/web/challenges',
  authWebChallengeStatus: '/api/v2/auth/web/challenges/:challengeId/status',
  authWebChallengeApprove: '/api/v2/auth/web/challenges/:challengeId/approve',
  authWebChallengeExchange: '/api/v2/auth/web/challenges/:challengeId/exchange',
  authPreferences: '/api/v2/auth/preferences',
  authMemories: '/api/v2/auth/memories',
  authMemory: '/api/v2/auth/memories/:memoryId',
  accountAvatar: '/api/v2/account/profile/avatar',
  conversations: '/api/v2/conversations',
  conversation: '/api/v2/conversations/:sessionId',
  tripHistory: '/api/v2/trip/history',
  tripParse: '/api/v2/trip/parse',
  tripParseStream: '/api/v2/trip/parse/stream',
  tripConfirmReply: '/api/v2/trip/confirm-reply',
  tripConfirmReplyStream: '/api/v2/trip/confirm-reply/stream',
  tripPlan: '/api/v2/trip/plan',
  tripPlanResource: '/api/v2/trip/plan/:planId',
  tripRetry: '/api/v2/trip/plan/:planId/retry',
  tripStatus: '/api/v2/trip/status/:taskId',
  tripEvents: '/api/v2/trip/ws/:taskId',
  tripPlanConversation: '/api/v2/trip/plan/:planId/conversation',
  tripBudgetItems: '/api/v2/trip/plan/:planId/budget-items',
  tripBudgetItem: '/api/v2/trip/plan/:planId/budget-items/:itemId',
  tripItemStatus: '/api/v2/trip/plan/:planId/items/:itemId/status',
  tripAttractions: '/api/v2/trip/plan/:planId/attractions',
  tripAttraction: '/api/v2/trip/plan/:planId/attractions/:itemId',
  poiSearch: '/api/v2/poi/search',
  tripShare: '/api/v2/trip/share/:shareCode',
  miniProgramActions: '/api/v2/miniprogram/actions',
  miniProgramAction: '/api/v2/miniprogram/actions/:actionId',
  miniProgramActionComplete: '/api/v2/miniprogram/actions/:actionId/complete',
  tripChatEdit: '/api/v2/chat/edit',
} as const

export const PublicRuntimeSettingsSchema = Type.Object({
  vite_amap_web_key: Type.String(),
  vite_amap_web_js_key: Type.String(),
  llm_thinking_enabled: Type.Boolean(),
  llm_thinking_visible: Type.Boolean(),
}, { additionalProperties: false })

export const PublicRuntimeSettingsResponseSchema = Type.Object({
  success: Type.Literal(true),
  data: PublicRuntimeSettingsSchema,
}, { additionalProperties: false })

export const DetailErrorSchema = Type.Object({
  detail: Type.String(),
}, { additionalProperties: false })

export const UserInfoSchema = Type.Object({
  user_id: Type.String(),
  nickname: Type.String(),
  avatar_url: Type.Union([Type.String(), Type.Null()]),
  profile_complete: Type.Boolean(),
  created_at: Type.Optional(Type.String()),
  last_login_at: Type.Optional(Type.String()),
}, { additionalProperties: false })

export const AuthResponseSchema = Type.Object({
  success: Type.Literal(true),
  user: UserInfoSchema,
}, { additionalProperties: false })

export const NicknameLoginBodySchema = Type.Object({
  nickname: Type.String({ maxLength: 128 }),
}, { additionalProperties: false })

export const WechatLoginResponseSchema = Type.Object({
  success: Type.Literal(true),
  token: Type.String({ minLength: 1 }),
  user: UserInfoSchema,
}, { additionalProperties: false })

export const WebLoginChallengeCreateSchema = Type.Object({
  challenge_id: Type.String({ pattern: '^[0-9a-f]{32}$' }),
  expires_at: Type.String({ minLength: 1 }),
  qr_code_data_url: Type.String({ pattern: '^data:image/(?:png|jpeg);base64,' }),
}, { additionalProperties: false })

export const WebLoginChallengeStatusSchema = Type.Object({
  status: Type.Union([
    Type.Literal('pending'),
    Type.Literal('approved'),
    Type.Literal('expired'),
    Type.Literal('exchanged'),
  ]),
}, { additionalProperties: false })

export const WebLoginChallengeExchangeSchema = AuthResponseSchema

export const UserSkinSchema = Type.Union([Type.Literal('default'), Type.Literal('google')])
export const UserLocaleSchema = Type.Union([
  Type.Literal('zh-CN'),
  Type.Literal('en-US'),
  Type.Literal('fr-FR'),
])
export const UserPreferencesSchema = Type.Object({
  skin: UserSkinSchema,
  locale: UserLocaleSchema,
  initialized: Type.Boolean(),
  updated_at: Type.Union([Type.String(), Type.Null()]),
}, { additionalProperties: false })
export const UserPreferencesPatchSchema = Type.Object({
  skin: Type.Optional(UserSkinSchema),
  locale: Type.Optional(UserLocaleSchema),
}, { additionalProperties: false })

export const UserMemorySchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  memory: Type.String({ minLength: 1 }),
  created_at: Type.String({ minLength: 1 }),
}, { additionalProperties: false })

export const UserMemoryListSchema = Type.Object({
  success: Type.Literal(true),
  items: Type.Array(UserMemorySchema),
}, { additionalProperties: false })

export const ChatMessageSchema = Type.Object({
  role: Type.Union([Type.Literal('user'), Type.Literal('assistant')]),
  content: Type.String({ minLength: 1, maxLength: 4_000 }),
}, { additionalProperties: false })

export const CityStaySchema = Type.Object({
  city: Type.String({ minLength: 1, maxLength: 100 }),
  days: Type.Integer({ minimum: 1, maximum: 15 }),
}, { additionalProperties: false })

export const BudgetAmountBasisSchema = Type.Union([
  Type.Literal('group_total'),
  Type.Literal('per_person'),
])

export const ParsedTripDraftSchema = Type.Object({
  city: Type.String(),
  cities: Type.Array(CityStaySchema),
  start_date: Type.String(),
  end_date: Type.String(),
  travel_days: Type.Integer(),
  transportation: Type.String(),
  accommodation: Type.String(),
  traveler_count: Type.Integer(),
  room_count: Type.Integer(),
  budget_amount: Type.Union([Type.Number(), Type.Null()]),
  budget_basis: BudgetAmountBasisSchema,
  preferences: Type.Array(Type.String()),
  free_text_input: Type.String(),
  origin_text: Type.String(),
  inferred_fields: Type.Optional(Type.Array(Type.String())),
  suggestions: Type.Optional(Type.Array(Type.String())),
}, { additionalProperties: false })

export const TripParseResponseSchema = Type.Object({
  success: Type.Boolean(),
  action: Type.Optional(Type.Union([
    Type.Literal('plan'), Type.Literal('clarify'), Type.Literal('recommend'), Type.Literal('chat'),
  ])),
  emotion: Type.Optional(Type.Union([
    Type.Literal('neutral'), Type.Literal('uncertain'), Type.Literal('frustrated'),
    Type.Literal('excited'), Type.Literal('anxious'),
  ])),
  next_step: Type.Optional(Type.Union([
    Type.Literal('ask'), Type.Literal('recommend'), Type.Literal('offer_generation'),
    Type.Literal('generate_now'), Type.Literal('pause'),
  ])),
  auto_generate: Type.Optional(Type.Boolean()),
  execution_token: Type.Optional(Type.String()),
  reply: Type.Optional(Type.String()),
  follow_up_question: Type.Optional(Type.String()),
  recommendations: Type.Optional(Type.Array(Type.Object({
    destination: Type.String(),
    reason: Type.String(),
    suggested_days: Type.Number(),
  }, { additionalProperties: false }))),
  need_clarify: Type.Boolean(),
  ready_to_generate: Type.Optional(Type.Boolean()),
  readiness_token: Type.Optional(Type.String()),
  clarify_question: Type.String(),
  summary: Type.String(),
  trip: Type.Optional(Type.Union([ParsedTripDraftSchema, Type.Null()])),
}, { additionalProperties: false })

export const TripConfirmReplyResponseSchema = Type.Object({
  success: Type.Boolean(),
  action: Type.Union([
    Type.Literal('confirm'), Type.Literal('cancel'), Type.Literal('update'),
    Type.Literal('chat'), Type.Literal('ask_confirmation'),
  ]),
  confidence: Type.Number(),
  message: Type.String(),
  next_step: Type.Optional(TripParseResponseSchema.properties.next_step),
  ready_to_generate: Type.Optional(Type.Boolean()),
  readiness_token: Type.Optional(Type.String()),
  trip: Type.Optional(Type.Union([ParsedTripDraftSchema, Type.Null()])),
  decision_id: Type.Optional(Type.String()),
  execution_token: Type.Optional(Type.String()),
}, { additionalProperties: false })

export const TripPlanRequestSchema = Type.Object({
  city: Type.Optional(Type.String({ maxLength: 100 })),
  cities: Type.Optional(Type.Array(CityStaySchema, { maxItems: 30 })),
  start_date: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
  end_date: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
  travel_days: Type.Integer({ minimum: 1, maximum: 30 }),
  transportation: Type.String({ minLength: 1, maxLength: 200 }),
  accommodation: Type.String({ minLength: 1, maxLength: 200 }),
  preferences: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 100 })),
  traveler_count: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
  room_count: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
  budget_amount: Type.Optional(Type.Union([Type.Number({ minimum: 0, maximum: 100_000_000 }), Type.Null()])),
  budget_basis: Type.Optional(BudgetAmountBasisSchema),
  free_text_input: Type.Optional(Type.String()),
  origin_text: Type.Optional(Type.String()),
  language: Type.Optional(Type.String()),
  conversation: Type.Optional(Type.Array(ChatMessageSchema, { maxItems: 100 })),
  session_id: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  execution_token: Type.String(),
}, { additionalProperties: false })

export const SubmitTripPlanResponseSchema = Type.Object({
  task_id: Type.String(),
  plan_id: Type.String(),
  status: Type.Literal('processing'),
  ws_url: Type.String(),
  message: Type.String(),
}, { additionalProperties: false })

export const RetryTripPlanBodySchema = Type.Object({
  restart_all: Type.Optional(Type.Boolean()),
}, { additionalProperties: false })

export const TripTaskStatusSchema = Type.Union([
  Type.Literal('processing'),
  Type.Literal('completed'),
  Type.Literal('failed'),
])

export const PlanQualitySchema = Type.Union([
  Type.Literal('fast'),
  Type.Literal('enhanced'),
])

export const EnhancementStatusSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('running'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('skipped'),
])

export const TripTaskStageSchema = Type.Union([
  Type.Literal('submitted'),
  Type.Literal('initializing'),
  Type.Literal('attraction_search'),
  Type.Literal('weather_search'),
  Type.Literal('hotel_search'),
  Type.Literal('planning'),
  Type.Literal('reviewing'),
  Type.Literal('graph_building'),
  Type.Literal('completed'),
  Type.Literal('failed'),
])

export const TripTaskDetailSchema = Type.Object({
  type: Type.Union([
    Type.Literal('thinking'),
    Type.Literal('searching'),
    Type.Literal('found'),
    Type.Literal('planning'),
    Type.Literal('tool_call'),
    Type.Literal('info'),
  ]),
  title: Type.String(),
  content: Type.Optional(Type.String()),
  timestamp: Type.Optional(Type.Number()),
}, { additionalProperties: false })

export const TripCheckpointSummarySchema = Type.Object({
  completed_segments: Type.Number(),
  total_segments: Type.Number(),
  last_successful_stage: Type.String(),
}, { additionalProperties: false })

export const ItemExecutionStatusSchema = Type.Union([
  Type.Literal('done'),
  Type.Literal('skipped'),
  Type.Literal('postponed'),
  Type.Literal('pending'),
])

export const ItemExecutionEntrySchema = Type.Object({
  status: Type.Union([
    Type.Literal('done'),
    Type.Literal('skipped'),
    Type.Literal('postponed'),
  ]),
  updated_at: Type.Optional(Type.String()),
  actual_cost: Type.Optional(Type.Number({ minimum: 0 })),
}, { additionalProperties: false })

export const ExecutionMapSchema = Type.Record(Type.String(), ItemExecutionEntrySchema)

export const ItemExecutionPatchSchema = Type.Object({
  status: ItemExecutionStatusSchema,
  actual_cost: Type.Optional(Type.Number({ minimum: 0 })),
}, { additionalProperties: false })

export const ItemExecutionResponseSchema = Type.Object({
  success: Type.Literal(true),
  execution: Type.Union([ItemExecutionEntrySchema, Type.Null()]),
}, { additionalProperties: false })

export const TripTaskEventSchema = Type.Object({
  task_id: Type.String(),
  plan_id: Type.String(),
  status: TripTaskStatusSchema,
  stage: TripTaskStageSchema,
  progress: Type.Number(),
  message: Type.String(),
  details: Type.Optional(Type.Array(TripTaskDetailSchema)),
  error: Type.Optional(Type.String()),
  result: Type.Optional(Type.Unknown()),
  checkpoint_summary: Type.Optional(TripCheckpointSummarySchema),
  request_payload: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  plan_quality: Type.Optional(PlanQualitySchema),
  enhancement_status: Type.Optional(EnhancementStatusSchema),
  deadline_seconds: Type.Optional(Type.Number({ minimum: 0 })),
  generation_elapsed_ms: Type.Optional(Type.Number({ minimum: 0 })),
  fast_plan_revision: Type.Optional(Type.String()),
}, { additionalProperties: false })

const TaskMetadataProperties = {
  plan_quality: Type.Optional(PlanQualitySchema),
  enhancement_status: Type.Optional(EnhancementStatusSchema),
  deadline_seconds: Type.Optional(Type.Number({ minimum: 0 })),
  generation_elapsed_ms: Type.Optional(Type.Number({ minimum: 0 })),
  fast_plan_revision: Type.Optional(Type.String()),
}

export const TripTaskStatusResponseSchema = Type.Union([
  Type.Object({
    task_id: Type.String(),
    plan_id: Type.String(),
    status: Type.Literal('processing'),
    stage: TripTaskStageSchema,
    progress: Type.Number(),
    progress_text: Type.String(),
    details: Type.Optional(Type.Array(TripTaskDetailSchema)),
  }, { additionalProperties: false }),
  Type.Object({
    task_id: Type.String(),
    plan_id: Type.String(),
    status: Type.Literal('completed'),
    result: Type.Unknown(),
    execution: ExecutionMapSchema,
    ...TaskMetadataProperties,
  }, { additionalProperties: false }),
  Type.Object({
    task_id: Type.String(),
    plan_id: Type.String(),
    status: Type.Literal('failed'),
    error: Type.String(),
    request_payload: Type.Record(Type.String(), Type.Unknown()),
    checkpoint_summary: Type.Optional(TripCheckpointSummarySchema),
  }, { additionalProperties: false }),
])

export const NativeActionTypeSchema = Type.Union([
  Type.Literal('share'),
  Type.Literal('save_guide'),
  Type.Literal('add_calendar'),
])

export const NativeCalendarEventSchema = Type.Object({
  title: Type.String(),
  startTime: Type.Number(),
  endTime: Type.Number(),
  allDay: Type.Boolean(),
  description: Type.String(),
  location: Type.String(),
  alarm: Type.Boolean(),
  alarmOffset: Type.Number(),
}, { additionalProperties: false })

export const NativeActionTicketSchema = Type.Object({
  action_id: Type.String(),
  expires_at: Type.String(),
}, { additionalProperties: false })

export const NativeActionSchema = Type.Object({
  type: NativeActionTypeSchema,
  payload: Type.Record(Type.String(), Type.Unknown()),
  expires_at: Type.String(),
}, { additionalProperties: false })

export const TripPlanConversationSchema = Type.Object({
  plan_id: Type.String(),
  messages: Type.Array(ChatMessageSchema),
}, { additionalProperties: false })

export const TripChatEditResponseSchema = Type.Object({
  success: Type.Boolean(),
  reply: Type.String(),
  updated_plan: Type.Optional(Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()])),
  changes: Type.Array(Type.String()),
}, { additionalProperties: false })

export const BudgetItemTypeSchema = Type.Union([
  Type.Literal('attraction'),
  Type.Literal('hotel'),
  Type.Literal('meal'),
  Type.Literal('transport'),
  Type.Literal('other'),
])

export const BudgetSummarySchema = Type.Object({
  total_attractions: Type.Number(),
  total_hotels: Type.Number(),
  total_meals: Type.Number(),
  total_transportation: Type.Number(),
  total_inter_city_transport: Type.Optional(Type.Number()),
  total_other: Type.Optional(Type.Number()),
  total: Type.Number(),
}, { additionalProperties: false })

export const BudgetLedgerItemSchema = Type.Object({
  id: Type.String(),
  type: BudgetItemTypeSchema,
  day_index: Type.Union([Type.Number(), Type.Null()]),
  day_end_index: Type.Union([Type.Number(), Type.Null()]),
  name: Type.String(),
  amount: Type.Union([Type.Number(), Type.Null()]),
  amount_basis: BudgetAmountBasisSchema,
  traveler_count: Type.Number(),
  per_person_amount: Type.Union([Type.Number(), Type.Null()]),
  calculation_summary: Type.String(),
  unit_amount: Type.Union([Type.Number(), Type.Null()]),
  room_count: Type.Union([Type.Number(), Type.Null()]),
  nights: Type.Union([Type.Number(), Type.Null()]),
  origin: Type.Union([Type.Literal('itinerary'), Type.Literal('user')]),
  price_source: Type.Union([
    Type.Literal('unavailable'), Type.Literal('estimated'), Type.Literal('live'), Type.Literal('user'),
  ]),
  price_provider: Type.String(),
  linked_item_id: Type.String(),
  entity_source: Type.String(),
  source_url: Type.String(),
  price_checked_at: Type.String(),
  note: Type.String(),
  user_locked: Type.Boolean(),
  deleted: Type.Boolean(),
}, { additionalProperties: false })

export const BudgetLedgerResponseSchema = Type.Object({
  plan_id: Type.String(),
  items: Type.Array(BudgetLedgerItemSchema),
  totals: BudgetSummarySchema,
  per_person_totals: BudgetSummarySchema,
  traveler_count: Type.Number(),
  room_count: Type.Number(),
  pending_count: Type.Number(),
  budget_limit: Type.Union([Type.Number(), Type.Null()]),
  quoted_total: Type.Number(),
  over_budget_amount: Type.Number(),
  pending_buffer: Type.Number(),
  projected_total: Type.Number(),
  projected_over_budget_amount: Type.Number(),
  adjustment_applied: Type.Boolean(),
  adjustment_note: Type.String(),
}, { additionalProperties: false })

export const BudgetItemInputSchema = Type.Object({
  type: BudgetItemTypeSchema,
  day_index: Type.Union([Type.Number(), Type.Null()]),
  name: Type.String(),
  amount: Type.Union([Type.Number(), Type.Null()]),
  amount_basis: BudgetAmountBasisSchema,
  note: Type.Optional(Type.String()),
}, { additionalProperties: false })

export const TripLocationSchema = Type.Object({
  longitude: Type.Number(),
  latitude: Type.Number(),
}, { additionalProperties: false })

export const PoiSearchItemSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  type: Type.String(),
  address: Type.String(),
  location: TripLocationSchema,
}, { additionalProperties: false })

export const PoiSearchResponseSchema = Type.Object({
  success: Type.Literal(true),
  message: Type.String(),
  data: Type.Array(PoiSearchItemSchema),
}, { additionalProperties: false })

export const AttractionMutationInputSchema = Type.Object({
  day_index: Type.Number({ minimum: 0 }),
  poi_id: Type.String({ minLength: 1, maxLength: 80 }),
  name: Type.String({ minLength: 1, maxLength: 120 }),
  address: Type.Optional(Type.String({ maxLength: 300 })),
  location: TripLocationSchema,
  visit_duration: Type.Number({ minimum: 30, maximum: 720 }),
  description: Type.Optional(Type.String({ maxLength: 1_000 })),
  ticket_price: Type.Number({ minimum: 0, maximum: 1_000_000 }),
  start_time: Type.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }),
  reservation_required: Type.Optional(Type.Boolean()),
  reservation_tips: Type.Optional(Type.String({ maxLength: 500 })),
}, { additionalProperties: false })

export const ItineraryMutationResponseSchema = Type.Object({
  ...BudgetLedgerResponseSchema.properties,
  plan: Type.Record(Type.String(), Type.Unknown()),
}, { additionalProperties: false })

export const TripHistoryItemSchema = Type.Object({
  plan_id: Type.String(),
  task_id: Type.String(),
  status: TripTaskStatusSchema,
  user_id: Type.String(),
  city: Type.String(),
  cities: Type.Array(Type.Unknown()),
  start_date: Type.String(),
  end_date: Type.String(),
  travel_days: Type.Number(),
  updated_at: Type.String(),
  overall_suggestions: Type.String(),
}, { additionalProperties: false })

export const TripHistoryResponseSchema = Type.Object({
  items: Type.Array(TripHistoryItemSchema),
}, { additionalProperties: false })

export const ConversationTitleStatusSchema = Type.Union([
  Type.Literal('pending'), Type.Literal('generated'), Type.Literal('fallback'),
])

export const ConversationStateSchema = Type.Union([
  Type.Literal('chatting'), Type.Literal('generating'), Type.Literal('planned'),
])

export const ConversationRecordSchema = Type.Object({
  record_id: Type.String(),
  kind: Type.Union([Type.Literal('conversation'), Type.Literal('plan')]),
  session_id: Type.Union([Type.String(), Type.Null()]),
  plan_id: Type.Union([Type.String(), Type.Null()]),
  task_id: Type.Union([Type.String(), Type.Null()]),
  title: Type.String(),
  title_status: ConversationTitleStatusSchema,
  state: ConversationStateSchema,
  revision: Type.Integer({ minimum: 0 }),
  status: Type.Union([TripTaskStatusSchema, Type.Null()]),
  user_id: Type.String(),
  city: Type.String(),
  cities: Type.Array(Type.Unknown()),
  start_date: Type.String(),
  end_date: Type.String(),
  travel_days: Type.Number(),
  updated_at: Type.String(),
  overall_suggestions: Type.String(),
  user_deleted_at: Type.Union([Type.String(), Type.Null()]),
}, { additionalProperties: false })

export const ConversationSessionDetailSchema = Type.Object({
  ...ConversationRecordSchema.properties,
  snapshot: Type.Record(Type.String(), Type.Unknown()),
}, { additionalProperties: false })

export const ConversationRecordListSchema = Type.Object({
  items: Type.Array(ConversationRecordSchema),
}, { additionalProperties: false })

export const CreateConversationBodySchema = Type.Object({
  session_id: Type.String({ minLength: 1, maxLength: 100 }),
  first_message: Type.String({ minLength: 1, maxLength: 2_000 }),
  snapshot: Type.Record(Type.String(), Type.Unknown()),
}, { additionalProperties: false })

export const ReplaceConversationSnapshotBodySchema = Type.Object({
  revision: Type.Integer({ minimum: 0 }),
  snapshot: Type.Record(Type.String(), Type.Unknown()),
}, { additionalProperties: false })

export type UserInfoDto = Static<typeof UserInfoSchema>
export type PublicRuntimeSettingsDto = Static<typeof PublicRuntimeSettingsSchema>
export type PublicRuntimeSettingsResponseDto = Static<typeof PublicRuntimeSettingsResponseSchema>
export type AuthResponseDto = Static<typeof AuthResponseSchema>
export type NicknameLoginBodyDto = Static<typeof NicknameLoginBodySchema>
export type WechatLoginResponseDto = Static<typeof WechatLoginResponseSchema>
export type WebLoginChallengeCreateDto = Static<typeof WebLoginChallengeCreateSchema>
export type WebLoginChallengeStatusDto = Static<typeof WebLoginChallengeStatusSchema>
export type WebLoginChallengeExchangeDto = Static<typeof WebLoginChallengeExchangeSchema>
export type UserSkinDto = Static<typeof UserSkinSchema>
export type UserLocaleDto = Static<typeof UserLocaleSchema>
export type UserPreferencesDto = Static<typeof UserPreferencesSchema>
export type UserPreferencesPatchDto = Static<typeof UserPreferencesPatchSchema>
export type UserMemoryDto = Static<typeof UserMemorySchema>
export type UserMemoryListDto = Static<typeof UserMemoryListSchema>
export type ChatMessageDto = Static<typeof ChatMessageSchema>
export type CityStayDto = Static<typeof CityStaySchema>
export type ParsedTripDraftDto = Static<typeof ParsedTripDraftSchema>
export type TripParseResponseDto = Static<typeof TripParseResponseSchema>
export type TripConfirmReplyResponseDto = Static<typeof TripConfirmReplyResponseSchema>
export type TripPlanRequestDto = Static<typeof TripPlanRequestSchema>
export type SubmitTripPlanResponseDto = Static<typeof SubmitTripPlanResponseSchema>
export type RetryTripPlanBodyDto = Static<typeof RetryTripPlanBodySchema>
export type TripTaskStageDto = Static<typeof TripTaskStageSchema>
export type TripTaskDetailDto = Static<typeof TripTaskDetailSchema>
export type TripTaskEventDto = Static<typeof TripTaskEventSchema>
export type TripTaskStatusResponseDto = Static<typeof TripTaskStatusResponseSchema>
export type ItemExecutionStatusDto = Static<typeof ItemExecutionStatusSchema>
export type ItemExecutionEntryDto = Static<typeof ItemExecutionEntrySchema>
export type ExecutionMapDto = Static<typeof ExecutionMapSchema>
export type ItemExecutionPatchDto = Static<typeof ItemExecutionPatchSchema>
export type ItemExecutionResponseDto = Static<typeof ItemExecutionResponseSchema>
export type NativeCalendarEventDto = Static<typeof NativeCalendarEventSchema>
export type NativeActionTicketDto = Static<typeof NativeActionTicketSchema>
export type NativeActionDto = Static<typeof NativeActionSchema>
export type TripPlanConversationDto = Static<typeof TripPlanConversationSchema>
export type TripChatEditResponseDto = Static<typeof TripChatEditResponseSchema>
export type BudgetItemTypeDto = Static<typeof BudgetItemTypeSchema>
export type BudgetSummaryDto = Static<typeof BudgetSummarySchema>
export type BudgetLedgerItemDto = Static<typeof BudgetLedgerItemSchema>
export type BudgetLedgerResponseDto = Static<typeof BudgetLedgerResponseSchema>
export type BudgetItemInputDto = Static<typeof BudgetItemInputSchema>
export type TripLocationDto = Static<typeof TripLocationSchema>
export type PoiSearchItemDto = Static<typeof PoiSearchItemSchema>
export type PoiSearchResponseDto = Static<typeof PoiSearchResponseSchema>
export type AttractionMutationInputDto = Static<typeof AttractionMutationInputSchema>
export type ItineraryMutationResponseDto = Static<typeof ItineraryMutationResponseSchema>
export type TripHistoryItemDto = Static<typeof TripHistoryItemSchema>
export type ConversationRecordDto = Static<typeof ConversationRecordSchema>
export type ConversationSessionDetailDto = Static<typeof ConversationSessionDetailSchema>
