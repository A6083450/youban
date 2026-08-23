import axios from 'axios'
import type {
  AdminError,
  AdminSkillActivationRequest,
  AdminSkillCheckUpdateResponse,
  AdminSkillCandidateRequest,
  AdminSkillConfigurationRequest,
  AdminSkillDetailResponse,
  AdminSkillGitInstallRequest,
  AdminSkillListFilters,
  AdminSkillListResponse,
  AdminSkillMutationResponse,
  AdminConversationRecord,
  AdminTripItem,
  BackendRuntimeSettings,
  BudgetItemInput,
  BudgetLedgerResponse,
  ChatMessage,
  ConversationRecord,
  ConversationSessionDetail,
  CreateConversationRequest,
  CreateTripShareResponse,
  ExecutionEntry,
  ItemExecutionStatus,
  ItineraryAttractionInput,
  ItineraryMutationResponse,
  ParsedTripDraft,
  PoiSearchItem,
  RuntimeSettings,
  SharedTripPlanResponse,
  ShareLoadErrorKind,
  TripChatEditResponse,
  TripConfirmReplyResponse,
  TripFormData,
  TripHistoryItem,
  TripParseApiResponse,
  TripPlan,
  TripPlanResponse,
  TripTaskEvent,
  UpdateConversationRequest,
  UserInfo,
  UserMemoryItem,
} from '@/types'
import {
  adminRecordDeletePath,
  type AdminRecordPageResult,
  type AdminRecordVisibility,
} from '@/admin/conversation-records'
import { i18n } from '@/i18n'
import { completeTripPlanResponse } from '@/utils/planConversation.js'

const ENV_API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''
const ENV_AMAP_WEB_JS_KEY = import.meta.env.VITE_AMAP_WEB_JS_KEY ?? ''
const RUNTIME_API_BASE_STORAGE_KEY = 'tripstar.runtime.api_base_url'
const RUNTIME_AMAP_WEB_JS_KEY_STORAGE_KEY = 'tripstar.runtime.amap_web_js_key'
const RUNTIME_GOOGLE_MAPS_API_KEY_STORAGE_KEY = 'tripstar.runtime.google_maps_api_key'
const ADMIN_TOKEN_STORAGE_KEY = 'tripstar.admin.token'
const USER_STORAGE_KEY = 'tripstar.user'
const DEFAULT_RUNTIME_BACKEND_SETTINGS: BackendRuntimeSettings = {
  vite_amap_web_key: '',
  vite_amap_web_js_key: '',
  google_maps_api_key: '',
  google_maps_proxy: '',
  xhs_cookie: '',
  openai_api_key: '',
  openai_base_url: '',
  openai_model: '',
}

export const RUNTIME_SETTINGS_UPDATED_EVENT = 'tripstar:runtime-settings-updated'
const t = i18n.global.t

export const getStoredUser = (): UserInfo | null => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(USER_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && parsed.user_id ? (parsed as UserInfo) : null
  } catch {
    return null
  }
}

export const setStoredUser = (user: UserInfo | null): void => {
  if (typeof window === 'undefined') return
  if (user) window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user))
  else window.localStorage.removeItem(USER_STORAGE_KEY)
}

const normalizeBaseUrl = (value: string | null | undefined): string => {
  const text = String(value ?? '').trim()
  return text.replace(/\/+$/, '')
}

const normalizeText = (value: unknown): string => String(value ?? '').trim()

const resolveDefaultApiBaseUrl = (): string => {
  const fromEnv = normalizeBaseUrl(ENV_API_BASE_URL)
  if (fromEnv) return fromEnv
  // 同源部署（Docker / 云端）：API 与前端在同一 origin 下
  if (typeof window !== 'undefined' && window.location) {
    return normalizeBaseUrl(window.location.origin) || ''
  }
  // 仅本地开发 fallback
  return 'http://localhost:8000'
}

const DEFAULT_API_BASE_URL = resolveDefaultApiBaseUrl()
const DEFAULT_AMAP_WEB_JS_KEY = normalizeText(ENV_AMAP_WEB_JS_KEY)

export interface SubmitTripPlanResponse {
  task_id: string
  plan_id: string
  status: 'processing'
  ws_url: string
  message: string
}

interface GenerateTripPlanOptions {
  onTaskCreated?: (task: SubmitTripPlanResponse) => void
  onTaskEvent?: (event: TripTaskEvent) => void
}

interface RuntimeSettingsApiResponse {
  success: boolean
  message?: string
  data?: Partial<BackendRuntimeSettings>
}

interface TripHistoryResponse {
  items?: TripHistoryItem[]
}

interface ConversationRecordListResponse {
  items?: ConversationRecord[]
}

export const getRuntimeApiBaseUrl = (): string => {
  if (typeof window === 'undefined') {
    return DEFAULT_API_BASE_URL
  }
  const saved = normalizeBaseUrl(window.localStorage.getItem(RUNTIME_API_BASE_STORAGE_KEY))
  return saved || DEFAULT_API_BASE_URL
}

