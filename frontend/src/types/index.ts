// 类型定义

export interface CityStay {
  city: string
  days: number
}

export interface Location {
  longitude: number
  latitude: number
}

export interface Attraction {
  id?: string
  poi_id?: string
  name: string
  address: string
  location: Location
  visit_duration: number
  description: string
  category?: string
  rating?: number
  image_url?: string
  ticket_price?: number
  reservation_required?: boolean
  reservation_tips?: string
  start_time?: string
  end_time?: string
  time_recommendation_basis?: 'weather' | 'seasonal'
  crowd_recommendation_basis?: 'heuristic'
}

export interface Meal {
  id?: string
  type: 'breakfast' | 'lunch' | 'dinner' | 'snack'
  name: string
  address?: string
  location?: Location
  description?: string
  estimated_cost?: number
  time?: string
  time_recommendation_basis?: 'schedule'
}

export interface Hotel {
  name: string
  address: string
  location?: Location
  price_range: string
  rating: string
  distance: string
  type: string
  estimated_cost?: number
  source?: string
  source_hotel_id?: string
  source_url?: string
  image_url?: string
  price_checked_at?: string
  price_method?: string
  price_status?: 'unavailable' | 'estimated' | 'live'
}

export interface Budget {
  total_attractions: number
  total_hotels: number
  total_meals: number
  total_transportation: number
  total_inter_city_transport?: number
  total_other?: number
  total: number
}

export type BudgetItemType = 'attraction' | 'hotel' | 'meal' | 'transport' | 'other'
export type BudgetAmountBasis = 'group_total' | 'per_person'

export interface BudgetLedgerItem {
  id: string
  type: BudgetItemType
  day_index: number | null
  day_end_index: number | null
  name: string
  // 固定语义：全体出行人的合计金额，是后端持久化与汇总的唯一标准口径。
  amount: number | null
  // 仅说明来源/录入口径，不改变 amount 始终为合计金额的语义。
  amount_basis: BudgetAmountBasis
  traveler_count: number
  per_person_amount: number | null
  calculation_summary: string
  unit_amount: number | null
  room_count: number | null
  nights: number | null
  origin: 'itinerary' | 'user'
  price_source: 'unavailable' | 'estimated' | 'live' | 'user'
  linked_item_id: string
  entity_source: string
  source_url: string
  price_checked_at: string
  note: string
  user_locked: boolean
  deleted: boolean
}

export interface BudgetLedgerResponse {
  plan_id: string
  items: BudgetLedgerItem[]
  totals: Budget
  per_person_totals: Budget
  traveler_count: number
  room_count: number
  pending_count: number
  budget_limit: number | null
  quoted_total: number
  over_budget_amount: number
  pending_buffer: number
  projected_total: number
  projected_over_budget_amount: number
  adjustment_applied: boolean
  adjustment_note: string
}

export interface BudgetItemInput {
  type: BudgetItemType
  day_index: number | null
  name: string
  // 用户录入值；后端按照 amount_basis 解释并换算为合计金额后保存。
  amount: number | null
  amount_basis: BudgetAmountBasis
  note?: string
}

export interface PoiSearchItem {
  id: string
  name: string
  type: string
  address: string
  location: Location
  tel?: string | null
}

export interface ItineraryAttractionInput {
  day_index: number
  poi_id: string
  name: string
  address: string
  location: Location
  visit_duration: number
  description: string
  ticket_price: number
  start_time: string
  reservation_required: boolean
  reservation_tips: string
}

export interface DayPlan {
  date: string
  day_index: number
  city?: string
  is_transfer_day?: boolean
  transfer_info?: string
  transfer_time?: string
  description: string
  transportation: string
  accommodation: string
  hotel?: Hotel
  attractions: Attraction[]
  meals: Meal[]
}

export interface TripBlueprintStage {
  title: string
  cities: string[]
  day_indices: number[]
  theme: string
  rationale: string
  highlights: string[]
  transition: string
}

export interface TripBlueprint {
  title: string
  summary: string
  logic: string
  pace: string
  stages: TripBlueprintStage[]
}

export interface WeatherInfo {
  date: string
  city?: string
  day_weather: string
  night_weather: string
  day_temp: number
  night_temp: number
  wind_direction: string
  wind_power: string
}

export interface TripPlan {
  city: string
  cities?: Array<string | CityStay>
  start_date: string
  end_date: string
  traveler_count?: number
  room_count?: number
  budget_amount?: number | null
  budget_basis?: BudgetAmountBasis
  budget_adjustment_applied?: boolean
  budget_adjustment_note?: string
  days: DayPlan[]
  weather_info: WeatherInfo[]
  overall_suggestions: string
  budget?: Budget
  blueprint?: TripBlueprint
}

export interface ItineraryMutationResponse extends BudgetLedgerResponse {
  plan: TripPlan
}

