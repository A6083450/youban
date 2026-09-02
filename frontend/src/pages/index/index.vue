<script setup lang="ts">
import type {
  ChatMessageDto,
  ConversationRecordDto,
  ParsedTripDraftDto,
  TripConfirmReplyResponseDto,
  TripParseResponseDto,
  TripTaskDetailDto,
  TripTaskEventDto,
  TripTaskStageDto,
  TripTaskStatusResponseDto,
  UserMemoryDto,
} from '@youban/contracts'
import { onLoad, onUnload } from '@dcloudio/uni-app'
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import ChatMessageContent from '@/components/ChatMessageContent.vue'
import YoubanGenerationProgress from '@/components/YoubanGenerationProgress.vue'
import { createReactiveMessage } from '@/features/chat/reactive-message'
import { createTypewriter } from '@/features/chat/typewriter'
import { mobileActionsRightCss, safeAreaTopCss } from '@/features/layout/safe-area'
import { localDateText, sidebarPlanBadge } from '@/features/sidebar/record-status'
import {
  buildTripPlanRequest,
  formatTripDraft,
  pickSuggestionBatch,
  reduceParseResult,
} from '@/features/planning/state'
import { getApiBaseUrl } from '@/http/client'
import { getStoredValue, setStoredValue, StorageKeys } from '@/platform/storage'
import { subscribeTaskEvents } from '@/platform/task-events'
import type { TaskEventSubscription } from '@/platform/task-events'
import {
  createConversation,
  deleteConversation,
  deleteTripPlan,
  deleteUserMemory,
  getConversation,
  getConversations,
  getTaskStatus,
  getUserMemories,
  replaceConversationSnapshot,
  submitTripPlan,
} from '@/services/v2'
import { streamTripConfirmReply, streamTripParse } from '@/services/chat-stream'
import { useAuthStore } from '@/store/auth'
import { usePreferencesStore } from '@/store/preferences'
import { safeAreaInsets, systemInfo } from '@/utils/systemInfo'

defineOptions({ name: 'Home' })
definePage({
  type: 'home',
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '游伴',
  },
})

type ChatItemKind = 'text' | 'streaming' | 'draft' | 'progress' | 'done' | 'failed'

interface ChatItem {
  id: string
  role: 'user' | 'assistant'
  kind: ChatItemKind
  text: string
  draft?: ParsedTripDraftDto
  ready?: boolean
  progress?: number
  stage?: TripTaskStageDto
  details?: TripTaskDetailDto[]
  planId?: string
}

interface ActiveTaskRecord {
  taskId: string
  planId: string
  city: string
  startedAt: string
}

interface PlanningSnapshot {
  [key: string]: unknown
  messages: ChatItem[]
  pendingDraft: ParsedTripDraftDto | null
  readinessToken: string
}

const auth = useAuthStore()
const preferences = usePreferencesStore()
const { t, tm } = useI18n()
const suggestions = computed(() => {
  const values = tm('chatHome.suggestions')
  return Array.isArray(values) ? values.map(String) : []
})
const visibleSuggestions = ref<string[]>([])
const messages = ref<ChatItem[]>([])
const records = ref<ConversationRecordDto[]>([])
const recordsLoading = ref(false)
const input = ref('')
const busy = ref(false)
const drawerOpen = ref(false)
const shareToolOpen = ref(false)
const shareCodeInput = ref('')
const mobileAccountMenuOpen = ref(false)
const memoryOpen = ref(false)
const memoryLoading = ref(false)
const memories = ref<UserMemoryDto[]>([])
const sessionId = ref('')
const revision = ref(0)
const pendingDraft = ref<ParsedTripDraftDto | null>(null)
const readinessToken = ref('')
const scrollTarget = ref('')
const chatBottomAnchors = ['chat-bottom-a', 'chat-bottom-b'] as const
const activeTask = ref<ActiveTaskRecord | null>(getStoredValue<ActiveTaskRecord>(StorageKeys.activeTask))
const today = localDateText()
let taskSubscription: TaskEventSubscription | null = null
let pollTimer: ReturnType<typeof setTimeout> | undefined
let generationFinished = false
let persistQueue = Promise.resolve()

function getMenuButtonLeft(): number | undefined {
  // #ifdef MP-WEIXIN
  return uni.getMenuButtonBoundingClientRect().left
  // #endif
  // #ifndef MP-WEIXIN
  return undefined
  // #endif
}

const menuButtonLeft = getMenuButtonLeft()
const mobileHeaderStyle = {
  '--mobile-safe-top': safeAreaTopCss(safeAreaInsets?.top),
  '--mobile-actions-right': mobileActionsRightCss(systemInfo?.windowWidth, menuButtonLeft),
}

const userAvatar = computed(() => {
  const source = auth.user?.avatar_url || ''
  if (!source || /^https?:\/\//.test(source))
    return source
  return `${getApiBaseUrl()}${source.startsWith('/') ? source : `/${source}`}`
})
const conversationRecords = computed(() => records.value.filter(item => item.kind === 'conversation'))
const plannedRecords = computed(() => records.value.filter(item => item.kind === 'plan'))
const planBadge = (record: ConversationRecordDto) => sidebarPlanBadge(record, today)
const hasMessages = computed(() => messages.value.length > 0)

function refreshSuggestions(): void {
  visibleSuggestions.value = pickSuggestionBatch(suggestions.value, 1)
}

watch(suggestions, refreshSuggestions, { immediate: true })

function openSharedPlan(): void {
  const code = shareCodeInput.value.trim().toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(code)) {
    uni.showToast({ title: t('shareCode.invalid'), icon: 'none' })
    return
  }
  drawerOpen.value = false
  uni.navigateTo({ url: `/pages/share/index?code=${encodeURIComponent(code)}` })
}

async function openMemories(): Promise<void> {
  mobileAccountMenuOpen.value = false
  memoryOpen.value = true
  memoryLoading.value = true
  try {
    memories.value = await getUserMemories()
  }
  catch {
    memories.value = []
  }
  finally {
    memoryLoading.value = false
  }
}

