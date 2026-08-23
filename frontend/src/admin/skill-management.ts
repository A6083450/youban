import type {
  AdminError,
  AdminSkillAgentId,
  AdminSkillCapabilities,
  AdminSkillConfigurationRequest,
  AdminSkillDetail,
  AdminSkillGitInstallRequest,
  AdminSkillSource,
  AdminSkillState,
  AdminSkillSummary,
  AdminSkillVersion,
} from '../types'

export interface AdminSkillFilters {
  query?: string
  source?: AdminSkillSource
  state?: AdminSkillState
}

export type AdminSkillAction = 'edit' | 'check-update' | 'archive' | 'restore'
export type AdminSkillInstallSource = 'upload' | 'git'

export const ADMIN_SKILL_AGENT_IDS: readonly AdminSkillAgentId[] = [
  'parent-assistant',
  'destination-researcher',
  'segment-planner',
  'summary',
  'itinerary-reviewer',
  'plan-editor',
]

export interface AdminSkillCandidateEditorState {
  editorContent: string
  activeVersionId: string | null
  dirty: boolean
}

export interface AdminSkillDraftState {
  skillId: string
  baselineContent: string
  editorContent: string
  contentDirty: boolean
  baselineEnabled: boolean
  enabled: boolean
  baselineAgentIds: AdminSkillAgentId[]
  agentIds: AdminSkillAgentId[]
  configurationDirty: boolean
}

export type AdminSkillDraftMergeOperation = 'candidate' | 'update' | 'configure' | 'activate'

export interface AdminSkillMutationEvent {
  originSkillId: string
  skill: AdminSkillDetail
  messageKey: string
}

export type AdminSkillFormError =
  | 'zip_required'
  | 'zip_single_file'
  | 'zip_extension'
  | 'invalid_git_url'
  | 'invalid_git_ref'
  | 'invalid_git_subdirectory'

export const adminSkillSourceKey = (skill: Pick<AdminSkillSummary, 'source'>): AdminSkillSource =>
  skill.source

export function adminSkillStateKey(
  skill: Pick<AdminSkillSummary, 'archived_at' | 'candidate_version_id' | 'enabled' | 'state'>,
): AdminSkillState {
  if (skill.archived_at !== null || skill.state === 'archived') return 'archived'
  if (skill.candidate_version_id !== null || skill.state === 'candidate') return 'candidate'
  return skill.enabled ? 'enabled' : 'disabled'
}

export function filterAdminSkills(
  skills: readonly AdminSkillSummary[],
  filters: Readonly<AdminSkillFilters> = {},
): AdminSkillSummary[] {
  const query = filters.query?.trim().toLowerCase() ?? ''
  return skills.filter((skill) => {
    if (query && !`${skill.name}\n${skill.description}`.toLowerCase().includes(query)) return false
    if (filters.source && adminSkillSourceKey(skill) !== filters.source) return false
    if (filters.state && adminSkillStateKey(skill) !== filters.state) return false
    return true
  })
}

export function sortAdminSkillVersions(versions: readonly AdminSkillVersion[]): AdminSkillVersion[] {
  return versions
    .map((version, index) => ({ version, index }))
    .sort((left, right) =>
      left.version.version_number - right.version.version_number || left.index - right.index)
    .map(({ version }) => version)
}

export function skillActions(skill: AdminSkillSummary): AdminSkillAction[] {
  if (skill.kind === 'builtin') return []
  if (adminSkillStateKey(skill) === 'archived') return ['restore']

  const actions: AdminSkillAction[] = ['edit']
  if (skill.source === 'git') actions.push('check-update')
  if (!skill.enabled) actions.push('archive')
  return actions
}

export function beginCandidateEdit(detail: AdminSkillDetail): AdminSkillCandidateEditorState {
  return {
    editorContent: detail.candidate_version?.content ?? detail.active_version?.content ?? '',
    activeVersionId: detail.active_version?.id ?? null,
    dirty: false,
  }
}

const normalizeSkillAgentIds = (agentIds: readonly AdminSkillAgentId[]): AdminSkillAgentId[] =>
  ADMIN_SKILL_AGENT_IDS.filter((agentId) => agentIds.includes(agentId))

const sameSkillAgentIds = (
  left: readonly AdminSkillAgentId[],
  right: readonly AdminSkillAgentId[],
): boolean => {
  const normalizedLeft = normalizeSkillAgentIds(left)
  const normalizedRight = normalizeSkillAgentIds(right)
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((agentId, index) => agentId === normalizedRight[index])
}

export function createAdminSkillDraft(detail: AdminSkillDetail): AdminSkillDraftState {
  const content = detail.candidate_version?.content ?? detail.active_version?.content ?? ''
  const agentIds = normalizeSkillAgentIds(detail.agent_ids)
  return {
    skillId: detail.id,
    baselineContent: content,
    editorContent: content,
    contentDirty: false,
    baselineEnabled: detail.enabled,
    enabled: detail.enabled,
    baselineAgentIds: [...agentIds],
    agentIds: [...agentIds],
    configurationDirty: false,
  }
}

export function withAdminSkillDraftContent(
  draft: Readonly<AdminSkillDraftState>,
  editorContent: string,
): AdminSkillDraftState {
  return {
    ...draft,
    baselineAgentIds: [...draft.baselineAgentIds],
    agentIds: [...draft.agentIds],
    editorContent,
    contentDirty: editorContent !== draft.baselineContent,
  }
}

