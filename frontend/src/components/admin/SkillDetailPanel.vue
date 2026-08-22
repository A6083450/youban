<template>
  <article class="skill-detail" :aria-labelledby="headingId">
    <div class="skill-detail-heading-row">
      <button class="back-button" type="button" @click="emit('leave-requested')">
        <ArrowLeftOutlined aria-hidden="true" />
        {{ t('admin.skills.backToList') }}
      </button>
      <div class="skill-heading-copy">
        <div class="skill-title-line">
          <h2 :id="headingId" ref="heading" tabindex="-1">{{ skill.name }}</h2>
          <span class="state-badge" :data-state="stateKey">{{ stateLabel }}</span>
        </div>
        <p>{{ skill.description }}</p>
      </div>
    </div>

    <dl class="skill-source-summary">
      <div>
        <dt>{{ t('admin.skills.detail.source') }}</dt>
        <dd>{{ t(`admin.skills.sources.${skill.source}`) }}</dd>
      </div>
      <div v-if="skill.repository_url">
        <dt>{{ t('admin.skills.detail.repository') }}</dt>
        <dd class="break-value">{{ skill.repository_url }}</dd>
      </div>
      <div v-if="skill.source_ref">
        <dt>{{ t('admin.skills.detail.ref') }}</dt>
        <dd>{{ skill.source_ref }}</dd>
      </div>
      <div v-if="skill.source_subdirectory">
        <dt>{{ t('admin.skills.detail.subdirectory') }}</dt>
        <dd class="break-value">{{ skill.source_subdirectory }}</dd>
      </div>
    </dl>

    <div v-if="mutationError" class="operation-message error" role="alert">
      {{ mutationError }}
    </div>
    <div v-if="busy" class="operation-message" role="status">
      {{ t(`admin.skills.progress.${busy}`) }}
    </div>

    <a-tabs v-model:active-key="activeTab" class="skill-tabs">
      <a-tab-pane key="content" :tab="t('admin.skills.tabs.content')">
        <section class="tab-section">
          <div class="section-heading">
            <h3>{{ t('admin.skills.content.activeTitle') }}</h3>
          </div>
          <VersionMetadata v-if="skill.active_version" :version="skill.active_version" />
          <pre v-if="skill.active_version" class="skill-content readonly-content">{{ skill.active_version.content }}</pre>
          <div v-else class="empty-inline">{{ t('admin.skills.content.noActive') }}</div>
        </section>

        <section class="tab-section candidate-section">
          <div class="section-heading">
            <div>
              <h3>{{ t('admin.skills.content.candidateTitle') }}</h3>
              <p v-if="skill.kind === 'builtin'">{{ t('admin.skills.content.builtinReadOnly') }}</p>
            </div>
            <a-button
              v-if="skill.kind === 'custom' && !skill.archived_at"
              :loading="busy === 'save'"
              :disabled="Boolean(busy) || !editorContent.trim() || !editorDirty"
              @click="saveCandidate"
            >
              <SaveOutlined aria-hidden="true" />
              {{ t('admin.skills.actions.saveCandidate') }}
            </a-button>
          </div>
          <VersionMetadata v-if="skill.candidate_version" :version="skill.candidate_version" />
          <textarea
            v-if="skill.kind === 'custom' && !skill.archived_at"
            v-model="editorContent"
            class="skill-editor"
            :aria-label="t('admin.skills.content.editorLabel')"
            :disabled="Boolean(busy)"
            spellcheck="false"
          />
          <pre v-else-if="skill.candidate_version" class="skill-content readonly-content">{{ skill.candidate_version.content }}</pre>
          <div v-else-if="skill.kind === 'builtin'" class="empty-inline">
            {{ t('admin.skills.content.builtinNoCandidate') }}
          </div>
        </section>

        <section v-if="skill.candidate_version" class="tab-section">
          <div class="section-heading">
            <h3>{{ t('admin.skills.content.diffTitle') }}</h3>
          </div>
          <div class="diff-legend" aria-hidden="true">
            <span class="diff-label added">{{ t('admin.skills.content.added') }}</span>
            <span class="diff-label removed">{{ t('admin.skills.content.removed') }}</span>
          </div>
          <div class="skill-diff" :aria-label="t('admin.skills.content.diffTitle')">
            <div
              v-for="(change, index) in changes"
              :key="index"
              class="diff-block"
              :class="{ added: change.added, removed: change.removed }"
            >
              <span class="diff-block-label">
                {{ change.added
                  ? t('admin.skills.content.added')
                  : change.removed
                    ? t('admin.skills.content.removed')
                    : t('admin.skills.content.unchanged') }}
              </span>
              <pre>{{ change.value }}</pre>
            </div>
          </div>
        </section>
      </a-tab-pane>

      <a-tab-pane key="assignments" :tab="t('admin.skills.tabs.assignments')">
        <section class="tab-section configuration-section">
          <div class="enable-row">
            <h3>{{ t('admin.skills.assignments.globalTitle') }}</h3>
            <a-switch
              v-model:checked="enabled"
              :disabled="Boolean(busy) || Boolean(skill.archived_at)"
              :aria-label="t('admin.skills.assignments.globalTitle')"
            />
          </div>
          <fieldset :disabled="Boolean(busy) || Boolean(skill.archived_at)" class="assignment-fieldset">
            <legend>{{ t('admin.skills.assignments.targetsTitle') }}</legend>
            <div class="assignment-grid">
              <label v-for="agentId in ADMIN_SKILL_AGENT_IDS" :key="agentId" class="assignment-option">
                <input
                  type="checkbox"
                  :checked="assignments.includes(agentId)"
                  @change="toggleAssignment(agentId, ($event.target as HTMLInputElement).checked)"
                >
                <span>
                  <strong>{{ t(`admin.skills.agents.${agentId}.name`) }}</strong>
                  <small>{{ t(`admin.skills.agents.${agentId}.description`) }}</small>
                </span>
              </label>
            </div>
          </fieldset>
          <p v-if="editorDirty" class="unsaved-warning" role="alert">
            {{ t('admin.skills.content.saveBeforeActivate') }}
          </p>
          <div class="configuration-actions">
            <a-button
              :loading="busy === 'configure'"
              :disabled="Boolean(busy) || Boolean(skill.archived_at) || editorDirty || !configurationDirty"
              @click="saveConfiguration"
            >
              <SaveOutlined aria-hidden="true" />
              {{ t('admin.skills.actions.saveConfiguration') }}
            </a-button>
            <a-button
              v-if="skill.candidate_version && !skill.archived_at"
              type="primary"
              :loading="busy === 'activate'"
              :disabled="Boolean(busy) || editorDirty"
              @click="activateCandidate"
            >
              <CheckCircleOutlined aria-hidden="true" />
              {{ t('admin.skills.actions.activate') }}
            </a-button>
          </div>
        </section>
      </a-tab-pane>

      <a-tab-pane key="versions" :tab="t('admin.skills.tabs.versions')">
        <section class="tab-section">
          <div class="section-heading">
            <h3>{{ t('admin.skills.versions.title') }}</h3>
          </div>
          <ol class="version-list">
            <li v-for="version in sortedVersions" :key="version.id" class="version-row">
              <div class="version-row-heading">
                <strong>{{ t('admin.skills.versions.version', { number: version.version_number }) }}</strong>
                <span class="version-state">{{ t(`admin.skills.versionStates.${version.state}`) }}</span>
              </div>
              <VersionMetadata :version="version" />
            </li>
          </ol>
        </section>
      </a-tab-pane>
    </a-tabs>

    <div class="skill-command-bar">
      <a-button
        v-if="skill.source === 'git' && skill.kind === 'custom' && !skill.archived_at"
        :loading="busy === 'update'"
        :disabled="Boolean(busy) || editorDirty"
        @click="checkUpdate"
      >
        <SyncOutlined aria-hidden="true" />
        {{ t('admin.skills.actions.checkUpdate') }}
      </a-button>
      <a-button
        v-if="canRestore"
        :loading="busy === 'restore'"
        :disabled="Boolean(busy)"
        @click="restoreSkill"
      >
        <RollbackOutlined aria-hidden="true" />
        {{ t('admin.skills.actions.restore') }}
      </a-button>
      <a-button
        v-if="canArchive"
        danger
        :disabled="Boolean(busy) || hasDirtyDraft"
        @click="archiveDialogOpen = true"
      >
        <InboxOutlined aria-hidden="true" />
        {{ t('admin.skills.actions.archive') }}
      </a-button>
    </div>

    <a-modal
      :open="archiveDialogOpen"
      :title="t('admin.skills.archive.title')"
      :ok-text="t('admin.skills.archive.confirm')"
      :cancel-text="t('common.cancel')"
      ok-type="danger"
      :confirm-loading="busy === 'archive'"
      @ok="archiveSkill"
      @cancel="archiveDialogOpen = false"
    >
      <p>{{ t('admin.skills.archive.description', { name: skill.name }) }}</p>
    </a-modal>
  </article>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { diffLines } from 'diff'
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  InboxOutlined,
  RollbackOutlined,
  SaveOutlined,
  SyncOutlined,
} from '@ant-design/icons-vue'
import {
  ADMIN_SKILL_AGENT_IDS,
  adminSkillStateKey,
  createAdminSkillDraft,
  hasAdminSkillDraftChanges,
  localizeAdminSkillError,
  mergeAdminSkillDraft,
  setSkillAssignment,
  skillActions,
  sortAdminSkillVersions,
  withAdminSkillDraftConfiguration,
  withAdminSkillDraftContent,
} from '@/admin/skill-management'
import {
  adminActivateSkill,
  adminArchiveSkill,
  adminCheckSkillUpdate,
  adminConfigureSkill,
  adminRestoreSkill,
  adminSaveSkillCandidate,
  isAdminAuthError,
} from '@/services/api'
import type {
  AdminSkillDraftMergeOperation,
  AdminSkillMutationEvent,
} from '@/admin/skill-management'
import type { AdminSkillAgentId, AdminSkillDetail, AdminSkillVersion } from '@/types'