async function removeMemory(memoryId: string): Promise<void> {
  try {
    await deleteUserMemory(memoryId)
    memories.value = memories.value.filter(item => item.id !== memoryId)
    uni.showToast({ title: t('user.memoryDeleted'), icon: 'success' })
  }
  catch {
    uni.showToast({ title: t('user.memoryDeleteFailed'), icon: 'none' })
  }
}

function newIdentifier(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function pushItem(item: Omit<ChatItem, 'id'>): ChatItem {
  const created = createReactiveMessage({ id: newIdentifier('message'), ...item })
  messages.value.push(created)
  void followLatest()
  return created
}

async function followLatest(): Promise<void> {
  await nextTick()
  scrollTarget.value = scrollTarget.value === chatBottomAnchors[0]
    ? chatBottomAnchors[1]
    : chatBottomAnchors[0]
}

function history(): ChatMessageDto[] {
  return messages.value
    .filter(item => (item.kind === 'text' || item.kind === 'draft') && item.text.trim())
    .map(item => ({ role: item.role, content: item.text.trim() }))
    .slice(-10)
}

function snapshot(): PlanningSnapshot {
  return {
    messages: messages.value,
    pendingDraft: pendingDraft.value,
    readinessToken: readinessToken.value,
  }
}

function persistConversation(): void {
  if (!sessionId.value)
    return
  const capturedSession = sessionId.value
  persistQueue = persistQueue.then(async () => {
    if (capturedSession !== sessionId.value)
      return
    const updated = await replaceConversationSnapshot(capturedSession, revision.value, snapshot())
    if (capturedSession === sessionId.value)
      revision.value = updated.revision
  }).catch(() => undefined)
}

async function ensureConversation(firstMessage: string): Promise<boolean> {
  if (sessionId.value)
    return true
  const nextId = newIdentifier('conversation')
  try {
    const created = await createConversation({
      session_id: nextId,
      first_message: firstMessage,
      snapshot: snapshot(),
    })
    sessionId.value = created.session_id || nextId
    revision.value = created.revision
    await loadRecords()
    return true
  }
  catch (error) {
    pushItem({
      role: 'assistant',
      kind: 'failed',
      text: error instanceof Error ? error.message : t('chatHome.conversationSaveFailed'),
    })
    return false
  }
}

async function loadRecords(): Promise<void> {
  recordsLoading.value = true
  try {
    records.value = (await getConversations(50)).items
  }
  catch {
    records.value = []
  }
  finally {
    recordsLoading.value = false
  }
}

function restoreSnapshot(value: unknown): void {
  if (!value || typeof value !== 'object')
    return
  const stored = value as Partial<PlanningSnapshot>
  messages.value = Array.isArray(stored.messages) ? stored.messages : []
  pendingDraft.value = stored.pendingDraft || null
  readinessToken.value = typeof stored.readinessToken === 'string' ? stored.readinessToken : ''
  void followLatest()
}

async function openConversation(id: string | null): Promise<void> {
  if (!id || busy.value)
    return
  drawerOpen.value = false
  const detail = await getConversation(id)
  sessionId.value = detail.session_id || id
  revision.value = detail.revision
  restoreSnapshot(detail.snapshot)
}

function openPlan(id: string | null | undefined): void {
  if (!id)
    return
  drawerOpen.value = false
  uni.navigateTo({ url: `/pages/plan/index?id=${encodeURIComponent(id)}` })
}

function newPlan(): void {
  if (busy.value)
    return
  messages.value = []
  sessionId.value = ''
  revision.value = 0
  pendingDraft.value = null
  readinessToken.value = ''
  input.value = ''
  drawerOpen.value = false
}

async function removeRecord(record: ConversationRecordDto): Promise<void> {
  const confirmed = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: t('sidebar.delete'),
      content: t('sidebar.deleteConfirm'),
      confirmColor: '#c2413a',
      success: result => resolve(result.confirm),
      fail: () => resolve(false),
    })
  })
  if (!confirmed)
    return
  try {
    if (record.session_id)
      await deleteConversation(record.session_id)
    else if (record.task_id || record.plan_id)
      await deleteTripPlan(record.task_id || record.plan_id || '')
    else
      return
    records.value = records.value.filter(item => item.record_id !== record.record_id)
    if (record.session_id === sessionId.value)
      newPlan()
    if (activeTask.value && (record.task_id === activeTask.value.taskId || record.plan_id === activeTask.value.planId)) {
      stopTaskWatch()
      activeTask.value = null
      setStoredValue(StorageKeys.activeTask, null)
    }
    uni.showToast({ title: t('sidebar.deleted'), icon: 'success' })
  }
  catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : t('sidebar.deleteFailed'), icon: 'none' })
  }
}

function chooseSuggestion(text: string): void {
  input.value = text
}

function messageById(id: string): ChatItem | undefined {
  return messages.value.find(item => item.id === id)
}

async function handleParse(text: string): Promise<void> {
  const placeholder = pushItem({ role: 'assistant', kind: 'streaming', text: '' })
  const typewriter = createTypewriter((value) => {
    placeholder.text = value
    void followLatest()
  })
  let accumulated = ''
  let final: TripParseResponseDto | null = null
  let streamError = ''
  await streamTripParse(text, preferences.locale, history(), {
    onDelta(delta) {
      accumulated += delta
      typewriter.push(delta)
    },
    onThinking(title) {
      if (!placeholder.text)
        placeholder.text = title || t('chatHome.thinking')
    },
    onFinal(payload) {
      final = payload
    },
    onError(message) {
      streamError = message
    },
  })
  if (streamError || !final)
    throw new Error(streamError || t('chatHome.serviceUnavailable'))
  const decision = reduceParseResult(final)
  await typewriter.finish(decision.text)
  placeholder.kind = 'text'
  if (decision.type === 'message')
    return
  pendingDraft.value = decision.draft
  if (decision.type === 'generate') {
    await startGeneration(decision.draft, decision.token)
    return
  }
  readinessToken.value = decision.readinessToken
  pushItem({
    role: 'assistant',
    kind: 'draft',
    text: formatTripDraft(decision.draft),
    draft: decision.draft,
    ready: decision.readyToGenerate,
  })
}