export const setRuntimeApiBaseUrl = (value: string): string => {
  const normalized = normalizeBaseUrl(value) || DEFAULT_API_BASE_URL
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(RUNTIME_API_BASE_STORAGE_KEY, normalized)
  }
  return normalized
}

export const getRuntimeMapJsKey = (): string => {
  if (typeof window === 'undefined') {
    return DEFAULT_AMAP_WEB_JS_KEY
  }
  const saved = normalizeText(window.localStorage.getItem(RUNTIME_AMAP_WEB_JS_KEY_STORAGE_KEY))
  return saved || DEFAULT_AMAP_WEB_JS_KEY
}

export const setRuntimeMapJsKey = (value: string): string => {
  const normalized = normalizeText(value)
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(RUNTIME_AMAP_WEB_JS_KEY_STORAGE_KEY, normalized)
  }
  return normalized
}

export const getRuntimeGoogleMapsApiKey = (): string => {
  if (typeof window === 'undefined') return ''
  return normalizeText(window.localStorage.getItem(RUNTIME_GOOGLE_MAPS_API_KEY_STORAGE_KEY))
}

export const setRuntimeGoogleMapsApiKey = (value: string): string => {
  const normalized = normalizeText(value)
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(RUNTIME_GOOGLE_MAPS_API_KEY_STORAGE_KEY, normalized)
  }
  return normalized
}

const getWsBaseUrl = (): string => getRuntimeApiBaseUrl().replace(/^http/i, 'ws').replace(/\/+$/, '')

const normalizeBackendRuntimeSettings = (
  data?: Partial<BackendRuntimeSettings>
): BackendRuntimeSettings => ({
  vite_amap_web_key: normalizeText(data?.vite_amap_web_key ?? DEFAULT_RUNTIME_BACKEND_SETTINGS.vite_amap_web_key),
  vite_amap_web_js_key: normalizeText(
    data?.vite_amap_web_js_key ?? DEFAULT_RUNTIME_BACKEND_SETTINGS.vite_amap_web_js_key
  ),
  google_maps_api_key: normalizeText(
    data?.google_maps_api_key ?? DEFAULT_RUNTIME_BACKEND_SETTINGS.google_maps_api_key
  ),
  google_maps_proxy: normalizeText(
    data?.google_maps_proxy ?? DEFAULT_RUNTIME_BACKEND_SETTINGS.google_maps_proxy
  ),
  xhs_cookie: normalizeText(data?.xhs_cookie ?? DEFAULT_RUNTIME_BACKEND_SETTINGS.xhs_cookie),
  openai_api_key: normalizeText(data?.openai_api_key ?? DEFAULT_RUNTIME_BACKEND_SETTINGS.openai_api_key),
  openai_base_url:
    normalizeText(data?.openai_base_url ?? DEFAULT_RUNTIME_BACKEND_SETTINGS.openai_base_url) ||
    DEFAULT_RUNTIME_BACKEND_SETTINGS.openai_base_url,
  openai_model:
    normalizeText(data?.openai_model ?? DEFAULT_RUNTIME_BACKEND_SETTINGS.openai_model) ||
    DEFAULT_RUNTIME_BACKEND_SETTINGS.openai_model,
})

const emitRuntimeSettingsUpdated = () => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(RUNTIME_SETTINGS_UPDATED_EVENT))
}

const apiClient = axios.create({
  timeout: 0, // 无超时限制，等待后端返回结果
  headers: {
    'Content-Type': 'application/json'
  }
})

// 请求拦截器
apiClient.interceptors.request.use(
  (config) => {
    config.baseURL = getRuntimeApiBaseUrl()
    if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
      config.headers.delete('Content-Type')
    }
    const user = getStoredUser()
    if (user?.user_id && !config.headers.has('X-User-Id')) {
      config.headers['X-User-Id'] = user.user_id
    }
    const adminToken = typeof window === 'undefined'
      ? ''
      : normalizeText(window.sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY))
    if (adminToken && !config.headers.has('X-Admin-Token')) {
      config.headers.set('X-Admin-Token', adminToken)
    }
    console.log('发送请求:', config.method?.toUpperCase(), config.url)
    return config
  },
  (error) => {
    console.error('请求错误:', error)
    return Promise.reject(error)
  }
)

// 响应拦截器
apiClient.interceptors.response.use(
  (response) => {
    console.log('收到响应:', response.status, response.config.url)
    return response
  },
  (error) => {
    console.error('响应错误:', error.response?.status, error.message)
    return Promise.reject(error)
  }
)

export async function getBackendRuntimeSettings(): Promise<BackendRuntimeSettings> {
  try {
    const response = await apiClient.get<RuntimeSettingsApiResponse>('/api/settings')
    return normalizeBackendRuntimeSettings(response.data?.data)
  } catch (error: any) {
    console.error('读取运行时配置失败:', error)
    throw new Error(error.response?.data?.detail || error.message || '读取配置失败')
  }
}

// ===== 后台管理（密码存于数据目录 admin_password.txt，后端每次请求重读文件校验） =====