const props = defineProps<{
  skill: AdminSkillDetail
  onUnauthorized: () => void
}>()

const emit = defineEmits<{
  'leave-requested': []
  'draft-change': [dirty: boolean]
  updated: [event: AdminSkillMutationEvent]
}>()

const { t, locale } = useI18n()
const heading = ref<HTMLElement | null>(null)
const activeTab = ref('content')
const draft = ref(createAdminSkillDraft(props.skill))
const busy = ref<'' | 'save' | 'configure' | 'activate' | 'update' | 'archive' | 'restore'>('')
const mutationError = ref('')
const archiveDialogOpen = ref(false)

const VersionMetadata = defineComponent({
  props: { version: { type: Object as () => AdminSkillVersion, required: true } },
  setup(componentProps) {
    return () => h('dl', { class: 'version-metadata' }, [
      h('div', [h('dt', t('admin.skills.detail.hash')), h('dd', { class: 'break-value mono' }, componentProps.version.sha256)]),
      ...(componentProps.version.source_commit
        ? [h('div', [h('dt', t('admin.skills.detail.commit')), h('dd', { class: 'break-value mono' }, componentProps.version.source_commit)])]
        : []),
      h('div', [h('dt', t('admin.skills.detail.created')), h('dd', formatDate(componentProps.version.created_at))]),
      ...(componentProps.version.activated_at
        ? [h('div', [h('dt', t('admin.skills.detail.activated')), h('dd', formatDate(componentProps.version.activated_at))])]
        : []),
    ])
  },
})