async function handleDraftReply(text: string): Promise<void> {
  if (!pendingDraft.value)
    return
  const draft = pendingDraft.value
  const placeholder = pushItem({ role: 'assistant', kind: 'streaming', text: '' })
  const typewriter = createTypewriter((value) => {
    placeholder.text = value
    void followLatest()
  })
  let accumulated = ''
  const result: { value: TripConfirmReplyResponseDto | null } = { value: null }
  let streamError = ''
  await streamTripConfirmReply(text, draft, preferences.locale, history(), readinessToken.value, {
    onDelta(delta) {
      accumulated += delta
      typewriter.push(delta)
    },
    onThinking(title) {
      if (!placeholder.text)
        placeholder.text = title || t('chatHome.thinking')
    },
    onFinal(payload) {
      result.value = payload
    },
    onError(message) {
      streamError = message
    },
  })
  if (streamError || !result.value)
    throw new Error(streamError || t('chatHome.serviceUnavailable'))
  const response = result.value
  const message = response.message || accumulated
  if (message) {
    await typewriter.finish(message)
    placeholder.kind = 'text'
  }
  else if (placeholder.text.trim()) {
    placeholder.kind = 'text'
  }
  else {
    messages.value = messages.value.filter(item => item.id !== placeholder.id)
  }
  if (response.action === 'confirm' && response.execution_token) {
    const confirmed = response.trip || draft
    await startGeneration(confirmed, response.execution_token)
    return
  }
  if (response.action === 'cancel') {
    pendingDraft.value = null
    readinessToken.value = ''
    return
  }
  if (response.action === 'update' && response.trip) {
    pendingDraft.value = response.trip
    readinessToken.value = response.readiness_token || ''
    pushItem({
      role: 'assistant',
      kind: 'draft',
      text: formatTripDraft(response.trip),
      draft: response.trip,
      ready: response.ready_to_generate === true && Boolean(response.readiness_token),
    })
    return
  }
  if (response.readiness_token)
    readinessToken.value = response.readiness_token
}

async function sendMessage(value = input.value): Promise<void> {
  const text = value.trim()
  if (!text || busy.value)
    return
  input.value = ''
  pushItem({ role: 'user', kind: 'text', text })
  busy.value = true
  try {
    if (!await ensureConversation(text))
      return
    if (pendingDraft.value)
      await handleDraftReply(text)
    else
      await handleParse(text)
    persistConversation()
  }
  catch (error) {
    pushItem({
      role: 'assistant',
      kind: 'failed',
      text: error instanceof Error ? error.message : t('chatHome.serviceUnavailable'),
    })
    persistConversation()
  }
  finally {
    busy.value = false
  }
}

function confirmDraft(item: ChatItem): void {
  if (!item.ready || busy.value)
    return
  void sendMessage(t('chatHome.confirmGenerate'))
}

function applyTaskEvent(event: TripTaskEventDto | TripTaskStatusResponseDto): void {
  const progressItem = messages.value.find(item => item.kind === 'progress' && item.planId === event.plan_id)
  if (progressItem && event.status === 'processing') {
    progressItem.progress = event.progress
    progressItem.stage = event.stage
    progressItem.text = 'message' in event ? event.message : event.progress_text
    progressItem.details = event.details || progressItem.details || []
    void followLatest()
  }
  if (event.status === 'completed')
    finishGeneration(event.plan_id)
  else if (event.status === 'failed')
    failGeneration(event.plan_id, event.error || t('chatHome.generationFailed'))
}

function stopTaskWatch(): void {
  taskSubscription?.close()
  taskSubscription = null
  if (pollTimer)
    clearTimeout(pollTimer)
  pollTimer = undefined
}

function finishGeneration(planId: string): void {
  if (generationFinished)
    return
  generationFinished = true
  stopTaskWatch()
  setStoredValue(StorageKeys.activeTask, null)
  activeTask.value = null
  const existing = messages.value.find(item => item.kind === 'progress' && item.planId === planId)
  if (existing) {
    existing.kind = 'done'
    existing.progress = 100
    existing.text = t('chatHome.openingPlan')
  }
  pendingDraft.value = null
  readinessToken.value = ''
  persistConversation()
  void loadRecords()
  setTimeout(() => openPlan(planId), 350)
}

function failGeneration(planId: string, error: string): void {
  stopTaskWatch()
  const existing = messages.value.find(item => item.kind === 'progress' && item.planId === planId)
  if (existing) {
    existing.kind = 'failed'
    existing.text = error
  }
  persistConversation()
}

async function pollTask(taskId: string): Promise<void> {
  try {
    const event = await getTaskStatus(taskId)
    applyTaskEvent(event)
    if (event.status !== 'processing')
      return
  }
  catch {
    // WebSocket remains primary; polling retries transient failures.
  }
  pollTimer = setTimeout(() => void pollTask(taskId), 2500)
}

function watchTask(task: ActiveTaskRecord): void {
  stopTaskWatch()
  generationFinished = false
  taskSubscription = subscribeTaskEvents(task.taskId, applyTaskEvent, () => undefined)
  void pollTask(task.taskId)
}

async function startGeneration(draft: ParsedTripDraftDto, executionToken: string): Promise<void> {
  const request = buildTripPlanRequest(draft, executionToken, preferences.locale, sessionId.value, history())
  if (!request)
    throw new Error(t('chatHome.invalidDays'))
  const temporary = pushItem({
    role: 'assistant',
    kind: 'progress',
    text: t('chatHome.initializingPlan'),
    progress: 5,
    stage: 'submitted',
    details: [],
  })
  const response = await submitTripPlan(request)
  temporary.planId = response.plan_id
  const task: ActiveTaskRecord = {
    taskId: response.task_id,
    planId: response.plan_id,
    city: draft.city,
    startedAt: new Date().toISOString(),
  }
  activeTask.value = task
  setStoredValue(StorageKeys.activeTask, task)
  watchTask(task)
}

function resumeActiveTask(): void {
  if (!activeTask.value)
    return
  const existing = messages.value.find(item => item.kind === 'progress' && item.planId === activeTask.value?.planId)
  if (!existing) {
    pushItem({
      role: 'assistant',
      kind: 'progress',
      text: t('chatHome.restoringProgress'),
      progress: 5,
      stage: 'submitted',
      details: [],
      planId: activeTask.value.planId,
    })
  }
  watchTask(activeTask.value)
}