export const getAdminToken = (): string => {
  if (typeof window === 'undefined') return ''
  return normalizeText(window.sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY))
}

export const setAdminToken = (value: string): void => {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, normalizeText(value))
}

export const clearAdminToken = (): void => {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY)
}

export const hasAdminSession = (): boolean => Boolean(getAdminToken())

const adminAuthHeaders = () => ({ 'X-Admin-Token': getAdminToken() })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const toAdminError = (error: unknown, fallback: string): AdminError => {
  const response = isRecord(error) && isRecord(error.response) ? error.response : null
  const data = response && isRecord(response.data) ? response.data : null
  const status = response && typeof response.status === 'number' && Number.isInteger(response.status)
    ? response.status
    : null
  const detail = data && typeof data.detail === 'string' && data.detail.trim()
    ? data.detail
    : fallback
  const code = data && typeof data.code === 'string' && data.code.trim()
    ? data.code
    : null
  return Object.assign(new Error(detail), {
    unauthorized: status === 401,
    status,
    code,
  })
}

export const isAdminAuthError = (error: unknown): error is AdminError =>
  Boolean(isRecord(error) && error.unauthorized === true)

export async function adminLogin(password: string): Promise<void> {
  try {
    await apiClient.post('/api/admin/login', { password })
    setAdminToken(password)
  } catch (error: any) {
    console.error('后台登录失败:', error)
    throw toAdminError(error, '登录失败')
  }
}

export async function getAdminRuntimeSettings(): Promise<RuntimeSettings> {
  let backend: BackendRuntimeSettings
  try {
    const response = await apiClient.get<RuntimeSettingsApiResponse>('/api/admin/settings', {
      headers: adminAuthHeaders(),
    })
    backend = normalizeBackendRuntimeSettings(response.data?.data)
  } catch (error: any) {
    console.error('读取后台配置失败:', error)
    throw toAdminError(error, '读取配置失败')
  }

  const apiBaseUrl = getRuntimeApiBaseUrl()
  const mapJsKey = getRuntimeMapJsKey() || backend.vite_amap_web_js_key

  // 同步 Google Maps API Key 到 localStorage 供前端地图组件读取
  if (backend.google_maps_api_key) {
    setRuntimeGoogleMapsApiKey(backend.google_maps_api_key)
  }

  return {
    api_base_url: apiBaseUrl,
    ...backend,
    vite_amap_web_js_key: mapJsKey,
  }
}

export async function saveAdminRuntimeSettings(settings: RuntimeSettings): Promise<RuntimeSettings> {
  const previousApiBaseUrl = getRuntimeApiBaseUrl()
  const targetApiBaseUrl = normalizeBaseUrl(settings.api_base_url) || previousApiBaseUrl
  const updates: Partial<BackendRuntimeSettings> = {
    vite_amap_web_key: settings.vite_amap_web_key,
    vite_amap_web_js_key: settings.vite_amap_web_js_key,
    google_maps_api_key: settings.google_maps_api_key,
    google_maps_proxy: settings.google_maps_proxy,
    xhs_cookie: settings.xhs_cookie,
    openai_api_key: settings.openai_api_key,
    openai_base_url: settings.openai_base_url,
    openai_model: settings.openai_model,
  }
  setRuntimeApiBaseUrl(targetApiBaseUrl)

  let backend: BackendRuntimeSettings
  try {
    const response = await apiClient.put<RuntimeSettingsApiResponse>('/api/admin/settings', updates, {
      headers: adminAuthHeaders(),
    })
    backend = normalizeBackendRuntimeSettings(response.data?.data)
  } catch (error: any) {
    setRuntimeApiBaseUrl(previousApiBaseUrl)
    console.error('保存后台配置失败:', error)
    throw toAdminError(error, '保存配置失败')
  }

  const apiBaseUrl = setRuntimeApiBaseUrl(targetApiBaseUrl)
  const mapJsKey = setRuntimeMapJsKey(settings.vite_amap_web_js_key || backend.vite_amap_web_js_key)
  setRuntimeGoogleMapsApiKey(settings.google_maps_api_key || backend.google_maps_api_key)

  emitRuntimeSettingsUpdated()

  return {
    api_base_url: apiBaseUrl,
    ...backend,
    vite_amap_web_js_key: mapJsKey || backend.vite_amap_web_js_key,
  }
}

export async function adminGetAllTrips(limit = 100): Promise<AdminTripItem[]> {
  try {
    const response = await apiClient.get<{ success: boolean; items: AdminTripItem[] }>(
      '/api/admin/trips',
      { headers: adminAuthHeaders(), params: { limit } },
    )
    return response.data.items ?? []
  } catch (error: any) {
    console.error('读取全部用户计划失败:', error)
    throw toAdminError(error, '读取计划列表失败')
  }
}

export async function adminDeleteTrip(taskId: string): Promise<void> {
  try {
    await apiClient.delete(`/api/admin/trips/${encodeURIComponent(taskId)}`, {
      headers: adminAuthHeaders(),
    })
  } catch (error: any) {
    console.error('后台删除计划失败:', error)
    throw toAdminError(error, '删除计划失败')
  }
}