const headingId = computed(() => `skill-detail-${props.skill.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`)
const stateKey = computed(() => adminSkillStateKey(props.skill))
const stateLabel = computed(() => t(`admin.skills.states.${stateKey.value}`))
const sortedVersions = computed(() => sortAdminSkillVersions(props.skill.versions).reverse())
const canArchive = computed(() => skillActions(props.skill).includes('archive'))
const canRestore = computed(() => skillActions(props.skill).includes('restore'))
const editorDirty = computed(() => draft.value.contentDirty)
const configurationDirty = computed(() => draft.value.configurationDirty)
const hasDirtyDraft = computed(() => hasAdminSkillDraftChanges(draft.value))
const editorContent = computed({
  get: () => draft.value.editorContent,
  set: (content: string) => {
    draft.value = withAdminSkillDraftContent(draft.value, content)
  },
})
const enabled = computed({
  get: () => draft.value.enabled,
  set: (value: boolean) => {
    draft.value = withAdminSkillDraftConfiguration(draft.value, value, draft.value.agentIds)
  },
})
const assignments = computed(() => draft.value.agentIds)
const changes = computed(() => diffLines(
  props.skill.active_version?.content ?? '',
  props.skill.candidate_version?.content ?? '',
))

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale.value, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

watch(() => props.skill.id, () => {
  draft.value = createAdminSkillDraft(props.skill)
  busy.value = ''
  mutationError.value = ''
  archiveDialogOpen.value = false
  activeTab.value = 'content'
})
watch(hasDirtyDraft, (dirty) => emit('draft-change', dirty), { immediate: true })

