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
}

export interface Budget {
  total_attractions: number
  total_hotels: number
  total_meals: number
  total_transportation: number
  total_inter_city_transport?: number
  total: number
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
  cities?: string[]
  start_date: string
  end_date: string
  days: DayPlan[]
  weather_info: WeatherInfo[]
  overall_suggestions: string
  budget?: Budget
  blueprint?: TripBlueprint
}

export interface TripFormData {
  city: string
  cities?: CityStay[]
  start_date: string
  end_date: string
  travel_days: number
  transportation: string
  accommodation: string
  preferences: string[]
  free_text_input: string
  origin_text?: string
  execution_token: string
  language?: string
  conversation?: ChatMessage[]
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

/** 管理端:全部用户计划列表条目 */
export interface AdminTripItem extends TripHistoryItem {
  user_id?: string
  nickname?: string
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
  clarify_question: string
  summary: string
  trip?: ParsedTripDraft | null
}

export type TripConfirmReplyAction = 'confirm' | 'cancel' | 'update' | 'chat' | 'ask_confirmation'

// 待确认卡片期间,后端 Agent 对用户回复的决策结果
export interface TripConfirmReplyResponse {
  success: boolean
  action: TripConfirmReplyAction
  confidence: number
  message: string
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