async function logout(): Promise<void> {
  await auth.logout()
  uni.reLaunch({ url: '/pages/login/index' })
}

onLoad((query) => {
  void preferences.sync()
  void loadRecords()
  const selectedConversation = typeof query?.conversation === 'string' ? query.conversation : ''
  if (selectedConversation)
    void openConversation(selectedConversation)
  if (activeTask.value)
    resumeActiveTask()
})

onUnload(() => {
  stopTaskWatch()
})
</script>

<template>
  <view class="planning-shell" :class="preferences.themeClass">
    <view v-if="drawerOpen" class="drawer-mask" @click="drawerOpen = false" />
    <aside class="sidebar" :class="{ open: drawerOpen }">
      <view class="sidebar-brand">
        {{ t('app.brand') }}
      </view>
      <button class="new-plan-button" @click="newPlan">
        <text class="plus-symbol">+</text>
        <text>{{ t('sidebar.newPlan') }}</text>
      </button>

      <button v-if="activeTask" class="active-task" @click="resumeActiveTask">
        <text class="active-dot" />
        <view class="active-copy">
          <text>{{ t('sidebar.activeGeneration') }}</text>
          <text class="active-city">{{ activeTask.city }}</text>
        </view>
      </button>

      <scroll-view scroll-y class="sidebar-list">
        <view class="sidebar-section-title">
          {{ t('sidebar.conversations') }}
        </view>
        <view v-if="recordsLoading" class="sidebar-empty">
          {{ t('common.loading') }}
        </view>
        <view v-else-if="!conversationRecords.length" class="sidebar-empty">
          {{ t('sidebar.emptyConversations') }}
        </view>
        <view
          v-for="record in conversationRecords"
          :key="record.record_id"
          class="sidebar-record-row"
          :class="{ active: record.session_id === sessionId }"
        >
          <button class="sidebar-record" @click="openConversation(record.session_id)">
            <text class="record-title">{{ record.title }}</text>
            <text v-if="record.state === 'generating'" class="record-status">{{ t('sidebar.processing') }}</text>
          </button>
          <button class="record-delete" :title="t('sidebar.delete')" :aria-label="t('sidebar.delete')" @click="removeRecord(record)">
            <wd-icon name="delete" size="14px" />
          </button>
        </view>

        <view class="sidebar-section-title plan-section-title">
          {{ t('sidebar.plans') }}
        </view>
        <view v-if="!recordsLoading && !plannedRecords.length" class="sidebar-empty">
          {{ t('sidebar.empty') }}
        </view>
        <view
          v-for="record in plannedRecords"
          :key="record.record_id"
          class="sidebar-record-row"
        >
          <button class="sidebar-record" @click="openPlan(record.plan_id)">
            <text class="record-title">{{ record.city || record.title }}</text>
            <view class="record-date">
              {{ record.start_date }} ~ {{ record.end_date }}
              <text v-if="planBadge(record)" class="sidebar-record-badge" :class="planBadge(record)">
                {{ t(`sidebar.${planBadge(record)}`) }}
              </text>
            </view>
          </button>
          <button class="record-delete" :title="t('sidebar.delete')" :aria-label="t('sidebar.delete')" @click="removeRecord(record)">
            <wd-icon name="delete" size="14px" />
          </button>
        </view>
      </scroll-view>

      <view class="sidebar-tools">
        <view class="sidebar-share-tool">
          <button
            class="sidebar-share-trigger"
            :class="{ expanded: shareToolOpen }"
            :aria-expanded="shareToolOpen"
            @click="shareToolOpen = !shareToolOpen"
          >
            <wd-icon name="link" size="16px" />
            <text>{{ t('shareCode.entryTitle') }}</text>
            <wd-icon class="share-chevron" name="arrow-down" size="12px" />
          </button>
          <view v-if="shareToolOpen" class="sidebar-share-panel">
            <text class="share-code-label">{{ t('shareCode.label') }}</text>
            <view class="share-code-row">
              <input
                v-model="shareCodeInput"
                class="share-code-input"
                :placeholder="t('shareCode.placeholder')"
                maxlength="32"
                @confirm="openSharedPlan"
              >
              <button class="share-code-submit" @click="openSharedPlan">
                {{ t('shareCode.submit') }}
              </button>
            </view>
          </view>
        </view>

        <view class="sidebar-preferences">
          <view class="sidebar-preferences-title">
            {{ t('app.preferences.label') }}
          </view>
          <view class="preference-group">
            <text class="preference-label">{{ t('app.language.label') }}</text>
            <view class="preference-segment language-segment">
              <button :class="{ active: preferences.locale === 'zh-CN' }" @click="preferences.setLocale('zh-CN')">
                {{ t('app.language.zh') }}
              </button>
              <button :class="{ active: preferences.locale === 'en-US' }" @click="preferences.setLocale('en-US')">
                {{ t('app.language.en') }}
              </button>
              <button :class="{ active: preferences.locale === 'fr-FR' }" @click="preferences.setLocale('fr-FR')">
                {{ t('app.language.fr') }}
              </button>
            </view>
          </view>
          <view class="preference-group">
            <text class="preference-label">{{ t('app.skin.label') }}</text>
            <view class="preference-segment">
              <button :class="{ active: preferences.skin === 'default' }" @click="preferences.setSkin('default')">
                <text class="skin-swatch warm" />{{ t('app.skin.warm') }}
              </button>
              <button :class="{ active: preferences.skin === 'google' }" @click="preferences.setSkin('google')">
                <text class="skin-swatch clear" />{{ t('app.skin.clear') }}
              </button>
            </view>
          </view>
        </view>
      </view>
    </aside>

    <view v-if="memoryOpen" class="modal-mask" @click.self="memoryOpen = false">
      <view class="memory-modal" role="dialog" :aria-label="t('user.memoriesTitle')">
        <view class="memory-modal-header">
          <text>{{ t('user.memoriesTitle') }}</text>
          <button :aria-label="t('common.cancel')" @click="memoryOpen = false">
            ×
          </button>
        </view>
        <view v-if="memoryLoading" class="memory-empty">
          {{ t('common.loading') }}
        </view>
        <view v-else-if="!memories.length" class="memory-empty">
          {{ t('user.memoriesEmpty') }}
        </view>
        <scroll-view v-else scroll-y class="memory-list">
          <view v-for="memory in memories" :key="memory.id" class="memory-item">
            <text>{{ memory.memory }}</text>
            <button @click="removeMemory(memory.id)">
              {{ t('user.memoryDelete') }}
            </button>
          </view>
        </scroll-view>
      </view>
    </view>

    <main class="chat-home">
      <view class="mobile-header" :style="mobileHeaderStyle">
        <button class="icon-button" :aria-label="t('navigation.openMenu')" @click="drawerOpen = true">
          <wd-icon name="menu" size="22px" />
        </button>
        <text class="mobile-brand">{{ t('app.brand') }}</text>
        <view class="mobile-actions">
          <!-- #ifndef MP-WEIXIN -->
          <button class="icon-button" :aria-label="t('sidebar.newPlan')" @click="newPlan">
            <text class="mobile-add-symbol">+</text>
          </button>
          <!-- #endif -->
          <button class="mobile-account-trigger" :aria-label="auth.user?.nickname" @click="mobileAccountMenuOpen = !mobileAccountMenuOpen">
            <image v-if="userAvatar" :src="userAvatar" mode="aspectFill" />
          </button>
        </view>
        <view v-if="mobileAccountMenuOpen" class="mobile-account-menu">
          <button @click="openMemories">
            <wd-icon name="list" size="15px" />{{ t('user.myMemories') }}
          </button>
          <button class="mobile-switch-user-action" @click="logout">
            <wd-icon name="logout" size="15px" />{{ t('user.switchUser') }}
          </button>
        </view>
      </view>

      <scroll-view
        v-if="hasMessages"
        scroll-y
        class="chat-scroll"
        :scroll-into-view="scrollTarget"
        :scroll-with-animation="true"
      >
        <view class="thread">
          <view
            v-for="item in messages"
            :id="item.id"
            :key="item.id"
            class="message-row"
            :class="item.role"
          >
            <view v-if="item.role === 'assistant'" class="message-avatar assistant">
              游
            </view>
            <view class="message-column" :class="item.role">
              <text class="message-name">{{ item.role === 'assistant' ? t('chatHome.assistantName') : t('chatHome.userName') }}</text>
              <view class="message-bubble" :class="[item.role, item.kind]">
                <YoubanGenerationProgress
                  v-if="item.kind === 'progress'"
                  :message="item.text"
                  :progress="item.progress || 0"
                  :stage="item.stage || 'submitted'"
                  :details="item.details || []"
                  compact
                />
                <ChatMessageContent
                  v-else
                  :text="item.text || (item.kind === 'streaming' ? t('result.agent.typing') : '')"
                  :markdown="item.role === 'assistant' && item.kind === 'text'"
                />
                <view v-if="item.kind === 'draft' && item.ready" class="draft-actions">
                  <button class="draft-button primary" :disabled="busy" @click="confirmDraft(item)">
                    ✓ {{ t('composer.generateDetailed') }}
                  </button>
                  <button class="draft-button" :disabled="busy" @click="input = t('chatHome.adjustPrompt')">
                    {{ t('composer.adjustDraft') }}
                  </button>
                </view>
                <button v-if="item.kind === 'done'" class="open-result" @click="openPlan(item.planId)">
                  {{ t('chatHome.openPlan') }}
                </button>
              </view>
            </view>
            <view v-if="item.role === 'user'" class="message-avatar user">
              {{ t('chatHome.userName') }}
            </view>
          </view>
          <view :id="chatBottomAnchors[0]" class="chat-bottom-anchor" />
          <view :id="chatBottomAnchors[1]" class="chat-bottom-anchor" />
        </view>
      </scroll-view>

      <view class="chat-input-area" :class="{ empty: !hasMessages }">
        <view v-if="!hasMessages" class="ai-agent-intro">
          <view class="ai-agent-label">
            <text class="ai-agent-mark">AI</text>
            <text>{{ t('chatHome.agentLabel') }}</text>
          </view>
          <view class="ai-agent-title">
            {{ t('chatHome.agentTitle') }}
          </view>
          <view class="ai-agent-description">
            {{ t('chatHome.agentDescription') }}
          </view>
        </view>

        <view class="composer" :class="{ 'disabled': busy, 'home-composer': !hasMessages }">
          <input
            v-if="!hasMessages"
            v-model="input"
            class="home-prompt-input"
            :disabled="busy"
            :maxlength="500"
            confirm-type="send"
            :placeholder="t('composer.homePlaceholder')"
            @confirm="sendMessage()"
          >
          <textarea
            v-else
            v-model="input"
            class="composer-input"
            :disabled="busy"
            :maxlength="500"
            :auto-height="true"
            confirm-type="send"
            :placeholder="t('composer.placeholder')"
            @confirm="sendMessage()"
          />
          <button
            class="send-button"
            :disabled="busy || !input.trim()"
            :aria-label="t('composer.send')"
            @click="sendMessage()"
          >
            {{ busy ? '…' : '↑' }}
          </button>
        </view>

        <view v-if="!hasMessages && visibleSuggestions[0]" class="suggestions">
          <view class="suggestion-heading">
            <text class="suggestion-label">{{ t('chatHome.inspiration') }}</text>
            <button
              class="suggestion-refresh"
              :aria-label="t('chatHome.refreshSuggestions')"
              @click="refreshSuggestions"
            >
              <wd-icon name="refresh" size="18px" />
            </button>
          </view>
          <button
            class="suggestion"
            @click="chooseSuggestion(visibleSuggestions[0])"
          >
            <text class="suggestion-copy">{{ visibleSuggestions[0] }}</text>
            <wd-icon name="arrow-right" size="18px" />
          </button>
        </view>
      </view>
    </main>
  </view>
