<template>
  <section class="admin-skills-panel" aria-labelledby="admin-skills-title">
    <header class="skills-header">
      <h1 id="admin-skills-title">{{ t('admin.skills.title') }}</h1>
      <a-button type="primary" size="large" @click="requestInstall">
        <PlusOutlined aria-hidden="true" />
        {{ t('admin.skills.install.action') }}
      </a-button>
    </header>
    <div v-if="liveStatus" class="panel-notice" role="status">{{ liveStatus }}</div>

    <div class="skills-toolbar" :aria-label="t('admin.skills.filters.label')">
      <a-input
        v-model:value="query"
        allow-clear
        :placeholder="t('admin.skills.filters.searchPlaceholder')"
        :aria-label="t('admin.skills.filters.searchLabel')"
      >
        <template #prefix><SearchOutlined aria-hidden="true" /></template>
      </a-input>
      <a-select
        v-model:value="sourceFilter"
        :aria-label="t('admin.skills.filters.sourceLabel')"
        :options="sourceOptions"
      />
      <a-select
        v-model:value="stateFilter"
        :aria-label="t('admin.skills.filters.stateLabel')"
        :options="stateOptions"
      />
      <label class="archived-toggle">
        <input v-model="includeArchived" type="checkbox" :disabled="loadingList" @change="loadSkills">
        <span>{{ t('admin.skills.filters.showArchived') }}</span>
      </label>
      <a-button :loading="loadingList" :aria-label="t('admin.skills.actions.refresh')" @click="loadSkills">
        <ReloadOutlined aria-hidden="true" />
        <span>{{ t('admin.skills.actions.refresh') }}</span>
      </a-button>
    </div>

    <div
      class="skills-work-surface"
      :class="{ 'has-selection': Boolean(selectedId) }"
    >
      <aside class="skill-list-pane" :aria-label="t('admin.skills.list.label')">
        <div v-if="loadingList" class="list-state" role="status">
          <a-spin />
          <span>{{ t('admin.skills.list.loading') }}</span>
        </div>
        <div v-else-if="listError" class="list-state error" role="alert">
          <WarningOutlined aria-hidden="true" />
          <span>{{ listError }}</span>
          <a-button @click="loadSkills">{{ t('admin.skills.actions.retry') }}</a-button>
        </div>
        <div v-else-if="skills.length === 0" class="list-state">
          <ToolOutlined aria-hidden="true" />
          <strong>{{ t('admin.skills.list.emptyTitle') }}</strong>
          <span>{{ includeArchived ? t('admin.skills.list.emptyArchived') : t('admin.skills.list.emptyHint') }}</span>
        </div>
        <div v-else-if="filteredSkills.length === 0" class="list-state">
          <SearchOutlined aria-hidden="true" />
          <strong>{{ t('admin.skills.list.noResultsTitle') }}</strong>
          <span>{{ t('admin.skills.list.noResultsHint') }}</span>
          <a-button @click="clearFilters">{{ t('admin.skills.filters.clear') }}</a-button>
        </div>
        <div v-else class="skill-list" role="listbox" :aria-label="t('admin.skills.list.label')">
          <button
            v-for="item in filteredSkills"
            :key="item.id"
            type="button"
            class="skill-row"
            :class="{ selected: selectedId === item.id }"
            role="option"
            :aria-selected="selectedId === item.id"
            @click="requestSelectSkill(item.id)"
          >
            <span class="skill-row-heading">
              <strong>{{ item.name }}</strong>
              <span class="state-badge" :data-state="adminSkillStateKey(item)">
                {{ t(`admin.skills.states.${adminSkillStateKey(item)}`) }}
              </span>
            </span>
            <span class="skill-row-description">{{ item.description }}</span>
            <span class="skill-row-meta">
              <span>{{ t(`admin.skills.sources.${item.source}`) }}</span>
              <span>{{ t('admin.skills.list.assignedCount', { count: item.agent_ids.length }) }}</span>
            </span>
          </button>
        </div>
      </aside>

      <div class="skill-detail-pane">
        <div v-if="loadingDetail" class="detail-state" role="status">
          <a-spin size="large" />
          <span>{{ t('admin.skills.detail.loading') }}</span>
        </div>
        <div v-else-if="detailError" class="detail-state error" role="alert">
          <WarningOutlined aria-hidden="true" />
          <span>{{ detailError }}</span>
          <a-button @click="selectedId && loadDetail(selectedId)">{{ t('admin.skills.actions.retry') }}</a-button>
        </div>
        <SkillDetailPanel
          v-else-if="selectedSkill"
          ref="detailPanel"
          :skill="selectedSkill"
          :on-unauthorized="onUnauthorized"
          @leave-requested="requestBack"
          @draft-change="draftDirty = $event"
          @updated="handleUpdated"
        />
        <div v-else class="detail-state no-selection">
          <FileSearchOutlined aria-hidden="true" />
          <strong>{{ t('admin.skills.detail.noSelectionTitle') }}</strong>
          <span>{{ t('admin.skills.detail.noSelectionHint') }}</span>
        </div>
      </div>
    </div>

    <SkillInstallDialog
      :open="installOpen"
      :capabilities="capabilities"
      :on-unauthorized="onUnauthorized"
      @close="installOpen = false"
      @installed="handleInstalled"
    />
    <a-modal
      :open="discardOpen"
      :title="t('admin.skills.discard.title')"
      :ok-text="t('admin.skills.discard.confirm')"
      :cancel-text="t('common.cancel')"
      ok-type="danger"
      :mask-closable="false"
      @ok="confirmDiscard"
      @cancel="cancelDiscard"
    >
      <p>{{ t('admin.skills.discard.description', { name: selectedSkill?.name ?? '' }) }}</p>
    </a-modal>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  FileSearchOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  ToolOutlined,
  WarningOutlined,
} from '@ant-design/icons-vue'
import {
  adminSkillStateKey,
  filterAdminSkills,
  localizeAdminSkillError,
  shouldApplySkillMutation,
} from '@/admin/skill-management'
import type { AdminSkillMutationEvent } from '@/admin/skill-management'
import { adminGetSkill, adminListSkills, isAdminAuthError } from '@/services/api'
import type {
  AdminSkillCapabilities,
  AdminSkillDetail,
  AdminSkillSource,
  AdminSkillState,
  AdminSkillSummary,
} from '@/types'
import SkillDetailPanel from './SkillDetailPanel.vue'
import SkillInstallDialog from './SkillInstallDialog.vue'

