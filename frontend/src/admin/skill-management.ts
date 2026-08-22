import type {
  AdminSkillCapabilities,
  AdminSkillConfigurationRequest,
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