export async function adminGetConversationRecords(
  visibility: AdminRecordVisibility = 'all',
  page: Readonly<{ limit?: number; offset?: number }> = {},
): Promise<AdminRecordPageResult> {
  try {
    const limit = page.limit ?? 500
    const offset = page.offset ?? 0
    const response = await apiClient.get<{
      success: boolean
      items: AdminConversationRecord[]
      total: number
    }>(
      '/api/admin/records',
      { headers: adminAuthHeaders(), params: { visibility, limit, offset } },
    )
    return { items: response.data.items ?? [], total: response.data.total }
  } catch (error: any) {
    console.error('读取后台对话记录失败:', error)
    throw toAdminError(error, '读取记录列表失败')
  }
}

export async function adminPermanentlyDeleteRecord(recordId: string): Promise<void> {
  try {
    await apiClient.delete(adminRecordDeletePath(recordId), {
      headers: adminAuthHeaders(),
    })
  } catch (error: any) {
    console.error('后台永久删除记录失败:', error)
    throw toAdminError(error, '永久删除记录失败')
  }
}

const adminSkillPath = (skillId: string): string =>
  `/api/admin/skills/${encodeURIComponent(skillId)}`

const optionalText = (value: string | undefined): string | undefined => {
  const normalized = value?.trim()
  return normalized || undefined
}

const configurationBody = (
  configuration: Readonly<AdminSkillConfigurationRequest>,
): { enabled: boolean; agent_ids: AdminSkillConfigurationRequest['agent_ids'][number][] } => ({
  enabled: configuration.enabled,
  agent_ids: [...configuration.agent_ids],
})

async function adminSkillRequest<T>(operation: () => Promise<T>, fallback: string): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw toAdminError(error, fallback)
  }
}

export async function adminListSkills(
  filters: Readonly<AdminSkillListFilters> = {},
): Promise<AdminSkillListResponse> {
  const search = new URLSearchParams()
  const query = optionalText(filters.query)
  if (query) search.set('query', query)
  if (filters.source) search.set('source', filters.source)
  if (filters.state) search.set('state', filters.state)
  if (filters.archived) search.set('archived', 'true')
  const suffix = search.size ? `?${search.toString()}` : ''
  return adminSkillRequest(async () => {
    const response = await apiClient.get<AdminSkillListResponse>(`/api/admin/skills${suffix}`)
    return response.data
  }, '读取技能列表失败')
}

export async function adminGetSkill(skillId: string): Promise<AdminSkillDetailResponse> {
  return adminSkillRequest(async () => {
    const response = await apiClient.get<AdminSkillDetailResponse>(adminSkillPath(skillId))
    return response.data
  }, '读取技能详情失败')
}

export async function adminUploadSkill(file: File): Promise<AdminSkillMutationResponse> {
  const form = new FormData()
  form.set('file', file)
  return adminSkillRequest(async () => {
    const response = await apiClient.post<AdminSkillMutationResponse>('/api/admin/skills/upload', form)
    return response.data
  }, '上传技能失败')
}

export async function adminInstallGitSkill(
  input: Readonly<AdminSkillGitInstallRequest>,
): Promise<AdminSkillMutationResponse> {
  const ref = optionalText(input.ref)
  const subdirectory = optionalText(input.subdirectory)
  const body: AdminSkillGitInstallRequest = {
    repository_url: input.repository_url.trim(),
    ...(ref ? { ref } : {}),
    ...(subdirectory ? { subdirectory } : {}),
  }
  return adminSkillRequest(async () => {
    const response = await apiClient.post<AdminSkillMutationResponse>('/api/admin/skills/git', body)
    return response.data
  }, '安装 Git 技能失败')
}

export async function adminCheckSkillUpdate(skillId: string): Promise<AdminSkillCheckUpdateResponse> {
  return adminSkillRequest(async () => {
    const response = await apiClient.post<AdminSkillCheckUpdateResponse>(`${adminSkillPath(skillId)}/check-update`)
    return response.data
  }, '检查技能更新失败')
}

export async function adminSaveSkillCandidate(
  skillId: string,
  content: string,
): Promise<AdminSkillMutationResponse> {
  const body: AdminSkillCandidateRequest = { content }
  return adminSkillRequest(async () => {
    const response = await apiClient.put<AdminSkillMutationResponse>(`${adminSkillPath(skillId)}/candidate`, body)
    return response.data
  }, '保存候选版本失败')
}

export async function adminActivateSkill(
  skillId: string,
  configuration: Readonly<AdminSkillActivationRequest>,
): Promise<AdminSkillMutationResponse> {
  return adminSkillRequest(async () => {
    const response = await apiClient.post<AdminSkillMutationResponse>(
      `${adminSkillPath(skillId)}/activate`,
      {
        candidate_version_id: configuration.candidate_version_id,
        ...configurationBody(configuration),
      },
    )
    return response.data
  }, '激活技能失败')
}