const props = defineProps<{ onUnauthorized: () => void }>()
const { t } = useI18n()

const skills = ref<AdminSkillSummary[]>([])
const capabilities = ref<AdminSkillCapabilities>({
  git_available: false,
  private_git_credentials_available: false,
})
const query = ref('')
const sourceFilter = ref<'all' | AdminSkillSource>('all')
const stateFilter = ref<'all' | AdminSkillState>('all')
const includeArchived = ref(false)
const loadingList = ref(false)
const listError = ref('')
const selectedId = ref<string | null>(null)
const selectedSkill = ref<AdminSkillDetail | null>(null)
const loadingDetail = ref(false)
const detailError = ref('')
const installOpen = ref(false)
const liveStatus = ref('')
const draftDirty = ref(false)
const discardOpen = ref(false)
const detailPanel = ref<InstanceType<typeof SkillDetailPanel> | null>(null)
type PendingTransition =
  | { kind: 'select', skillId: string }
  | { kind: 'back' }
  | { kind: 'install' }
  | { kind: 'installed', skill: AdminSkillDetail }
const pendingTransition = ref<PendingTransition | null>(null)
let listRequestId = 0
let detailRequestId = 0

const sourceOptions = computed(() => [
  { value: 'all', label: t('admin.skills.filters.allSources') },
  ...(['builtin', 'upload', 'git'] as const).map((value) => ({
    value,
    label: t(`admin.skills.sources.${value}`),
  })),
])

const stateOptions = computed(() => [
  { value: 'all', label: t('admin.skills.filters.allStates') },
  ...(['candidate', 'enabled', 'disabled', 'archived'] as const).map((value) => ({
    value,
    label: t(`admin.skills.states.${value}`),
  })),
])

const filteredSkills = computed(() => filterAdminSkills(skills.value, {
  query: query.value,
  source: sourceFilter.value === 'all' ? undefined : sourceFilter.value,
  state: stateFilter.value === 'all' ? undefined : stateFilter.value,
}))