</template>

<style scoped lang="scss">
.planning-shell {
  display: flex;
  width: 100%;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  background: var(--surface-page);
}

.sidebar {
  display: flex;
  flex: 0 0 260px;
  flex-direction: column;
  box-sizing: border-box;
  width: 260px;
  min-width: 260px;
  height: 100%;
  border-right: 1px solid var(--border-subtle);
  background: var(--surface-navigation);
}

.sidebar-brand {
  box-sizing: border-box;
  height: 51px;
  padding: 18px 16px 10px;
  color: var(--text-primary);
  font-size: 20px;
  font-weight: 800;
  line-height: 23px;
}

.new-plan-button {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  width: calc(100% - 24px);
  height: 40px;
  min-height: 40px;
  margin: 4px 12px 12px;
  padding: 0 14px;
  border: 1px solid var(--accent-focus);
  border-radius: 12px;
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-size: 14px;
  font-weight: 650;
  gap: 8px;
  line-height: 16.1px;
}

.plus-symbol {
  font-size: 20px;
  font-weight: 400;
}
.active-task {
  display: flex;
  align-items: center;
  margin: 0 16px 12px;
  padding: 10px 12px;
  border: 1px solid rgba(217, 119, 87, 0.22);
  border-radius: 8px;
  background: #fff;
  text-align: left;
  gap: 9px;
}
.active-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent-primary);
}
.active-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  color: var(--text-primary);
  font-size: 12px;
}
.active-city {
  overflow: hidden;
  color: var(--text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sidebar-list {
  box-sizing: border-box;
  width: 100%;
  flex: 1;
  min-height: 0;
  padding: 0 8px 12px;
}
.sidebar-section-title {
  padding: 4px 16px 8px;
  color: rgba(61, 50, 41, 0.45);
  font-size: 12px;
  font-weight: 600;
  line-height: 13.8px;
}
.plan-section-title {
  margin-top: 2px;
}
.sidebar-empty {
  padding: 12px 8px;
  color: rgba(61, 50, 41, 0.5);
  font-size: 13px;
  line-height: 14.95px;
}
.sidebar-record-row {
  display: flex;
  position: relative;
  box-sizing: border-box;
  width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  flex-direction: column;
}
.sidebar-record-row.active {
  background: var(--accent-soft);
}
.sidebar-record {
  display: flex;
  box-sizing: border-box;
  width: 100%;
  min-height: 0;
  margin: 0;
  padding: 0 28px 0 0;
  flex-direction: column;
  align-items: stretch;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--text-primary);
  font-family: Montserrat, Helvetica, Arial, sans-serif;
  font-weight: 300;
  gap: 2px;
  line-height: normal;
  text-align: left;
}
.sidebar-record::after {
  display: none;
}
.record-delete {
  display: flex;
  position: absolute;
  top: 8px;
  right: 8px;
  box-sizing: border-box;
  width: 24px;
  height: 24px;
  margin: 0;
  padding: 0;
  align-items: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  justify-content: center;
  opacity: 0;
}
.record-delete::after {
  display: none;
}
.record-delete:hover {
  background: var(--surface-soft);
  color: var(--status-danger);
  opacity: 1;
}
.record-title {
  overflow: hidden;
  font-size: 14px;
  font-weight: 600;
  line-height: 16.1px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.record-date,
.record-status {
  margin-top: 0;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 13.8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.record-status {
  color: var(--accent-strong);
}
.sidebar-record-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 10px;
  line-height: 1.5;
}
.sidebar-record-badge.processing {
  color: #d46b08;
  background: rgba(255, 165, 0, 0.15);
}
.sidebar-record-badge.failed {
  color: rgba(61, 50, 41, 0.55);
  background: rgba(61, 50, 41, 0.1);
}
.sidebar-record-badge.ongoing {
  color: #a8752a;
  background: rgba(216, 169, 78, 0.18);
}
.sidebar-tools {
  flex-shrink: 0;
  border-top: 1px solid var(--border-subtle);
  background: var(--surface-elevated);
}
.sidebar-share-tool {
  padding: 10px 12px 8px;
}
.sidebar-share-trigger {
  display: grid;
  box-sizing: border-box;
  width: 100%;
  min-height: 44px;
  height: 44px;
  margin: 0;
  padding: 9px 10px;
  align-items: center;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  grid-template-columns: 18px minmax(0, 1fr) 14px;
  gap: 8px;
  text-align: left;
  line-height: 18.2px;
}
.sidebar-share-trigger.expanded {
  border-color: var(--accent-focus);
  background: var(--accent-hover);
  color: var(--accent-strong);
}
.share-chevron {
  justify-self: end;
  opacity: 0.65;
  transition: transform 0.15s ease;
}
.sidebar-share-trigger.expanded .share-chevron {
  transform: rotate(180deg);
}
.sidebar-share-panel {
  padding: 10px 0 2px;
}
.share-code-label {
  display: block;
  margin-bottom: 8px;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
}
.share-code-row {
  display: flex;
  align-items: stretch;
  gap: 8px;
}
.share-code-input {
  box-sizing: border-box;
  min-width: 0;
  height: 40px;
  padding: 0 10px;
  flex: 1;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface-elevated);
  color: var(--text-primary);
  font-size: 12px;
}
.share-code-submit {
  min-width: 68px;
  height: 40px;
  margin: 0;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: var(--accent-primary);
  color: #fff;
  font-size: 12px;
  line-height: 40px;
}
.sidebar-preferences {
  display: flex;
  padding: 12px;
  border-top: 1px solid var(--border-subtle);
  flex-direction: column;
  gap: 10px;
}
.sidebar-preferences-title {
  margin-bottom: 10px;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 700;
}
.preference-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.preference-label {
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 700;
}
.preference-segment {
  display: grid;
  padding: 3px;
  border-radius: 7px;
  background: var(--surface-soft);
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 3px;
}
.preference-segment.language-segment {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.preference-segment button {
  display: flex;
  min-width: 0;
  min-height: 30px;
  margin: 0;
  padding: 5px 7px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-secondary);
  gap: 5px;
  font-size: 10px;
  line-height: 1.3;
}
.preference-segment button.active {
  background: var(--surface-elevated);
  color: var(--accent-strong);
  font-weight: 700;
  box-shadow: 0 2px 7px rgba(61, 50, 41, 0.08);
}
.skin-swatch {
  width: 10px;
  height: 10px;
  flex: none;
  border: 1px solid rgba(61, 50, 41, 0.12);
  border-radius: 50%;
}
.skin-swatch.warm {
  background: #d97757;
}
.skin-swatch.clear {
  background: #3b9bb4;
}
.modal-mask {
  position: fixed;
  z-index: 100;
  inset: 0;
  display: flex;
  padding: 20px;
  align-items: center;
  justify-content: center;
  background: rgba(40, 32, 26, 0.36);
}
.memory-modal {
  box-sizing: border-box;
  width: min(480px, 100%);
  max-height: min(640px, 85vh);
  padding: 20px 24px;
  border-radius: 8px;
  background: var(--surface-elevated);
  box-shadow: 0 20px 50px rgba(40, 32, 26, 0.24);
}
.memory-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 650;
}
.memory-modal-header button {
  width: 32px;
  height: 32px;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  font-size: 24px;
  line-height: 32px;
}
.memory-list {
  max-height: 480px;
  margin-top: 14px;
}
.memory-item {
  display: flex;
  min-height: 44px;
  padding: 10px 4px;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-primary);
  font-size: 13px;
  gap: 12px;
}
.memory-item text {
  flex: 1;
  line-height: 1.5;
}
.memory-item button {
  margin: 0;
  padding: 4px 8px;
  border: 0;
  background: transparent;
  color: var(--status-danger);
  font-size: 12px;
  line-height: 18px;
}
.memory-empty {
  padding: 44px 12px;
  color: var(--text-secondary);
  font-size: 13px;
  text-align: center;
}
/* Reset the uni-button text metrics to the Web controls used by the original H5. */
.new-plan-button,
.sidebar-share-trigger,
.suggestion-refresh,
.preference-segment button {
  box-sizing: border-box;
}
.preference-segment button {
  line-height: 14.4px;
}
.language-segment button {
  height: 38px;
}
.preference-segment:not(.language-segment) button {
  height: 44px;
}
.chat-home {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  background: var(--surface-page);
}
.mobile-header {
  display: none;
}
.chat-scroll {
  flex: 1;
  min-height: 0;
  padding: 32px 24px 16px;
  box-sizing: border-box;
}
.thread {
  width: 100%;
  max-width: 768px;
  margin: 0 auto;
  padding-bottom: 24px;
}
.chat-bottom-anchor {
  width: 100%;
  height: 1px;
}
.message-row {
  display: flex;
  align-items: flex-start;
  width: 100%;
  margin-bottom: 14px;
  gap: 10px;
}
.message-row.user {
  justify-content: flex-end;
}
.message-avatar {
  display: flex;
  flex: 0 0 34px;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  margin-top: 18px;
  border-radius: 50%;
  font-size: 12px;
}
.message-avatar.assistant {
  background: var(--accent-primary);
  color: #fff;
}
.message-avatar.user {
  background: rgba(61, 50, 41, 0.08);
  color: var(--text-secondary);
}
.message-column {
  display: flex;
  min-width: 0;
  max-width: min(680px, calc(100vw - 96px));
  flex-direction: column;
  gap: 4px;
}
.message-column.assistant {
  flex: 1;
  align-items: flex-start;
}
.message-column.user {
  align-items: flex-end;
}
.message-name {
  padding: 0 2px;
  color: #a89888;
  font-size: 12px;
}
.message-bubble {
  box-sizing: border-box;
  max-width: 100%;
  padding: 10px 16px;
  border-radius: 16px 16px 16px 4px;
  background: #fff;
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.65;
  overflow-wrap: anywhere;
}
.message-bubble.user {
  border-radius: 16px 16px 4px 16px;
  background: var(--accent-primary);
  color: #fff;
}
.message-bubble.assistant {
  border: 1px solid rgba(100, 80, 60, 0.14);
}
.message-bubble.draft,
.message-bubble.progress,
.message-bubble.done,
.message-bubble.failed {
  width: min(620px, 100%);
}
.message-bubble.failed {
  border-color: rgba(194, 65, 58, 0.25);
  color: var(--status-danger);
}
.message-bubble.progress {
  padding: 16px 20px;
}
.draft-actions {
  display: flex;
  margin-top: 14px;
  padding-top: 12px;
  flex-wrap: wrap;
  border-top: 1px solid var(--border-subtle);
  gap: 8px;
}
.draft-button {
  min-height: 34px;
  margin: 0;
  padding: 7px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--surface-elevated);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
}
.draft-button.primary {
  border-color: var(--accent-primary);
  background: var(--accent-primary);
  color: #fff;
}
.open-result {
  height: 34px;
  margin: 12px 0 0;
  border: 0;
  border-radius: 6px;
  background: var(--accent-primary);
  color: #fff;
  font-size: 13px;
  line-height: 34px;
}
.chat-input-area {
  display: flex;
  box-sizing: border-box;
  width: 100%;
  max-width: 768px;
  margin: 0 auto;
  padding: 0 24px 24px;
  flex-direction: column;
  gap: 14px;
}
.chat-input-area.empty {
  flex: 1;
  align-items: center;
  justify-content: flex-start;
  padding-top: clamp(72px, 13vh, 140px);
  padding-bottom: 40px;
}
.ai-agent-intro {
  box-sizing: border-box;
  width: 100%;
  max-width: 720px;
  padding: 0 4px 8px;
  text-align: left;
}
.ai-agent-label {
  display: flex;
  align-items: center;
  margin-bottom: 16px;
  color: var(--accent-strong);
  font-size: 13px;
  font-weight: 700;
  gap: 9px;
  line-height: 18px;
}
.ai-agent-mark {
  display: flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: var(--accent-primary);
  color: #fff;
  font-size: 12px;
  font-weight: 800;
  line-height: 32px;
}
.ai-agent-title {
  margin: 0 0 10px;
  color: var(--text-primary);
  font-size: 32px;
  font-weight: 760;
  line-height: 1.25;
}
.ai-agent-description {
  margin: 0;
  max-width: 620px;
  color: var(--text-secondary);
  font-size: 15px;
  line-height: 24px;
}
.composer {
  display: flex;
  box-sizing: border-box;
  width: 100%;
  max-width: 768px;
  height: auto;
  min-height: 72px;
  margin: 0 auto;
  padding: 8px 11px 8px 18px;
  align-items: center;
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  background: var(--surface-elevated);
  box-shadow: 0 4px 20px rgba(60, 64, 67, 0.1);
  gap: 10px;
}
.composer:focus-within {
  border-color: rgba(217, 119, 87, 0.45);
  box-shadow:
    0 0 0 3px var(--accent-soft),
    0 5px 22px rgba(60, 64, 67, 0.12);
}
.composer.disabled {
  opacity: 0.68;
}
.composer.home-composer {
  height: 88px;
  min-height: 88px;
  max-width: 720px;
  padding: 0 14px 0 20px;
  border-radius: 18px;
  box-shadow: 0 10px 34px rgba(61, 50, 41, 0.1);
}
.home-prompt-input {
  box-sizing: border-box;
  height: 100%;
  min-width: 0;
  flex: 1;
  padding: 0;
  color: var(--text-primary);
  font-size: 16px;
  line-height: 88px;
}
.composer-input {
  box-sizing: border-box;
  height: auto;
  min-height: 56px;
  max-height: 132px;
  flex: 1;
  padding: 4px 0;
  color: var(--text-primary);
  font-size: 15px;
  line-height: 24px;
}
.send-button {
  width: 32px;
  height: 32px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--accent-primary);
  color: #fff;
  font-size: 18px;
  font-weight: 600;
  line-height: 32px;
}
.send-button[disabled] {
  opacity: 0.35;
}
.home-composer .send-button {
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
  font-size: 20px;
  line-height: 40px;
}
.suggestions {
  display: flex;
  width: 100%;
  max-width: 720px;
  flex-direction: column;
  gap: 9px;
}
.suggestion-heading {
  display: flex;
  min-height: 36px;
  padding: 0 2px;
  align-items: center;
  justify-content: space-between;
}
.suggestion-label {
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 650;
  line-height: 18px;
}
.suggestion {
  display: flex;
  box-sizing: border-box;
  width: 100%;
  min-height: 62px;
  margin: 0;
  padding: 14px 16px 14px 18px;
  align-items: center;
  justify-content: space-between;
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
  background: var(--surface-elevated);
  color: var(--text-primary);
  font-size: 14px;
  gap: 12px;
  line-height: 22px;
  text-align: left;
}
.suggestion-copy {
  min-width: 0;
  flex: 1;
}
.suggestion-refresh {
  display: flex;
  width: 36px;
  height: 36px;
  min-height: 36px;
  margin: 0;
  padding: 0;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  line-height: 36px;
}
.drawer-mask {
  display: none;
}
button::after {
  border: 0;
}