export function withAdminSkillDraftConfiguration(
  draft: Readonly<AdminSkillDraftState>,
  enabled: boolean,
  agentIds: readonly AdminSkillAgentId[],
): AdminSkillDraftState {
  const normalizedAgentIds = normalizeSkillAgentIds(agentIds)
  return {
    ...draft,
    baselineAgentIds: [...draft.baselineAgentIds],
    enabled,
    agentIds: normalizedAgentIds,
    configurationDirty: enabled !== draft.baselineEnabled
      || !sameSkillAgentIds(normalizedAgentIds, draft.baselineAgentIds),
  }
}

export function mergeAdminSkillDraft(
  draft: Readonly<AdminSkillDraftState>,
  detail: AdminSkillDetail,
  operation: AdminSkillDraftMergeOperation,
): AdminSkillDraftState {
  const serverDraft = createAdminSkillDraft(detail)
  if (draft.skillId !== detail.id || operation === 'configure' || operation === 'activate') {
    return serverDraft
  }
  return withAdminSkillDraftConfiguration(serverDraft, draft.enabled, draft.agentIds)
}

export const hasAdminSkillDraftChanges = (draft: Readonly<AdminSkillDraftState>): boolean =>
  draft.contentDirty || draft.configurationDirty

export const shouldApplySkillMutation = (
  selectedSkillId: string | null,
  originSkillId: string,
  responseSkillId: string,
): boolean => selectedSkillId === originSkillId && responseSkillId === originSkillId

export function validateSkillArchive(skill: AdminSkillSummary): string | null {
  if (skill.kind === 'builtin') return 'builtin_skill_immutable'
  if (skill.enabled) return 'skill_must_be_disabled'
  return null
}

export function setSkillAssignment(
  current: readonly AdminSkillAgentId[],
  agentId: AdminSkillAgentId,
  assigned: boolean,
): AdminSkillAgentId[] {
  if (assigned) return current.includes(agentId) ? [...current] : [...current, agentId]
  return current.filter((item) => item !== agentId)
}

export function validateZipSelection(files: readonly File[]): AdminSkillFormError | null {
  if (files.length === 0) return 'zip_required'
  if (files.length !== 1) return 'zip_single_file'
  return files[0]?.name.toLowerCase().endsWith('.zip') ? null : 'zip_extension'
}

export function validateGitInstallInput(
  input: Readonly<AdminSkillGitInstallRequest>,
): AdminSkillFormError | null {
  let repository: URL
  try {
    repository = new URL(input.repository_url.trim())
  } catch {
    return 'invalid_git_url'
  }
  if (repository.protocol !== 'https:' || !repository.hostname || repository.username || repository.password) {
    return 'invalid_git_url'
  }
  if (input.ref && (!/^[\w./+@{}-]+$/.test(input.ref.trim()) || input.ref.includes('..'))) {
    return 'invalid_git_ref'
  }
  const subdirectory = input.subdirectory?.trim()
  if (subdirectory && (
    subdirectory.startsWith('/')
    || subdirectory.split('/').some((segment) => segment === '..' || segment === '.')
  )) return 'invalid_git_subdirectory'
  return null
}

export const STABLE_ADMIN_SKILL_ERROR_CODES = [
  'skill_not_found',
  'skill_name_conflict',
  'builtin_skill_immutable',
  'skill_must_be_disabled',
  'skill_not_archived',
  'skill_archived',
  'skill_not_git_managed',
  'skill_service_closed',
  'skill_state_changed',
  'skill_catalog_refresh_failed',
  'package_commit_failed',
  'package_compensation_failed',
  'candidate_write_failed',
  'skill_version_conflict',
  'skill_activation_failed',
  'skill_configuration_failed',
  'skill_archive_failed',
  'skill_restore_failed',
  'invalid_skill_encoding',
  'invalid_skill_frontmatter',
  'invalid_skill_name',
  'skill_name_mismatch',
  'invalid_skill_description',
  'skill_document_too_large',
  'invalid_zip_archive',
  'invalid_zip_entry',
  'invalid_skill_package',
  'skill_package_too_large',
  'invalid_git_url',
  'invalid_git_host',
  'invalid_git_ref',
  'invalid_git_subdirectory',
  'invalid_git_commit',
  'invalid_git_package',
  'git_unavailable',
  'git_timeout',
  'git_output_too_large',
  'git_acquisition_too_large',
  'git_redirect',
  'git_failed',
  'invalid_archive',
  'invalid_assignment',
  'invalid_skill_document',
  'invalid_source',
  'invalid_request',
  'internal_error',
] as const

const STABLE_ADMIN_SKILL_ERRORS = new Set<string>(STABLE_ADMIN_SKILL_ERROR_CODES)

export function localizeAdminSkillError(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as Pick<AdminError, 'code'>).code ?? '')
    : ''
  return STABLE_ADMIN_SKILL_ERRORS.has(code)
    ? `admin.skills.errors.${code}`
    : 'admin.skills.errors.fallback'
}

export function skillInstallSources(
  capabilities: Readonly<AdminSkillCapabilities>,
): AdminSkillInstallSource[] {
  return capabilities.git_available ? ['upload', 'git'] : ['upload']
}

export function toSkillConfiguration(
  skill: Pick<AdminSkillSummary, 'enabled' | 'agent_ids'>,
  enabled = skill.enabled,
): AdminSkillConfigurationRequest & { agent_ids: AdminSkillSummary['agent_ids'] } {
  return {
    enabled,
    agent_ids: [...skill.agent_ids],
  }
}