export interface TripFormData {
  city: string
  cities?: CityStay[]
  start_date: string
  end_date: string
  travel_days: number
  transportation: string
  accommodation: string
  traveler_count: number
  room_count: number
  budget_amount?: number | null
  budget_basis: BudgetAmountBasis
  preferences: string[]
  free_text_input: string
  origin_text?: string
  execution_token: string
  language?: string
  conversation?: ChatMessage[]
  session_id?: string
}

export interface TripPlanResponse {
  success: boolean
  message: string
  plan_id?: string
  data?: TripPlan
}

export interface SharedTripPlanResponse {
  plan_id: string
  status: 'completed'
  result: TripPlanResponse
}

export interface CreateTripShareResponse {
  plan_id: string
  share_code: string
}

export type ShareLoadErrorKind = 'notFound' | 'network'

export interface TripHistoryItem {
  plan_id: string
  task_id: string
  status?: string
  city: string
  start_date: string
  end_date: string
  travel_days: number
  updated_at: string
  overall_suggestions?: string
}

export type ConversationRecordKind = 'conversation' | 'plan'
export type ConversationTitleStatus = 'pending' | 'generated' | 'fallback'
export type ConversationRecordState = 'chatting' | 'generating' | 'planned'

export interface ConversationRecord {
  record_id: string
  kind: ConversationRecordKind
  session_id: string | null
  plan_id: string | null
  task_id: string | null
  title: string
  title_status: ConversationTitleStatus
  state: ConversationRecordState
  revision: number
  status: TripTaskStatus | null
  user_id: string
  city: string
  cities: unknown[]
  start_date: string
  end_date: string
  travel_days: number
  updated_at: string
  overall_suggestions: string
  user_deleted_at: string | null
}

export interface ConversationSessionDetail extends ConversationRecord {
  snapshot: Record<string, unknown>
}

export interface CreateConversationRequest {
  session_id: string
  first_message: string
  snapshot: Record<string, unknown>
}

export interface UpdateConversationRequest {
  revision: number
  snapshot: Record<string, unknown>
}

/** 管理端:全部用户计划列表条目 */
export interface AdminTripItem extends TripHistoryItem {
  user_id?: string
  nickname?: string
}

export interface AdminConversationRecord extends ConversationRecord {
  nickname: string
}

export type AdminSkillAgentId =
  | 'parent-assistant'
  | 'destination-researcher'
  | 'segment-planner'
  | 'summary'
  | 'itinerary-reviewer'
  | 'plan-editor'

export type AdminSkillKind = 'builtin' | 'custom'
export type AdminSkillSource = 'builtin' | 'upload' | 'git'
export type AdminSkillState = 'candidate' | 'enabled' | 'disabled' | 'archived'
export type AdminSkillVersionState = 'candidate' | 'active' | 'superseded' | 'archived'

export interface AdminSkillVersion {
  id: string
  skill_id: string
  version_number: number
  state: AdminSkillVersionState
  content: string
  name: string
  description: string
  sha256: string
  source_commit: string | null
  created_at: string
  activated_at: string | null
}

export interface AdminSkillSummary {
  id: string
  name: string
  description: string
  kind: AdminSkillKind
  source: AdminSkillSource
  state: AdminSkillState
  enabled: boolean
  agent_ids: AdminSkillAgentId[]
  active_version_id: string | null
  candidate_version_id: string | null
  repository_url: string | null
  source_ref: string | null
  source_subdirectory: string | null
  generation: number
  archived_at: string | null
}

export interface AdminSkillDetail extends AdminSkillSummary {
  active_version: AdminSkillVersion | null
  candidate_version: AdminSkillVersion | null
  versions: AdminSkillVersion[]
}

export interface AdminSkillCapabilities {
  git_available: boolean
  private_git_credentials_available: boolean
}

export interface AdminSkillListFilters {
  archived?: boolean
  query?: string
  source?: AdminSkillSource
  state?: AdminSkillState
}

export interface AdminSkillGitInstallRequest {
  repository_url: string
  ref?: string
  subdirectory?: string
}

export interface AdminSkillCandidateRequest {
  content: string
}

export interface AdminSkillConfigurationRequest {
  enabled: boolean
  agent_ids: readonly AdminSkillAgentId[]
}

export interface AdminSkillActivationRequest extends AdminSkillConfigurationRequest {
  candidate_version_id: string
}

export interface AdminSkillListResponse {
  items: AdminSkillSummary[]
  capabilities: AdminSkillCapabilities
}

export interface AdminSkillDetailResponse {
  skill: AdminSkillDetail
}

export type AdminSkillMutationResponse = AdminSkillDetailResponse

export interface AdminSkillCheckUpdateResponse {
  changed: boolean
  skill: AdminSkillDetail
}

export interface AdminError extends Error {
  readonly unauthorized: boolean
  readonly status: number | null
  readonly code: string | null
}

export type TripTaskStatus = 'processing' | 'completed' | 'failed'