export async function adminConfigureSkill(
  skillId: string,
  configuration: Readonly<AdminSkillConfigurationRequest>,
): Promise<AdminSkillMutationResponse> {
  return adminSkillRequest(async () => {
    const response = await apiClient.put<AdminSkillMutationResponse>(
      `${adminSkillPath(skillId)}/configuration`,
      configurationBody(configuration),
    )
    return response.data
  }, '保存技能配置失败')
}

export async function adminArchiveSkill(skillId: string): Promise<AdminSkillMutationResponse> {
  return adminSkillRequest(async () => {
    const response = await apiClient.delete<AdminSkillMutationResponse>(adminSkillPath(skillId))
    return response.data
  }, '归档技能失败')
}

export async function adminRestoreSkill(skillId: string): Promise<AdminSkillMutationResponse> {
  return adminSkillRequest(async () => {
    const response = await apiClient.post<AdminSkillMutationResponse>(`${adminSkillPath(skillId)}/restore`)
    return response.data
  }, '恢复技能失败')
}

/**
 * 提交旅行规划任务（立即返回 task_id）
 */
export async function submitTripPlan(formData: TripFormData): Promise<SubmitTripPlanResponse> {
  try {
    const response = await apiClient.post('/api/trip/plan', formData)
    return response.data
  } catch (error: any) {
    console.error('提交旅行计划失败:', error)
    throw new Error(error.response?.data?.detail || error.message || t('api.submitTripPlanFailed'))
  }
}

export async function retryTripPlan(
  taskId: string,
  restartAll = false,
): Promise<SubmitTripPlanResponse> {
  try {
    const response = await apiClient.post(
      `/api/trip/plan/${encodeURIComponent(taskId)}/retry`,
      { restart_all: restartAll },
    )
    return response.data
  } catch (error: any) {
    console.error('重试旅行计划失败:', error)
    throw new Error(error.response?.data?.detail || error.message || t('api.submitTripPlanFailed'))
  }
}

/**
 * 轮询任务状态
 */
export async function pollTaskStatus(taskId: string): Promise<any> {
  try {
    const response = await apiClient.get(`/api/trip/status/${taskId}`)
    return response.data
  } catch (error: any) {
    console.error('查询任务状态失败:', error)
    throw new Error(error.response?.data?.detail || error.message || t('api.queryTaskStatusFailed'))
  }
}

export class SharedTripPlanError extends Error {
  constructor(public readonly kind: ShareLoadErrorKind) {
    super(kind)
    this.name = 'SharedTripPlanError'
  }
}

export class TripShareCreationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TripShareCreationError'
  }
}

export async function createTripShare(planId: string): Promise<CreateTripShareResponse> {
  try {
    const response = await apiClient.post<CreateTripShareResponse>(
      `/api/trip/share/${encodeURIComponent(planId)}`,
    )
    return response.data
  } catch (error: unknown) {
    const detail = axios.isAxiosError<{ detail?: string }>(error)
      ? error.response?.data?.detail || error.message
      : ''
    throw new TripShareCreationError(detail || t('result.share.createFailed'))
  }
}

export async function getSharedTripPlan(shareCode: string): Promise<SharedTripPlanResponse> {
  try {
    const response = await apiClient.get<SharedTripPlanResponse>(
      `/api/trip/share/${encodeURIComponent(shareCode)}`,
    )
    return response.data
  } catch (error: unknown) {
    const kind: ShareLoadErrorKind = axios.isAxiosError(error) && error.response?.status === 404
      ? 'notFound'
      : 'network'
    throw new SharedTripPlanError(kind)
  }
}

export async function getTripHistory(limit = 8): Promise<TripHistoryItem[]> {
  try {
    const response = await apiClient.get<TripHistoryResponse>('/api/trip/history', {
      params: { limit },
    })
    return Array.isArray(response.data?.items) ? response.data.items : []
  } catch (error: any) {
    console.error('查询历史计划失败:', error)
    throw new Error(error.response?.data?.detail || error.message || t('api.queryTaskStatusFailed'))
  }
}

export async function getConversationRecords(limit = 50): Promise<ConversationRecord[]> {
  try {
    const response = await apiClient.get<ConversationRecordListResponse>('/api/conversations', {
      params: { limit },
    })
    return Array.isArray(response.data?.items) ? response.data.items : []
  } catch (error: any) {
    console.error('读取对话记录失败:', error)
    throw new Error(error.response?.data?.detail || error.message || '读取对话记录失败')
  }
}

export async function createConversation(
  input: CreateConversationRequest,
): Promise<ConversationRecord> {
  try {
    const response = await apiClient.post<ConversationRecord>('/api/conversations', input)
    return response.data
  } catch (error: any) {
    console.error('创建对话记录失败:', error)
    throw new Error(error.response?.data?.detail || error.message || '创建对话记录失败')
  }
}

