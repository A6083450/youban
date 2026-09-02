import type { ConversationRecordDto } from '@youban/contracts'
import { ApiError, apiRequest, getApiBaseUrl } from '@/http/client'

const ADMIN_TOKEN_KEY = 'youban_admin_token'
const ADMIN_PREFIX = '/api/v2/admin'

export type AdminSection = 'settings' | 'skills' | 'trips'
export type AdminSkillAgentId
  = | 'parent-assistant'
    | 'destination-researcher'
    | 'segment-planner'
    | 'summary'
    | 'itinerary-reviewer'
    | 'plan-editor'

export interface AdminRuntimeSettings {
  vite_amap_web_key: string
  vite_amap_web_js_key: string
  openai_api_key: string
  openai_base_url: string
  openai_model: string
  trip_segment_days: number
  trip_segment_concurrency: number
  trip_review_enabled: boolean
  llm_thinking_enabled: boolean
  llm_thinking_visible: boolean
  trip_planner_timeout: number
  trip_duplicate_repair_rounds: number
  pi_parent_session_limit: number
  pi_parent_session_idle_seconds: number
  llm_api_style: 'responses' | 'completions'
  chat_edit_agent: 'pi' | 'simple'
}

export interface AdminConversationRecord extends ConversationRecordDto {
  nickname: string
}

export type AdminSkillSource = 'builtin' | 'upload' | 'git'
export type AdminSkillState = 'candidate' | 'enabled' | 'disabled' | 'archived'

export interface AdminSkillVersion {
  id: string
  skill_id: string
  version_number: number
  state: 'candidate' | 'active' | 'superseded' | 'archived'
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
  kind: 'builtin' | 'custom'
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

function sessionStorageOrNull(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  }
  catch {
    return null
  }
}

export function getAdminToken(): string {
  return sessionStorageOrNull()?.getItem(ADMIN_TOKEN_KEY)?.trim() || ''
}

export function setAdminToken(value: string): void {
  const storage = sessionStorageOrNull()
  if (!storage)
    return
  if (value.trim())
    storage.setItem(ADMIN_TOKEN_KEY, value.trim())
  else
    storage.removeItem(ADMIN_TOKEN_KEY)
}

function adminHeaders(): Record<string, string> {
  const token = getAdminToken()
  return token ? { 'X-Admin-Token': token } : {}
}

function adminRequest<T>(path: string, options: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE', data?: unknown } = {}): Promise<T> {
  return apiRequest<T>(`${ADMIN_PREFIX}${path}`, {
    ...options,
    public: true,
    headers: adminHeaders(),
  })
}

export function adminRecordPath(recordId: string): string {
  return `${ADMIN_PREFIX}/records/${encodeURIComponent(recordId)}`
}

export function adminSkillPath(skillId: string): string {
  return `${ADMIN_PREFIX}/skills/${encodeURIComponent(skillId)}`
}

export async function adminLogin(password: string): Promise<void> {
  await apiRequest(`${ADMIN_PREFIX}/login`, { method: 'POST', data: { password }, public: true })
  setAdminToken(password)
}

export function adminLogout(): void {
  setAdminToken('')
}

export async function getAdminSettings(): Promise<AdminRuntimeSettings> {
  const response = await adminRequest<{ success: true, data: AdminRuntimeSettings }>('/settings')
  return response.data
}

export async function saveAdminSettings(input: AdminRuntimeSettings): Promise<AdminRuntimeSettings> {
  const response = await adminRequest<{ success: true, data: AdminRuntimeSettings }>('/settings', {
    method: 'PUT',
    data: input,
  })
  return response.data
}

export async function getAdminRecords(visibility: 'all' | 'active' | 'user_deleted' = 'all'): Promise<AdminConversationRecord[]> {
  const response = await adminRequest<{ success: true, items: AdminConversationRecord[] }>(
    `/records?visibility=${visibility}&limit=500&offset=0`,
  )
  return response.items
}