const focusHeading = () => heading.value?.focus({ preventScroll: true })
const discardDraft = () => {
  draft.value = createAdminSkillDraft(props.skill)
  mutationError.value = ''
  archiveDialogOpen.value = false
}
defineExpose({ focusHeading, discardDraft })

const toggleAssignment = (agentId: AdminSkillAgentId, assigned: boolean) => {
  draft.value = withAdminSkillDraftConfiguration(
    draft.value,
    draft.value.enabled,
    setSkillAssignment(draft.value.agentIds, agentId, assigned),
  )
}

const runMutation = async (
  operation: Exclude<typeof busy.value, ''>,
  action: (originSkillId: string) => Promise<AdminSkillDetail>,
  successKey: string,
  mergeOperation?: AdminSkillDraftMergeOperation,
): Promise<boolean> => {
  if (busy.value) return false
  const originSkillId = props.skill.id
  busy.value = operation
  mutationError.value = ''
  try {
    const skill = await action(originSkillId)
    const isCurrent = props.skill.id === originSkillId && skill.id === originSkillId
    if (isCurrent) {
      draft.value = mergeOperation
        ? mergeAdminSkillDraft(draft.value, skill, mergeOperation)
        : createAdminSkillDraft(skill)
    }
    emit('updated', { originSkillId, skill, messageKey: successKey })
    return isCurrent
  } catch (error) {
    if (isAdminAuthError(error)) {
      props.onUnauthorized()
      return false
    }
    if (props.skill.id === originSkillId) {
      mutationError.value = t(localizeAdminSkillError(error))
    }
    return false
  } finally {
    if (props.skill.id === originSkillId) busy.value = ''
  }
}

const saveCandidate = () => runMutation(
  'save',
  async (originSkillId) => (await adminSaveSkillCandidate(originSkillId, editorContent.value)).skill,
  'admin.skills.messages.candidateSaved',
  'candidate',
)

const saveConfiguration = () => runMutation(
  'configure',
  async (originSkillId) => (await adminConfigureSkill(originSkillId, {
    enabled: enabled.value,
    agent_ids: assignments.value,
  })).skill,
  'admin.skills.messages.configurationSaved',
  'configure',
)