export async function getConversationSession(
  sessionId: string,
  ownerId?: string,
  signal?: AbortSignal,
): Promise<ConversationSessionDetail> {
  try {
    const response = await apiClient.get<ConversationSessionDetail>(
      `/api/conversations/${encodeURIComponent(sessionId)}`,
      {
        ...(ownerId ? { headers: { 'X-User-Id': ownerId } } : {}),
        ...(signal ? { signal } : {}),
      },
    )
    return response.data
  } catch (error: any) {
    console.error('读取对话记录详情失败:', error)
    if (error.response?.status === 404) throw new ConversationSessionNotFoundError()
    throw new Error(error.response?.data?.detail || error.message || '读取对话记录详情失败')
  }
}

export class ConversationSessionRevisionConflictError extends Error {
  constructor() {
    super('对话记录已在其他页面更新')
    this.name = 'ConversationSessionRevisionConflictError'
  }
}

export class ConversationSessionNotFoundError extends Error {
  constructor() {
    super('对话记录不存在')
    this.name = 'ConversationSessionNotFoundError'
  }
}

export async function updateConversationSession(
  sessionId: string,
  input: UpdateConversationRequest,
  ownerId?: string,
  signal?: AbortSignal,
): Promise<ConversationSessionDetail> {
  try {
    const response = await apiClient.put<ConversationSessionDetail>(
      `/api/conversations/${encodeURIComponent(sessionId)}`,
      input,
      {
        ...(ownerId ? { headers: { 'X-User-Id': ownerId } } : {}),
        ...(signal ? { signal } : {}),
      },
    )
    return response.data
  } catch (error: any) {
    console.error('更新对话记录失败:', error)
    if (error.response?.status === 409) throw new ConversationSessionRevisionConflictError()
    if (error.response?.status === 404) throw new ConversationSessionNotFoundError()
    throw new Error(error.response?.data?.detail || error.message || '更新对话记录失败')
  }
}

export async function deleteConversation(sessionId: string): Promise<void> {
  try {
    await apiClient.delete(`/api/conversations/${encodeURIComponent(sessionId)}`)
  } catch (error: any) {
    console.error('删除对话记录失败:', error)
    throw new Error(error.response?.data?.detail || error.message || '删除对话记录失败')
  }
}

export async function getPlanConversation(planId: string): Promise<ChatMessage[]> {
  try {
    const response = await apiClient.get<{ plan_id: string; messages?: ChatMessage[] }>(
      `/api/trip/plan/${encodeURIComponent(planId)}/conversation`
    )
    return Array.isArray(response.data?.messages) ? response.data.messages : []
  } catch (error: any) {
    console.error('读取计划对话失败:', error)
    throw new Error(error.response?.data?.detail || error.message || '读取计划对话失败')
  }
}

/**
 * 自然语言行程解析
 */
export async function parseTripText(
  text: string,
  language: string,
  history: ChatMessage[] = []
): Promise<TripParseApiResponse> {
  try {
    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const response = await apiClient.post<TripParseApiResponse>('/api/trip/parse', {
      text,
      language,
      today: todayStr,
      history: history.slice(-10),
    })
    return response.data
  } catch (error: any) {
    console.error('解析旅行描述失败:', error)
    throw new Error(error.response?.data?.detail || error.message || t('api.parseTripTextFailed'))
  }
}

/**
 * 待确认卡片期间的对话式意图判断:把当前草稿和用户回复交给后端 LLM,
 * 返回 confirm / cancel / update / chat 动作及(可选)更新后的草稿
 */
export async function confirmTripReply(
  text: string,
  draft: ParsedTripDraft,
  language: string,
  history: ChatMessage[] = [],
  readinessToken = ''
): Promise<TripConfirmReplyResponse> {
  try {
    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const response = await apiClient.post<TripConfirmReplyResponse>('/api/trip/confirm-reply', {
      text,
      draft,
      language,
      today: todayStr,
      history: history.slice(-10),
      readiness_token: readinessToken,
    })
    return response.data
  } catch (error: any) {
    console.error('行程确认回复判断失败:', error)
    throw new Error(error.response?.data?.detail || error.message || t('api.parseTripTextFailed'))
  }
}

// ===== 对话流式(SSE 打字机) =====

interface ChatStreamCallbacks<T> {
  onDelta?: (text: string) => void
  onFinal?: (payload: T) => void
  onError?: (message: string) => void
  signal?: AbortSignal
}

const todayString = (): string => {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}

/**
 * 通用 SSE POST:用 fetch + ReadableStream 逐块读取后端的
 * `data: {"type":"delta"|"final"|"error",...}` 事件流,直到 `data: [DONE]`。
 * axios 不支持流,故用原生 fetch;手动带上 X-User-Id。
 */