const handleError = (error: unknown): string => {
  if (isAdminAuthError(error)) {
    props.onUnauthorized()
    return ''
  }
  return t(localizeAdminSkillError(error))
}

const loadSkills = async () => {
  const requestId = ++listRequestId
  const archived = includeArchived.value
  loadingList.value = true
  listError.value = ''
  try {
    const response = await adminListSkills({ archived })
    if (requestId !== listRequestId) return
    skills.value = response.items
    capabilities.value = response.capabilities
    if (selectedId.value && !skills.value.some((item) => item.id === selectedId.value)) {
      clearSelection()
    }
  } catch (error) {
    if (requestId !== listRequestId) return
    listError.value = handleError(error)
  } finally {
    if (requestId === listRequestId) loadingList.value = false
  }
}

const loadDetail = async (skillId: string) => {
  const requestId = ++detailRequestId
  loadingDetail.value = true
  detailError.value = ''
  try {
    const skill = (await adminGetSkill(skillId)).skill
    if (requestId !== detailRequestId || selectedId.value !== skillId) return
    selectedSkill.value = skill
    loadingDetail.value = false
    await nextTick()
    detailPanel.value?.focusHeading()
  } catch (error) {
    if (requestId !== detailRequestId || selectedId.value !== skillId) return
    detailError.value = handleError(error)
  } finally {
    if (requestId === detailRequestId) loadingDetail.value = false
  }
}

const selectSkill = (skillId: string) => {
  if (selectedId.value === skillId && selectedSkill.value) return
  liveStatus.value = ''
  draftDirty.value = false
  selectedId.value = skillId
  selectedSkill.value = null
  void loadDetail(skillId)
}

const clearSelection = () => {
  detailRequestId += 1
  selectedId.value = null
  selectedSkill.value = null
  detailError.value = ''
  draftDirty.value = false
}

const performTransition = async (transition: PendingTransition) => {
  if (transition.kind === 'select') {
    selectSkill(transition.skillId)
    return
  }
  if (transition.kind === 'back') {
    liveStatus.value = ''
    clearSelection()
    return
  }
  if (transition.kind === 'install') {
    liveStatus.value = ''
    installOpen.value = true
    return
  }

  installOpen.value = false
  includeArchived.value = false
  await loadSkills()
  selectSkill(transition.skill.id)
  selectedSkill.value = transition.skill
  liveStatus.value = t('admin.skills.install.success')
  await nextTick()
  detailPanel.value?.focusHeading()
}

const requestTransition = (transition: PendingTransition) => {
  if (draftDirty.value) {
    pendingTransition.value = transition
    discardOpen.value = true
    return
  }
  void performTransition(transition)
}

const requestSelectSkill = (skillId: string) => {
  if (skillId !== selectedId.value) requestTransition({ kind: 'select', skillId })
}
const requestBack = () => requestTransition({ kind: 'back' })
const requestInstall = () => requestTransition({ kind: 'install' })

const confirmDiscard = () => {
  const transition = pendingTransition.value
  detailPanel.value?.discardDraft()
  draftDirty.value = false
  discardOpen.value = false
  pendingTransition.value = null
  if (transition) void performTransition(transition)
}

const cancelDiscard = () => {
  discardOpen.value = false
  pendingTransition.value = null
}

const clearFilters = () => {
  query.value = ''
  sourceFilter.value = 'all'
  stateFilter.value = 'all'
}

const handleUpdated = async (event: AdminSkillMutationEvent) => {
  const applies = shouldApplySkillMutation(selectedId.value, event.originSkillId, event.skill.id)
  if (applies) {
    selectedSkill.value = event.skill
    liveStatus.value = t(event.messageKey)
  }
  await loadSkills()
}

const handleInstalled = async (skill: AdminSkillDetail) => {
  installOpen.value = false
  requestTransition({ kind: 'installed', skill })
}

onMounted(loadSkills)
</script>

<style scoped>
.admin-skills-panel {
  min-width: 0;
}

.skills-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.skills-header h1 {
  margin: 0;
  color: #332b25;
  font-size: 22px;
  line-height: 1.35;
}