const activateCandidate = () => {
  const candidateVersionId = props.skill.candidate_version?.id
  if (!candidateVersionId || editorDirty.value) return Promise.resolve(false)
  return runMutation(
    'activate',
    async (originSkillId) => (await adminActivateSkill(originSkillId, {
      candidate_version_id: candidateVersionId,
      enabled: enabled.value,
      agent_ids: assignments.value,
    })).skill,
    'admin.skills.messages.activated',
    'activate',
  )
}

const checkUpdate = async () => {
  if (busy.value) return
  const originSkillId = props.skill.id
  busy.value = 'update'
  mutationError.value = ''
  try {
    const response = await adminCheckSkillUpdate(originSkillId)
    if (props.skill.id === originSkillId && response.skill.id === originSkillId) {
      draft.value = mergeAdminSkillDraft(draft.value, response.skill, 'update')
    }
    emit('updated', {
      originSkillId,
      skill: response.skill,
      messageKey: response.changed
      ? 'admin.skills.messages.updateCandidate'
      : 'admin.skills.messages.updateUnchanged',
    })
  } catch (error) {
    if (isAdminAuthError(error)) props.onUnauthorized()
    else if (props.skill.id === originSkillId) mutationError.value = t(localizeAdminSkillError(error))
  } finally {
    if (props.skill.id === originSkillId) busy.value = ''
  }
}

const archiveSkill = async () => {
  const succeeded = await runMutation(
    'archive',
    async (originSkillId) => (await adminArchiveSkill(originSkillId)).skill,
    'admin.skills.messages.archived',
  )
  if (succeeded) archiveDialogOpen.value = false
}

const restoreSkill = () => runMutation(
  'restore',
  async (originSkillId) => (await adminRestoreSkill(originSkillId)).skill,
  'admin.skills.messages.restoredDisabled',
)
</script>

<style scoped>
.skill-detail {
  min-width: 0;
  padding: 24px 28px 32px;
}