async function postSSE<T>(
  path: string,
  body: unknown,
  cb: ChatStreamCallbacks<T>
): Promise<void> {
  const user = getStoredUser()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (user?.user_id) headers['X-User-Id'] = user.user_id

  const res = await fetch(`${getRuntimeApiBaseUrl()}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: cb.signal,
  })
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, sep).trim()
      buffer = buffer.slice(sep + 2)
      if (!chunk.startsWith('data:')) continue
      const data = chunk.slice(5).trim()
      if (data === '[DONE]') return
      try {
        const evt = JSON.parse(data)
        if (evt.type === 'delta') cb.onDelta?.(String(evt.text ?? ''))
        else if (evt.type === 'final') cb.onFinal?.(evt.payload as T)
        else if (evt.type === 'error') cb.onError?.(String(evt.message ?? ''))
      } catch {
        /* 半截/非法事件行,跳过 */
      }
    }
  }
}

/**
 * 自然语言行程解析(流式):游伴回复逐字流出,结束回调完整结构化结果
 */
export function parseTripTextStream(
  text: string,
  language: string,
  history: ChatMessage[],
  cb: ChatStreamCallbacks<TripParseApiResponse>
): Promise<void> {
  return postSSE('/api/trip/parse/stream', {
    text,
    language,
    today: todayString(),
    history: history.slice(-10),
  }, cb)
}

/**
 * 待确认卡片期间的对话式意图判断(流式)
 */
export function confirmTripReplyStream(
  text: string,
  draft: ParsedTripDraft,
  language: string,
  history: ChatMessage[],
  readinessToken: string,
  cb: ChatStreamCallbacks<TripConfirmReplyResponse>
): Promise<void> {
  return postSSE('/api/trip/confirm-reply/stream', {
    text,
    draft,
    language,
    today: todayString(),
    history: history.slice(-10),
    readiness_token: readinessToken,
  }, cb)
}

/**
 * 更新行程项执行状态(完成/跳过/延后/恢复);失败抛错由调用方回滚乐观更新
 */
export async function updateItemStatus(
  planId: string,
  itemId: string,
  status: ItemExecutionStatus,
  actualCost?: number,
): Promise<ExecutionEntry | null> {
  try {
    const response = await apiClient.patch(
      `/api/trip/plan/${encodeURIComponent(planId)}/items/${encodeURIComponent(itemId)}/status`,
      actualCost === undefined ? { status } : { status, actual_cost: actualCost },
    )
    return response.data?.execution ?? null
  } catch (error: any) {
    throw new Error(error.response?.data?.detail || error.message || 'update item status failed')
  }
}

export async function getBudgetItems(planId: string): Promise<BudgetLedgerResponse> {
  const response = await apiClient.get(
    `/api/trip/plan/${encodeURIComponent(planId)}/budget-items`,
  )
  return response.data as BudgetLedgerResponse
}

export async function createBudgetItem(
  planId: string,
  payload: BudgetItemInput,
): Promise<BudgetLedgerResponse> {
  const response = await apiClient.post(
    `/api/trip/plan/${encodeURIComponent(planId)}/budget-items`,
    payload,
  )
  return response.data as BudgetLedgerResponse
}

export async function updateBudgetItem(
  planId: string,
  itemId: string,
  payload: Partial<BudgetItemInput> & { deleted?: boolean },
): Promise<BudgetLedgerResponse> {
  const response = await apiClient.patch(
    `/api/trip/plan/${encodeURIComponent(planId)}/budget-items/${encodeURIComponent(itemId)}`,
    payload,
  )
  return response.data as BudgetLedgerResponse
}

export async function deleteBudgetItem(
  planId: string,
  itemId: string,
): Promise<BudgetLedgerResponse> {
  const response = await apiClient.delete(
    `/api/trip/plan/${encodeURIComponent(planId)}/budget-items/${encodeURIComponent(itemId)}`,
  )
  return response.data as BudgetLedgerResponse
}

export async function searchAttractionPois(
  keywords: string,
  city: string,
): Promise<PoiSearchItem[]> {
  const response = await apiClient.get('/api/poi/search', {
    params: { keywords, city, types: '110000' },
  })
  return Array.isArray(response.data?.data) ? response.data.data as PoiSearchItem[] : []
}

export async function createItineraryAttraction(
  planId: string,
  payload: ItineraryAttractionInput,
): Promise<ItineraryMutationResponse> {
  const response = await apiClient.post(
    `/api/trip/plan/${encodeURIComponent(planId)}/attractions`,
    payload,
  )
  return response.data as ItineraryMutationResponse
}

export async function updateItineraryAttraction(
  planId: string,
  attractionId: string,
  payload: ItineraryAttractionInput,
): Promise<ItineraryMutationResponse> {
  const response = await apiClient.put(
    `/api/trip/plan/${encodeURIComponent(planId)}/attractions/${encodeURIComponent(attractionId)}`,
    payload,
  )
  return response.data as ItineraryMutationResponse
}

export async function deleteItineraryAttraction(
  planId: string,
  attractionId: string,
): Promise<ItineraryMutationResponse> {
  const response = await apiClient.delete(
    `/api/trip/plan/${encodeURIComponent(planId)}/attractions/${encodeURIComponent(attractionId)}`,
  )
  return response.data as ItineraryMutationResponse
}

/**
 * 删除一个旅行计划(后端进行中的任务会返回 409)
 */
export async function deleteTripPlan(taskId: string): Promise<void> {
  try {
    await apiClient.delete(`/api/trip/plan/${encodeURIComponent(taskId)}`)
  } catch (error: any) {
    console.error('删除旅行计划失败:', error)
    throw new Error(error.response?.data?.detail || error.message || t('api.deletePlanFailed'))
  }
}

/**
 * 通过 WebSocket 订阅任务直至完成。后端会先推送当前快照，
 * 因此页面刷新后凭 task_id 调用本函数即可恢复进度。
 */
export function watchTripTask(
  taskId: string,
  options?: GenerateTripPlanOptions,
  wsPath?: string
): Promise<TripPlanResponse> {
  const rawUrl = wsPath || `/api/trip/ws/${taskId}`
  const baseWsUrl = rawUrl.startsWith('ws://') || rawUrl.startsWith('wss://')
    ? rawUrl
    : `${getWsBaseUrl()}${rawUrl}`
  const wsUrl = new URL(baseWsUrl, window.location.href)
  if (wsUrl.protocol === 'http:') wsUrl.protocol = 'ws:'
  if (wsUrl.protocol === 'https:') wsUrl.protocol = 'wss:'
  const userId = getStoredUser()?.user_id
  if (userId) wsUrl.searchParams.set('user_id', userId)
  const adminToken = getAdminToken()
  if (adminToken) wsUrl.searchParams.set('admin_token', adminToken)

  return new Promise((resolve, reject) => {
    let settled = false
    const socket = new WebSocket(wsUrl.toString())

    const safeResolve = (value: TripPlanResponse) => {
      if (settled) return
      settled = true
      socket.close()
      resolve(value)
    }

    const safeReject = (error: unknown) => {
      if (settled) return
      settled = true
      socket.close()
      reject(error)
    }

    socket.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data) as TripTaskEvent
        options?.onTaskEvent?.(event)

        if (event.status === 'completed') {
          if (!event.result) {
            safeReject(new Error(t('api.generateTripPlanFailed')))
            return
          }
          safeResolve(completeTripPlanResponse(event.result, event.plan_id, taskId))
          return
        }

        if (event.status === 'failed') {
          safeReject(new Error(event.error || event.message || t('api.generateTripPlanFailed')))
        }
      } catch (err) {
        safeReject(err)
      }
    }

    socket.onerror = () => {
      safeReject(new Error(t('api.generateTripPlanFailed')))
    }

    socket.onclose = () => {
      if (!settled) {
        safeReject(new Error(t('api.generateTripPlanFailed')))
      }
    }
  })
}

/**
 * 生成旅行计划：提交任务后订阅 WebSocket 直至完成
 */
export async function generateTripPlan(
  formData: TripFormData,
  options?: GenerateTripPlanOptions
): Promise<TripPlanResponse> {
  const task = await submitTripPlan(formData)
  options?.onTaskCreated?.(task)
  return watchTripTask(task.task_id, options, task.ws_url)
}

/**
 * 健康检查
 */
export async function healthCheck(): Promise<any> {
  try {
    const response = await apiClient.get('/health')
    return response.data
  } catch (error: any) {
    console.error('健康检查失败:', error)
    throw new Error(error.message || t('api.healthCheckFailed'))
  }
}

/**
 * Agent 式行程对话(问答 + 修改计划)
 */
export async function chatEditPlan(
  message: string,
  tripPlan: TripPlan,
  history: ChatMessage[],
  planId?: string,
): Promise<TripChatEditResponse> {
  try {
    const response = await apiClient.post<TripChatEditResponse>('/api/chat/edit', {
      message,
      trip_plan: tripPlan,
      history,
      plan_id: planId || undefined,
    })
    return response.data
  } catch (error: any) {
    console.error('行程修改对话失败:', error)
    throw new Error(error.response?.data?.detail || error.message || t('api.chatEditFailed'))
  }
}

// ===== 用户身份(昵称即登录) =====

export async function authLogin(nickname: string): Promise<UserInfo> {
  try {
    const response = await apiClient.post<{ success: boolean; user: UserInfo }>(
      '/api/auth/login', { nickname },
    )
    return response.data.user
  } catch (error: any) {
    throw new Error(error.response?.data?.detail || error.message || t('login.failed'))
  }
}

export async function authMe(): Promise<UserInfo | null> {
  try {
    const response = await apiClient.get<{ success: boolean; user: UserInfo }>('/api/auth/me')
    return response.data.user
  } catch (error: any) {
    if (error.response?.status === 404) return null
    // 网络异常时不强制登出,保留本地会话
    return getStoredUser()
  }
}

export async function getUserMemories(): Promise<UserMemoryItem[]> {
  try {
    const response = await apiClient.get<{ success: boolean; items: UserMemoryItem[] }>(
      '/api/auth/memories',
    )
    return response.data.items ?? []
  } catch {
    return []
  }
}

export async function deleteUserMemory(memoryId: string): Promise<void> {
  await apiClient.delete(`/api/auth/memories/${encodeURIComponent(memoryId)}`)
}

export default apiClient
