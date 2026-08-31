<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiError } from '@/http/client'
import {
  activateAdminSkill,
  archiveAdminSkill,
  checkAdminSkillUpdate,
  configureAdminSkill,
  getAdminSkill,
  installGitAdminSkill,
  listAdminSkills,
  restoreAdminSkill,
  saveAdminSkillCandidate,
  uploadAdminSkill,
} from '@/services/admin'
import type {
  AdminSkillAgentId,
  AdminSkillCapabilities,
  AdminSkillDetail,
  AdminSkillSource,
  AdminSkillState,
  AdminSkillSummary,
} from '@/services/admin'

const emit = defineEmits<{ unauthorized: [] }>()
const { t } = useI18n()
const skills = ref<AdminSkillSummary[]>([])
const capabilities = ref<AdminSkillCapabilities>({ git_available: false, private_git_credentials_available: false })
const selected = ref<AdminSkillDetail | null>(null)
const loading = ref(false)
const detailLoading = ref(false)
const saving = ref(false)
const query = ref('')
const source = ref<'all' | AdminSkillSource>('all')
const state = ref<'all' | AdminSkillState>('all')
const archived = ref(false)
const draft = ref('')
const enabled = ref(false)
const assignedAgents = ref<AdminSkillAgentId[]>([])
const installOpen = ref(false)
const repositoryUrl = ref('')
const repositoryRef = ref('')
const repositorySubdirectory = ref('')
const sourceOptions = computed(() => [
  { value: 'all' as const, label: t('admin.skills.filters.allSources') },
  ...(['builtin', 'upload', 'git'] as const).map(value => ({ value, label: t(`admin.skills.sources.${value}`) })),
])
const stateOptions = computed(() => [
  { value: 'all' as const, label: t('admin.skills.filters.allStates') },
  ...(['candidate', 'enabled', 'disabled', 'archived'] as const).map(value => ({ value, label: t(`admin.skills.states.${value}`) })),
])
const agents: Array<{ id: AdminSkillAgentId, label: string }> = [
  { id: 'parent-assistant', label: 'Parent assistant' },
  { id: 'destination-researcher', label: 'Destination researcher' },
  { id: 'segment-planner', label: 'Segment planner' },
  { id: 'summary', label: 'Summary' },
  { id: 'itinerary-reviewer', label: 'Itinerary reviewer' },
  { id: 'plan-editor', label: 'Plan editor' },
]

function handleError(error: unknown, fallback: string): void {
  if (error instanceof ApiError && error.status === 401) {
    emit('unauthorized')
    return
  }
  uni.showToast({ title: error instanceof Error ? error.message : fallback, icon: 'none' })
}

function applyDetail(skill: AdminSkillDetail): void {
  selected.value = skill
  draft.value = skill.candidate_version?.content || skill.active_version?.content || ''
  enabled.value = skill.enabled
  assignedAgents.value = [...skill.agent_ids]
  const index = skills.value.findIndex(item => item.id === skill.id)
  if (index >= 0)
    skills.value[index] = skill
  else
    skills.value.push(skill)
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const result = await listAdminSkills({
      query: query.value,
      source: source.value === 'all' ? undefined : source.value,
      state: state.value === 'all' ? undefined : state.value,
      archived: archived.value,
    })
    skills.value = result.items
    capabilities.value = result.capabilities
    if (selected.value && !skills.value.some(item => item.id === selected.value?.id))
      selected.value = null
  }
  catch (error) {
    handleError(error, t('admin.skills.list.loadFailed'))
  }
  finally {
    loading.value = false
  }
}

async function selectSkill(skillId: string): Promise<void> {
  detailLoading.value = true
  try {
    applyDetail(await getAdminSkill(skillId))
  }
  catch (error) {
    handleError(error, t('admin.skills.detail.loadFailed'))
  }
  finally {
    detailLoading.value = false
  }
}

function changeSource(event: { detail: { value: number } }): void {
  source.value = sourceOptions.value[Number(event.detail.value)]?.value || 'all'
  void load()
}

function changeState(event: { detail: { value: number } }): void {
  state.value = stateOptions.value[Number(event.detail.value)]?.value || 'all'
  void load()
}

function toggleAgent(agentId: AdminSkillAgentId): void {
  assignedAgents.value = assignedAgents.value.includes(agentId)
    ? assignedAgents.value.filter(id => id !== agentId)
    : [...assignedAgents.value, agentId]
}

async function saveCandidate(): Promise<void> {
  if (!selected.value || !draft.value.trim() || saving.value)
    return
  saving.value = true
  try {
    applyDetail(await saveAdminSkillCandidate(selected.value.id, draft.value))
    uni.showToast({ title: t('admin.skills.messages.candidateSaved'), icon: 'success' })
  }
  catch (error) {
    handleError(error, t('admin.skills.errors.candidate_write_failed'))
  }
  finally {
    saving.value = false
  }
}