export type TripTaskStage =
  | 'submitted'
  | 'initializing'
  | 'attraction_search'
  | 'weather_search'
  | 'hotel_search'
  | 'planning'
  | 'reviewing'
  | 'graph_building'
  | 'completed'
  | 'failed'

export interface TripTaskDetail {
  type: 'thinking' | 'searching' | 'found' | 'planning' | 'tool_call' | 'info'
  title: string
  content?: string
  timestamp?: number
}

export interface TripCheckpointSummary {
  completed_segments: number
  total_segments: number
  last_successful_stage: string
}

export interface TripTaskEvent {
  task_id: string
  plan_id: string
  status: TripTaskStatus
  stage: TripTaskStage
  progress: number
  message: string
  details?: TripTaskDetail[]
  error?: string
  result?: TripPlanResponse
  checkpoint_summary?: TripCheckpointSummary
  request_payload?: Partial<TripFormData>
}

export interface BackendRuntimeSettings {
  vite_amap_web_key: string
  vite_amap_web_js_key: string
  google_maps_api_key: string
  google_maps_proxy: string
  xhs_cookie: string
  openai_api_key: string
  openai_base_url: string
  openai_model: string
  llm_thinking_enabled: boolean
  llm_thinking_visible: boolean
}

export interface RuntimeSettings {
  api_base_url: string
  vite_amap_web_key: string
  vite_amap_web_js_key: string
  google_maps_api_key: string
  google_maps_proxy: string
  xhs_cookie: string
  openai_api_key: string
  openai_base_url: string
  openai_model: string
  llm_thinking_enabled: boolean
  llm_thinking_visible: boolean
}

// ============ AI 行程问答类型 ============

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface TripChatRequest {
  message: string
  trip_plan: object
  history: ChatMessage[]
}

export interface TripChatResponse {
  success: boolean
  reply: string
}

export interface TripChatEditResponse {
  success: boolean
  reply: string
  updated_plan?: TripPlan | null
  changes: string[]
}

export type PanelMessage =
  | { role: 'user'; kind: 'text'; content: string }
  | { role: 'assistant'; kind: 'text'; content: string }
  | { role: 'assistant'; kind: 'typing' }
  | {
      role: 'assistant'
      kind: 'changes'
      content: string
      changes: string[]
      snapshotIndex: number
      undone?: boolean
    }

// ============ 自然语言解析类型 ============

export interface ParsedTripDraft {
  city: string
  cities: CityStay[]
  start_date: string
  end_date: string
  travel_days: number
  transportation: string
  accommodation: string
  traveler_count: number
  room_count: number
  budget_amount: number | null
  budget_basis: BudgetAmountBasis
  preferences: string[]
  free_text_input: string
  origin_text: string
  // 后端 LLM 标记的"用户未明确指定、按默认值填充"的字段:
  // dates / transportation / accommodation / preferences
  inferred_fields?: string[]
  // 后端 LLM 针对未明确部分给出的个性化建议(每条一句话)
  suggestions?: string[]
}

export type TripParseAction = 'plan' | 'clarify' | 'recommend' | 'chat'
export type TripUserEmotion = 'neutral' | 'uncertain' | 'frustrated' | 'excited' | 'anxious'

export interface TripDestinationRecommendation {
  destination: string
  reason: string
  suggested_days: number
}

export interface TripParseApiResponse {
  success: boolean
  action?: TripParseAction
  emotion?: TripUserEmotion
  reply?: string
  follow_up_question?: string
  recommendations?: TripDestinationRecommendation[]
  need_clarify: boolean
  // 后端 LLM 判断需求字段是否完整;仅供展示,绝不代表用户已确认生成
  ready_to_generate?: boolean
  readiness_token?: string
  clarify_question: string
  summary: string
  trip?: ParsedTripDraft | null
}

export type TripConfirmReplyAction = 'confirm' | 'cancel' | 'update' | 'chat' | 'ask_confirmation'

// 对话草稿期间,后端 Agent 对用户回复的决策结果
export interface TripConfirmReplyResponse {
  success: boolean
  action: TripConfirmReplyAction
  confidence: number
  message: string
  ready_to_generate?: boolean
  readiness_token?: string
  trip?: ParsedTripDraft | null
  decision_id?: string
  execution_token?: string
}

// ===== 用户身份(昵称登录) =====
export interface UserInfo {
  user_id: string
  nickname: string
  created_at?: string
  last_login_at?: string
}

export interface UserMemoryItem {
  id: string
  memory: string
  created_at?: string
}

// ===== 行程执行状态(V1.1 今日行程) =====
export type ItemExecutionStatus = 'done' | 'skipped' | 'postponed' | 'pending'

export interface ExecutionEntry {
  status: ItemExecutionStatus
  updated_at?: string
  actual_cost?: number
}

export type ExecutionMap = Record<string, ExecutionEntry>