@media (max-width: 768px) {
  .planning-shell {
    flex-direction: column;
  }
  .sidebar {
    position: fixed;
    z-index: 30;
    top: 0;
    bottom: 0;
    left: 0;
    width: 280px;
    max-width: 82vw;
    min-width: 0;
    transform: translateX(-100%);
    transition: transform 0.25s ease;
    box-shadow: 4px 0 24px rgba(61, 50, 41, 0.15);
  }
  .sidebar.open {
    transform: translateX(0);
  }
  .drawer-mask {
    position: fixed;
    z-index: 20;
    inset: 0;
    display: block;
    background: rgba(40, 32, 26, 0.32);
  }
  .mobile-header {
    position: relative;
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: space-between;
    box-sizing: border-box;
    height: calc(52px + var(--mobile-safe-top));
    padding: var(--mobile-safe-top) var(--mobile-actions-right) 0 12px;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--surface-navigation);
  }
  .mobile-brand {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    color: var(--text-primary);
    font-size: 17px;
    font-weight: 700;
  }
  .icon-button {
    width: 40px;
    height: 40px;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-primary);
    font-size: 22px;
    line-height: 40px;
  }
  .mobile-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .mobile-account-trigger {
    width: 44px;
    height: 44px;
    margin: 0;
    padding: 7px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    line-height: 30px;
  }
  .mobile-account-trigger image {
    display: block;
    width: 30px;
    height: 30px;
    border-radius: 50%;
  }
  .mobile-add-symbol {
    font-size: 28px;
    font-weight: 300;
    line-height: 40px;
  }
  .mobile-account-menu {
    position: absolute;
    z-index: 60;
    top: calc(48px + var(--mobile-safe-top));
    right: var(--mobile-actions-right);
    width: 180px;
    padding: 6px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--surface-elevated);
    box-shadow: 0 10px 30px rgba(61, 50, 41, 0.16);
  }
  .mobile-account-menu button {
    display: flex;
    box-sizing: border-box;
    width: 100%;
    min-height: 38px;
    margin: 0;
    padding: 8px 10px;
    align-items: center;
    border: 0;
    background: transparent;
    color: var(--text-primary);
    font-size: 13px;
    gap: 8px;
    line-height: 18px;
    text-align: left;
  }
  .chat-scroll {
    padding: 20px 14px 10px;
  }
  .message-column {
    max-width: calc(100vw - 74px);
  }
  .message-avatar {
    display: none;
  }
  .message-row {
    gap: 0;
  }
  .chat-input-area {
    padding: 0 18px calc(24px + env(safe-area-inset-bottom));
  }
  .chat-input-area.empty {
    justify-content: flex-start;
    padding-top: 52px;
    padding-bottom: calc(32px + env(safe-area-inset-bottom));
  }
  .ai-agent-intro {
    padding: 0 2px 6px;
  }
  .ai-agent-label {
    margin-bottom: 14px;
  }
  .ai-agent-title {
    margin-bottom: 9px;
    font-size: 26px;
    line-height: 1.28;
  }
  .ai-agent-description {
    font-size: 14px;
    line-height: 22px;
  }
  .suggestions {
    gap: 8px;
  }
  .composer {
    min-height: 72px;
    padding: 8px 11px 8px 18px;
  }
  .composer.home-composer {
    height: 88px;
    min-height: 88px;
    padding: 0 12px 0 18px;
  }
}
</style>