async function saveConfiguration(): Promise<void> {
  if (!selected.value || saving.value)
    return
  saving.value = true
  try {
    applyDetail(await configureAdminSkill(selected.value.id, enabled.value, assignedAgents.value))
    uni.showToast({ title: t('admin.skills.messages.configurationSaved'), icon: 'success' })
  }
  catch (error) {
    handleError(error, t('admin.skills.errors.skill_configuration_failed'))
  }
  finally {
    saving.value = false
  }
}

async function activate(): Promise<void> {
  const skill = selected.value
  if (!skill?.candidate_version_id || saving.value)
    return
  saving.value = true
  try {
    applyDetail(await activateAdminSkill(skill.id, {
      candidate_version_id: skill.candidate_version_id,
      enabled: enabled.value,
      agent_ids: assignedAgents.value,
    }))
    uni.showToast({ title: t('admin.skills.messages.activated'), icon: 'success' })
  }
  catch (error) {
    handleError(error, t('admin.skills.errors.skill_activation_failed'))
  }
  finally {
    saving.value = false
  }
}

async function checkUpdate(): Promise<void> {
  if (!selected.value || saving.value)
    return
  saving.value = true
  try {
    const result = await checkAdminSkillUpdate(selected.value.id)
    applyDetail(result.skill)
    uni.showToast({ title: result.changed ? t('admin.skills.messages.updateAvailable') : t('admin.skills.messages.noUpdate'), icon: 'none' })
  }
  catch (error) {
    handleError(error, t('admin.skills.errors.git_failed'))
  }
  finally {
    saving.value = false
  }
}

async function archiveOrRestore(): Promise<void> {
  const skill = selected.value
  if (!skill || saving.value)
    return
  saving.value = true
  try {
    applyDetail(skill.state === 'archived' ? await restoreAdminSkill(skill.id) : await archiveAdminSkill(skill.id))
    await load()
  }
  catch (error) {
    handleError(error, t('admin.skills.errors.internal_error'))
  }
  finally {
    saving.value = false
  }
}

async function installGit(): Promise<void> {
  if (!repositoryUrl.value.trim() || saving.value)
    return
  saving.value = true
  try {
    const skill = await installGitAdminSkill({
      repository_url: repositoryUrl.value.trim(),
      ...(repositoryRef.value.trim() ? { ref: repositoryRef.value.trim() } : {}),
      ...(repositorySubdirectory.value.trim() ? { subdirectory: repositorySubdirectory.value.trim() } : {}),
    })
    installOpen.value = false
    await load()
    await selectSkill(skill.id)
  }
  catch (error) {
    handleError(error, t('admin.skills.errors.git_failed'))
  }
  finally {
    saving.value = false
  }
}

function chooseUpload(): void {
  uni.chooseFile({
    count: 1,
    extension: ['zip'],
    success: async (result) => {
      const filePath = result.tempFilePaths[0]
      if (!filePath)
        return
      saving.value = true
      try {
        const skill = await uploadAdminSkill(filePath)
        await load()
        await selectSkill(skill.id)
      }
      catch (error) {
        handleError(error, t('admin.skills.errors.invalid_archive'))
      }
      finally {
        saving.value = false
      }
    },
  })
}

onMounted(() => void load())
</script>