.skills-toolbar {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) 150px 150px auto auto;
  align-items: center;
  gap: 8px;
  margin-top: 24px;
  padding: 12px 0;
  border-top: 1px solid #ece8e3;
  border-bottom: 1px solid #ece8e3;
}

.panel-notice {
  margin-top: 16px;
  padding: 10px 12px;
  border-left: 3px solid #718355;
  background: #f5f7f2;
  color: #4c5940;
  font-size: 13px;
}

.archived-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  color: #5f5852;
  font-size: 12px;
  cursor: pointer;
}

.archived-toggle input {
  width: 18px;
  height: 18px;
  accent-color: #b75332;
}

.archived-toggle:focus-within {
  outline: 3px solid rgba(196, 96, 61, 0.36);
  outline-offset: 2px;
}

.skills-work-surface {
  display: grid;
  grid-template-columns: minmax(300px, 38%) minmax(0, 1fr);
  min-height: 620px;
  margin-top: 16px;
  border: 1px solid #e1dcd6;
}

.skill-list-pane {
  min-width: 0;
  border-right: 1px solid #e1dcd6;
  background: #faf9f7;
}

.skill-list {
  display: grid;
}

.skill-row {
  display: grid;
  gap: 8px;
  width: 100%;
  min-height: 112px;
  padding: 15px 16px;
  border: 0;
  border-bottom: 1px solid #e7e2dd;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.skill-row:hover { background: #f4f0eb; }
.skill-row.selected { box-shadow: inset 4px 0 #b75332; background: #fff; }
.skill-row:focus-visible { position: relative; z-index: 1; outline: 3px solid rgba(196, 96, 61, 0.48); outline-offset: -3px; }

.skill-row-heading,
.skill-row-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.skill-row-heading strong {
  min-width: 0;
  color: #443b34;
  font-size: 14px;
  overflow-wrap: anywhere;
}

.skill-row-description {
  display: -webkit-box;
  overflow: hidden;
  color: #6e655e;
  font-size: 12px;
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.skill-row-meta { color: #8a817a; font-size: 11px; }

.state-badge {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  flex: 0 0 auto;
  padding: 2px 7px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 650;
}

.state-badge[data-state="candidate"] { background: #fff4df; color: #835d13; }
.state-badge[data-state="enabled"] { background: #edf6ec; color: #386438; }
.state-badge[data-state="disabled"] { background: #f1efed; color: #5f5852; }
.state-badge[data-state="archived"] { background: #f8e9e6; color: #8b3d32; }

.skill-detail-pane { min-width: 0; background: #fff; }

.list-state,
.detail-state {
  display: flex;
  min-height: 260px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 10px;
  padding: 24px;
  color: #746b64;
  font-size: 13px;
  text-align: center;
}

.detail-state { min-height: 560px; }
.list-state > :first-child,
.detail-state > :first-child { font-size: 24px; }
.list-state strong,
.detail-state strong { color: #443b34; font-size: 14px; }
.list-state.error,
.detail-state.error { color: #9a251d; }

@media (max-width: 1180px) {
  .skills-toolbar {
    grid-template-columns: minmax(180px, 1fr) 140px 140px;
  }
}

@media (max-width: 760px) {
  .skills-header { align-items: stretch; flex-direction: column; }
  .skills-header :deep(.ant-btn) { min-height: 44px; width: 100%; }
  .skills-toolbar { grid-template-columns: 1fr 1fr; }
  .skills-toolbar > :first-child { grid-column: 1 / -1; }
  .skills-toolbar :deep(.ant-btn) { min-height: 44px; }
  .skills-toolbar :deep(.ant-input-affix-wrapper),
  .skills-toolbar :deep(.ant-select-selector) { min-height: 44px; }
  .archived-toggle { min-height: 44px; }
  .skills-work-surface { display: block; min-height: 0; border-right: 0; border-left: 0; }
  .skill-list-pane { border-right: 0; }
  .skill-row { min-height: 112px; }
  .skills-work-surface.has-selection .skill-list-pane { display: none; }
  .skills-work-surface:not(.has-selection) .skill-detail-pane { display: none; }
}

@media (max-width: 420px) {
  .skills-toolbar { grid-template-columns: 1fr; }
  .skills-toolbar > :first-child { grid-column: auto; }
  .skill-row { padding-right: 12px; padding-left: 12px; }
}
</style>