export function deleteAdminRecord(recordId: string): Promise<{ success: true, removed_images: number }> {
  return apiRequest(adminRecordPath(recordId), {
    method: 'DELETE',
    public: true,
    headers: adminHeaders(),
  })
}

export async function listAdminSkills(options: {
  query?: string
  source?: AdminSkillSource
  state?: AdminSkillState
  archived?: boolean
} = {}): Promise<{ items: AdminSkillSummary[], capabilities: AdminSkillCapabilities }> {
  const query = new URLSearchParams()
  if (options.query?.trim())
    query.set('query', options.query.trim())
  if (options.source)
    query.set('source', options.source)
  if (options.state)
    query.set('state', options.state)
  if (options.archived)
    query.set('archived', 'true')
  return adminRequest(`/skills${query.size ? `?${query}` : ''}`)
}

export async function getAdminSkill(skillId: string): Promise<AdminSkillDetail> {
  const response = await apiRequest<{ skill: AdminSkillDetail }>(adminSkillPath(skillId), {
    public: true,
    headers: adminHeaders(),
  })
  return response.skill
}

export async function installGitAdminSkill(input: {
  repository_url: string
  ref?: string
  subdirectory?: string
}): Promise<AdminSkillDetail> {
  const response = await adminRequest<{ skill: AdminSkillDetail }>('/skills/git', { method: 'POST', data: input })
  return response.skill
}

export function uploadAdminSkill(filePath: string): Promise<AdminSkillDetail> {
  return new Promise((resolve, reject) => {
    uni.uploadFile({
      url: `${getApiBaseUrl()}${ADMIN_PREFIX}/skills/upload`,
      filePath,
      name: 'file',
      header: adminHeaders(),
      success(response) {
        let payload: unknown = response.data
        try {
          payload = typeof response.data === 'string' ? JSON.parse(response.data) : response.data
        }
        catch {
          reject(new ApiError('服务器返回了无效响应', response.statusCode, response.data))
          return
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new ApiError((payload as { detail?: string })?.detail || '上传技能失败', response.statusCode, payload))
          return
        }
        resolve((payload as { skill: AdminSkillDetail }).skill)
      },
      fail(error) {
        reject(new ApiError(error.errMsg || '上传技能失败', 0, error))
      },
    })
  })
}

async function skillMutation(path: string, method: 'POST' | 'PUT' | 'DELETE', data?: unknown): Promise<AdminSkillDetail> {
  const response = await apiRequest<{ skill: AdminSkillDetail }>(path, {
    method,
    data,
    public: true,
    headers: adminHeaders(),
  })
  return response.skill
}

export function checkAdminSkillUpdate(skillId: string): Promise<{ changed: boolean, skill: AdminSkillDetail }> {
  return apiRequest(`${adminSkillPath(skillId)}/check-update`, {
    method: 'POST',
    data: {},
    public: true,
    headers: adminHeaders(),
  })
}

export function saveAdminSkillCandidate(skillId: string, content: string): Promise<AdminSkillDetail> {
  return skillMutation(`${adminSkillPath(skillId)}/candidate`, 'PUT', { content })
}

export function activateAdminSkill(skillId: string, input: {
  candidate_version_id: string
  enabled: boolean
  agent_ids: AdminSkillAgentId[]
}): Promise<AdminSkillDetail> {
  return skillMutation(`${adminSkillPath(skillId)}/activate`, 'POST', input)
}

export function configureAdminSkill(skillId: string, enabled: boolean, agentIds: AdminSkillAgentId[]): Promise<AdminSkillDetail> {
  return skillMutation(`${adminSkillPath(skillId)}/configuration`, 'PUT', { enabled, agent_ids: agentIds })
}

export function archiveAdminSkill(skillId: string): Promise<AdminSkillDetail> {
  return skillMutation(adminSkillPath(skillId), 'DELETE')
}

export function restoreAdminSkill(skillId: string): Promise<AdminSkillDetail> {
  return skillMutation(`${adminSkillPath(skillId)}/restore`, 'POST', {})
}