<template>
  <section class="skills-panel">
    <view class="panel-heading">
      <view><text class="panel-eyebrow">SKILLS</text><text class="panel-title">{{ t('admin.skills.title') }}</text></view><view class="heading-actions">
        <button :disabled="saving" @click="chooseUpload">
          <wd-icon name="upload" size="16px" />ZIP
        </button><button :disabled="!capabilities.git_available" @click="installOpen = true">
          <wd-icon name="add" size="16px" />Git
        </button>
      </view>
    </view>
    <view class="skills-toolbar">
      <input v-model="query" :placeholder="t('admin.skills.filters.searchPlaceholder')" @confirm="load"><picker :range="sourceOptions" range-key="label" @change="changeSource">
        <view>{{ sourceOptions.find(item => item.value === source)?.label }}</view>
      </picker><picker :range="stateOptions" range-key="label" @change="changeState">
        <view>{{ stateOptions.find(item => item.value === state)?.label }}</view>
      </picker><label><checkbox :checked="archived" color="#c46b48" @click="archived = !archived; load()" />{{ t('admin.skills.filters.showArchived') }}</label><button :title="t('admin.skills.actions.refresh')" @click="load">
        <wd-icon name="refresh" size="16px" />
      </button>
    </view>
    <view class="skills-layout">
      <aside class="skills-list">
        <view v-if="loading" class="panel-state">
          {{ t('admin.skills.list.loading') }}
        </view>
        <view v-else-if="!skills.length" class="panel-state">
          {{ t('admin.skills.list.emptyTitle') }}
        </view>
        <button v-for="skill in skills" v-else :key="skill.id" :class="{ active: selected?.id === skill.id }" @click="selectSkill(skill.id)">
          <view><strong>{{ skill.name }}</strong><text :data-state="skill.state">{{ t(`admin.skills.states.${skill.state}`) }}</text></view><text>{{ skill.description }}</text><small>{{ t(`admin.skills.sources.${skill.source}`) }} · {{ t('admin.skills.list.assignedCount', { count: skill.agent_ids.length }) }}</small>
        </button>
      </aside>
      <view class="skill-detail">
        <view v-if="detailLoading" class="panel-state">
          {{ t('admin.skills.detail.loading') }}
        </view>
        <view v-else-if="!selected" class="panel-state">
          {{ t('admin.skills.detail.noSelectionHint') }}
        </view>
        <template v-else>
          <view class="detail-heading">
            <view><text class="panel-eyebrow">{{ selected.source.toUpperCase() }}</text><text class="detail-title">{{ selected.name }}</text><text>{{ selected.description }}</text></view><button :disabled="saving || (selected.state !== 'archived' && selected.enabled)" @click="archiveOrRestore">
              {{ selected.state === 'archived' ? t('admin.skills.actions.restore') : t('admin.skills.actions.archive') }}
            </button>
          </view>
          <view class="detail-section">
            <text class="section-label">{{ t('admin.skills.detail.configurationTitle') }}</text><label class="enabled-control"><switch :checked="enabled" color="#c46b48" @change="enabled = $event.detail.value" />{{ t('admin.skills.detail.enabledLabel') }}</label><view class="agent-grid">
              <button v-for="agent in agents" :key="agent.id" :class="{ active: assignedAgents.includes(agent.id) }" @click="toggleAgent(agent.id)">
                {{ agent.label }}
              </button>
            </view><button class="primary-command" :disabled="saving" @click="saveConfiguration">
              {{ t('admin.skills.actions.saveConfiguration') }}
            </button>
          </view>
          <view class="detail-section">
            <view class="section-heading">
              <text class="section-label">SKILL.md</text><text>v{{ selected.candidate_version?.version_number || selected.active_version?.version_number || 0 }}</text>
            </view><textarea v-model="draft" :maxlength="262144" /><view class="editor-actions">
              <button v-if="selected.source === 'git'" :disabled="saving" @click="checkUpdate">
                {{ t('admin.skills.actions.checkUpdate') }}
              </button><button :disabled="saving || !draft.trim()" @click="saveCandidate">
                {{ t('admin.skills.actions.saveCandidate') }}
              </button><button class="primary-command" :disabled="saving || !selected.candidate_version_id" @click="activate">
                {{ t('admin.skills.actions.activate') }}
              </button>
            </view>
          </view>
          <view class="version-list">
            <text class="section-label">{{ t('admin.skills.detail.versionsTitle') }}</text><view v-for="version in selected.versions" :key="version.id">
              <strong>v{{ version.version_number }}</strong><text>{{ version.state }} · {{ version.created_at.replace('T', ' ').slice(0, 16) }}</text>
            </view>
          </view>
        </template>
      </view>
    </view>
    <view v-if="installOpen" class="modal-layer">
      <view class="modal-mask" @click="installOpen = false" /><view class="install-dialog">
        <text class="detail-title">{{ t('admin.skills.install.title') }}</text><label><text>{{ t('admin.skills.install.repositoryLabel') }}</text><input v-model="repositoryUrl" placeholder="https://github.com/owner/repository.git"></label><label><text>{{ t('admin.skills.install.refLabel') }}</text><input v-model="repositoryRef"></label><label><text>{{ t('admin.skills.install.subdirectoryLabel') }}</text><input v-model="repositorySubdirectory"></label><view class="editor-actions">
          <button @click="installOpen = false">
            {{ t('common.cancel') }}
          </button><button class="primary-command" :disabled="saving || !repositoryUrl.trim()" @click="installGit">
            {{ t('admin.skills.install.submit') }}
          </button>
        </view>
      </view>
    </view>
  </section>
</template>