.skill-detail-heading-row {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.back-button {
  display: none;
  align-items: center;
  gap: 7px;
  min-height: 44px;
  padding: 0 10px;
  border: 0;
  background: transparent;
  color: #9f482c;
  cursor: pointer;
}

.skill-heading-copy {
  min-width: 0;
}

.skill-title-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.skill-title-line h2 {
  margin: 0;
  color: #332b25;
  font-size: 22px;
  line-height: 1.35;
}

.skill-title-line h2:focus-visible {
  outline: 3px solid rgba(196, 96, 61, 0.42);
  outline-offset: 4px;
}

.skill-heading-copy > p,
.section-heading p,
.enable-row p,
.assignment-fieldset > p {
  margin: 5px 0 0;
  color: #746b64;
  font-size: 13px;
}

.state-badge,
.version-state,
.diff-label {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 650;
}

.state-badge[data-state="candidate"] { background: #fff4df; color: #835d13; }
.state-badge[data-state="enabled"] { background: #edf6ec; color: #386438; }
.state-badge[data-state="disabled"] { background: #f1efed; color: #5f5852; }
.state-badge[data-state="archived"] { background: #f8e9e6; color: #8b3d32; }

.skill-source-summary,
:deep(.version-metadata) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 18px;
  margin: 20px 0 0;
}

.skill-source-summary div,
:deep(.version-metadata div) {
  min-width: 0;
}

.skill-source-summary dt,
:deep(.version-metadata dt) {
  color: #8a817a;
  font-size: 11px;
  font-weight: 650;
  text-transform: uppercase;
}

.skill-source-summary dd,
:deep(.version-metadata dd) {
  margin: 3px 0 0;
  color: #443b34;
  font-size: 12px;
}

.break-value { overflow-wrap: anywhere; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

.operation-message {
  margin-top: 16px;
  padding: 10px 12px;
  border-left: 3px solid #718355;
  background: #f5f7f2;
  color: #4c5940;
  font-size: 13px;
}

.operation-message.error {
  border-color: #b42318;
  background: #fff1f0;
  color: #8f1d16;
}

.skill-tabs { margin-top: 18px; }
.tab-section { padding: 8px 0 24px; }
.candidate-section { border-top: 1px solid #ece8e3; padding-top: 24px; }

.section-heading,
.enable-row,
.configuration-actions,
.skill-command-bar,
.version-row-heading,
.diff-legend {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.section-heading h3,
.enable-row h3 {
  margin: 0;
  color: #443b34;
  font-size: 15px;
}

.skill-content,
.skill-editor {
  width: 100%;
  min-height: 240px;
  margin: 14px 0 0;
  padding: 14px;
  border: 1px solid #ddd7d1;
  border-radius: 4px;
  background: #fbfaf8;
  color: #332b25;
  font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.skill-editor { resize: vertical; }
.skill-editor:focus-visible { outline: 3px solid rgba(196, 96, 61, 0.42); outline-offset: 2px; }
.empty-inline { margin-top: 14px; padding: 16px; background: #f7f5f2; color: #746b64; font-size: 13px; }
.unsaved-warning { margin: 0 0 12px; color: #8b4d0f; font-size: 12px; }
.enable-row :deep(.ant-switch) { min-width: 44px; }

.diff-legend { justify-content: flex-start; margin: 14px 0 8px; }
.diff-label.added, .diff-block.added { background: #edf7ed; color: #315e35; }
.diff-label.removed, .diff-block.removed { background: #fff0ee; color: #8b3128; }

.skill-diff {
  max-height: 440px;
  overflow: auto;
  border: 1px solid #ddd7d1;
  border-radius: 4px;
}

.diff-block { position: relative; padding: 8px 10px 8px 92px; background: #fbfaf8; }
.diff-block + .diff-block { border-top: 1px solid rgba(61, 50, 41, 0.07); }
.diff-block-label { position: absolute; top: 10px; left: 10px; width: 72px; font-size: 10px; font-weight: 700; text-transform: uppercase; }
.diff-block pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

.assignment-fieldset { margin: 24px 0; padding: 0; border: 0; }
.assignment-fieldset legend { color: #443b34; font-size: 14px; font-weight: 700; }
.assignment-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }

.assignment-option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-height: 68px;
  padding: 12px;
  border: 1px solid #e1dcd6;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
}

.assignment-option:focus-within { outline: 3px solid rgba(196, 96, 61, 0.34); outline-offset: 1px; }
.assignment-option input { width: 18px; height: 18px; flex: 0 0 auto; accent-color: #b75332; }
.assignment-option span { display: grid; gap: 3px; min-width: 0; }
.assignment-option strong { color: #443b34; font-size: 13px; }
.assignment-option small { color: #746b64; font-size: 11px; }
.configuration-actions { justify-content: flex-end; }

.version-list { display: grid; gap: 10px; margin: 16px 0 0; padding: 0; list-style: none; }
.version-row { padding: 14px; border: 1px solid #e1dcd6; border-radius: 6px; }
.version-state { background: #f1efed; color: #5f5852; }

.skill-command-bar { justify-content: flex-end; flex-wrap: wrap; padding-top: 18px; border-top: 1px solid #ece8e3; }
@media (max-width: 900px) {
  .assignment-grid { grid-template-columns: 1fr; }
}

@media (max-width: 760px) {
  .skill-detail { padding: 16px 0 28px; }
  .skill-detail-heading-row { display: block; }
  .back-button { display: flex; margin: 0 0 12px -10px; }
  .skill-source-summary,
  :deep(.version-metadata) { grid-template-columns: 1fr; }
  .section-heading { align-items: flex-start; flex-direction: column; }
  .section-heading :deep(.ant-btn) { min-height: 44px; }
  .configuration-actions,
  .skill-command-bar { align-items: stretch; flex-direction: column; }
  .configuration-actions :deep(.ant-btn),
  .skill-command-bar :deep(.ant-btn) { min-height: 44px; width: 100%; }
  .skill-content,
  .skill-editor { min-height: 220px; }
}
</style>