<style scoped>
.panel-heading,
.detail-heading,
.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.panel-heading {
  margin-bottom: 16px;
}
.panel-heading > view:first-child,
.detail-heading > view {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.panel-eyebrow,
.section-label {
  color: var(--accent-strong);
  font-size: 10px;
  font-weight: 800;
}
.panel-title {
  font-size: 22px;
  font-weight: 750;
}
.heading-actions,
.editor-actions {
  display: flex;
  align-items: center;
  gap: 7px;
}
.heading-actions button,
.skills-toolbar button,
.skills-list button,
.detail-heading button,
.agent-grid button,
.primary-command,
.editor-actions button {
  box-sizing: border-box;
  margin: 0;
}
.heading-actions button::after,
.skills-toolbar button::after,
.skills-list button::after,
.detail-heading button::after,
.agent-grid button::after,
.primary-command::after,
.editor-actions button::after {
  display: none;
}
.heading-actions button,
.editor-actions button,
.detail-heading button {
  display: flex;
  min-height: 34px;
  padding: 7px 10px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--surface-elevated);
  align-items: center;
  gap: 4px;
  color: var(--text-primary);
  font-size: 11px;
}
.skills-toolbar {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) 135px 135px auto 36px;
  gap: 7px;
  margin-bottom: 14px;
}
.skills-toolbar > input,
.skills-toolbar picker > view {
  box-sizing: border-box;
  width: 100%;
  min-height: 38px;
  padding: 9px 11px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--surface-elevated);
  font-size: 12px;
}
.skills-toolbar label {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--text-secondary);
  font-size: 11px;
}
.skills-toolbar button {
  display: grid;
  width: 36px;
  padding: 0;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--surface-elevated);
  place-items: center;
}
.skills-layout {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  min-height: 600px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  overflow: hidden;
}
.skills-list {
  display: flex;
  overflow-y: auto;
  border-right: 1px solid var(--border-subtle);
  background: var(--surface-page);
  flex-direction: column;
}
.skills-list > button {
  display: flex;
  padding: 13px;
  border: 0;
  border-bottom: 1px solid var(--border-subtle);
  background: transparent;
  text-align: left;
  flex-direction: column;
  gap: 5px;
}
.skills-list > button.active {
  background: var(--surface-elevated);
  box-shadow: inset 3px 0 var(--accent-primary);
}
.skills-list button > view {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.skills-list strong {
  color: var(--text-primary);
  font-size: 13px;
}
.skills-list button > view text {
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--surface-soft);
  color: var(--accent-strong);
  font-size: 9px;
}
.skills-list button > text,
.skills-list small {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.panel-state {
  display: grid;
  min-height: 220px;
  padding: 20px;
  color: var(--text-secondary);
  font-size: 12px;
  place-items: center;
  text-align: center;
}
.skill-detail {
  min-width: 0;
  padding: 20px;
}
.detail-heading {
  padding-bottom: 18px;
  border-bottom: 1px solid var(--border-subtle);
}
.detail-title {
  font-size: 19px;
  font-weight: 750;
}
.detail-heading > view > text:last-child {
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 12px;
}
.detail-section,
.version-list {
  display: flex;
  padding: 19px 0;
  border-bottom: 1px solid var(--border-subtle);
  flex-direction: column;
  gap: 12px;
}
.enabled-control {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--text-secondary);
  font-size: 12px;
}
.agent-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 7px;
}
.agent-grid button {
  min-height: 34px;
  padding: 7px;
  border: 1px solid var(--border-subtle);
  border-radius: 5px;
  background: var(--surface-elevated);
  color: var(--text-secondary);
  font-size: 10px;
}
.agent-grid button.active {
  border-color: var(--accent-primary);
  background: color-mix(in srgb, var(--accent-primary) 7%, var(--surface-elevated));
  color: var(--accent-strong);
}
.primary-command {
  align-self: flex-start;
  min-height: 35px;
  padding: 7px 12px;
  border: 0;
  border-radius: 6px;
  background: var(--accent-primary) !important;
  color: #fff !important;
  font-size: 11px;
}
.detail-section textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 300px;
  padding: 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: #252422;
  color: #f7f4ef;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.6;
}
.editor-actions {
  justify-content: flex-end;
}
.version-list > view {
  display: flex;
  justify-content: space-between;
  color: var(--text-secondary);
  font-size: 11px;
}
.modal-layer,
.modal-mask {
  position: fixed;
  z-index: 160;
  inset: 0;
}
.modal-mask {
  background: rgba(38, 31, 26, 0.42);
}
.install-dialog {
  position: absolute;
  z-index: 161;
  top: 50%;
  left: 50%;
  display: flex;
  box-sizing: border-box;
  width: min(520px, calc(100vw - 28px));
  padding: 20px;
  border-radius: 8px;
  background: var(--surface-elevated);
  transform: translate(-50%, -50%);
  flex-direction: column;
  gap: 14px;
}
.install-dialog label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 11px;
}
.install-dialog input {
  box-sizing: border-box;
  min-height: 40px;
  padding: 9px 11px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--surface-page);
  color: var(--text-primary);
}
@media (max-width: 850px) {
  .skills-layout {
    grid-template-columns: 1fr;
  }
  .skills-list {
    max-height: 280px;
    border-right: 0;
    border-bottom: 1px solid var(--border-subtle);
  }
  .skills-toolbar {
    grid-template-columns: 1fr 1fr;
  }
  .skills-toolbar > input {
    grid-column: 1/-1;
  }
  .agent-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
