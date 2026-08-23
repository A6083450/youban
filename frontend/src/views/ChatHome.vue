<template>
  <div class="chat-home">
    <div v-show="items.length > 0" class="chat-scroll">
      <BubbleList
        ref="bubbleListRef"
        class="thread"
        :list="items"
        item-key="id"
        max-height="100%"
        :auto-scroll="true"
        :show-back-button="true"
        :smooth-scroll="false"
        @scroll-state-change="handleConversationScroll"
      >
        <template #item="{ item }">
          <Bubble
            class="chat-bubble"
            :class="`role-${item.role}`"
            :placement="item.role === 'user' ? 'end' : 'start'"
            :variant="item.role === 'user' ? 'filled' : 'outlined'"
            :loading="item.type === 'typing'"
            :no-style="isStructuredItem(item)"
            max-width="min(680px, calc(100vw - 96px))"
          >
            <template #avatar>
              <span class="bubble-avatar" :class="item.role" aria-hidden="true">
                <UserFilled v-if="item.role === 'user'" />
                <Compass v-else />
              </span>
            </template>
            <template #header>
              <span class="msg-name">{{ item.role === 'assistant' ? t('chatHome.assistantName') : t('chatHome.userName') }}</span>
            </template>
            <template #content>
              <div v-if="item.type === 'text' && item.role === 'user'" class="user-message">{{ item.text }}</div>
              <div v-else-if="item.type === 'text' || item.type === 'draft'" class="assistant-message">
                <MarkdownRenderer
                  class="assistant-markdown"
                  :markdown="item.text"
                  :allow-html="false"
                  :enable-shiki="false"
                  :enable-mermaid="false"
                  :style="markdownStyle"
                />
                <div
                  v-if="item.type === 'draft' && canActOnDraft(item)"
                  class="draft-actions"
                  :aria-label="t('composer.draftActions')"
                >
                  <button
                    type="button"
                    class="draft-action primary"
                    :disabled="busy"
                    @click="generateDetailedTrip(item)"
                  >
                    <CircleCheckFilled aria-hidden="true" />
                    <span>{{ t('composer.generateDetailed') }}</span>
                  </button>
                  <button
                    type="button"
                    class="draft-action"
                    :disabled="busy"
                    @click="adjustTripDraft"
                  >
                    <EditPen aria-hidden="true" />
                    <span>{{ t('composer.adjustDraft') }}</span>
                  </button>
                </div>
              </div>
              <div v-else-if="item.type === 'streaming'" class="streaming-message" aria-live="polite">
                <MarkdownRenderer
                  v-if="item.text"
                  class="assistant-markdown"
                  :markdown="item.text"
                  :allow-html="false"
                  :enable-shiki="false"
                  :enable-mermaid="false"
                  :style="markdownStyle"
                />
                <span v-if="item.text" class="stream-caret" aria-hidden="true"></span>
                <span v-else class="stream-wait">{{ t('composer.parsing') }}</span>
              </div>
              <WorkProgress
                v-else-if="item.type === 'progress'"
                class="progress-wrap"
                :visible="item.status.visible"
                :progress="item.status.progress"
                :message="item.status.message"
                :stage="item.status.stage"
                :details="item.status.details"
              />
              <TripGenerationFailure
                v-else-if="item.type === 'failed'"
                :task-id="item.taskId"
                :city="item.city"
                :date-range="item.dateRange"
                :error="item.error"
                :checkpoint-summary="item.checkpointSummary"
                :loading="generating"
                @retry="retryFailedItem(item, false)"
                @restart-all="retryFailedItem(item, true)"
              />
              <div
                v-else-if="item.type === 'done'"
                class="done-card"
                role="button"
                tabindex="0"
                @click="openPlan(item.planId)"
                @keydown.enter="openPlan(item.planId)"
              >
                <div class="done-title"><CircleCheckFilled aria-hidden="true" />{{ t('chatHome.doneTitle') }}</div>
                <div class="done-desc">{{ item.city }} · {{ item.days }}{{ t('composer.daysUnit') }} · {{ t('chatHome.doneCta') }}</div>
              </div>
            </template>
          </Bubble>
        </template>
      </BubbleList>
    </div>

    <!-- 输入区(空态时整体居中,含欢迎语) -->
    <div
      class="chat-input-area"
      :class="{
        'is-empty': items.length === 0,
        'has-ongoing': items.length === 0 && ongoingPlans.length > 0,
      }"
    >
      <div v-if="items.length === 0 && ongoingPlans.length" class="ongoing-banner">
        <button
          v-for="p in ongoingPlans"
          :key="p.plan_id"
          type="button"
          class="ongoing-card"
          @click="openOngoing(p)"
        >
          <span class="ongoing-card-main">
            <span class="ongoing-badge">{{ t('chatHome.ongoingBadge') }}</span>
            <span class="ongoing-title">{{ p.city }}</span>
          </span>
          <span class="ongoing-card-footer">
            <span class="ongoing-day">{{ t('chatHome.ongoingDay', { day: ongoingDayNumber(p) }) }}</span>
            <span class="ongoing-cta">{{ t('chatHome.ongoingCta') }} <span aria-hidden="true">→</span></span>
          </span>
        </button>
      </div>
      <Welcome
        v-if="items.length === 0"
        class="welcome"
        :title="t('chatHome.title')"
        :description="t('chatHome.desc')"
      />
      <PlanComposer ref="composerRef" :disabled="busy" @send="handleUserSend" />
      <div v-if="items.length === 0" class="suggestions">
        <Prompts :items="promptItems" wrap @item-click="handlePromptClick" />
        <button
          type="button"
          class="suggestion-refresh"
          :aria-label="t('chatHome.refreshSuggestions')"
          @click="refreshSuggestions"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          <span>{{ t('chatHome.refreshSuggestions') }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { message } from 'ant-design-vue'
import { Bubble, BubbleList, Prompts, Welcome } from 'vue-element-plus-x'
import { CircleCheckFilled, Compass, EditPen, UserFilled } from '@element-plus/icons-vue'
import { MarkdownRenderer } from 'x-markdown-vue'
import dayjs from 'dayjs'
import PlanComposer from '@/components/PlanComposer.vue'
import TripGenerationFailure from '@/components/TripGenerationFailure.vue'
import WorkProgress from '@/components/WorkProgress.vue'
import {
  ConversationSessionRevisionConflictError,
  confirmTripReplyStream,
  createConversation,
  generateTripPlan,
  getConversationSession,
  parseTripTextStream,
  retryTripPlan,
  updateConversationSession,
  watchTripTask,
} from '@/services/api'
import { getCurrentLocale } from '@/i18n'
import { notifyPlansUpdated, plans, refreshPlans } from '@/stores/plans'
import { currentUser, registerBeforeAuthTransition } from '@/stores/auth'
import { clearActiveTripTask, readActiveTripTask, saveActiveTripTask } from '@/stores/activeTripTask'
import {
  createOptimisticConversationRecord,
  notifyRecordsUpdated,
  removeRecord,
  upsertRecord,
  waitForConversationTitle,
} from '@/stores/conversation-records'
import { buildTripPlanRequest, orchestrateConfirmationReply, shouldClearActiveTask } from '@/utils/confirmationOrchestration.js'
import { buildConversationHistory } from '@/utils/conversationHistory.js'
import { formatChatDraft, migrateLegacyDraftItems, shouldShowDraftActions } from '@/utils/chatDraft.js'
import {
  acceptConversationRevision,
  activeTaskFromConversation,
  captureConversationOperation,
  captureConversationPersistence,
  ConversationPersistenceQueue,
  conversationPersistenceStorageKey,
  conversationPersistenceStoragePrefix,
  conversationSelectionAction,
  createConversationIdentity,
  firstUserMessage,
  isConversationOperationCurrent,
  isCurrentConversationSelection,
  isLegacyImportEligible,
  legacyImportFollowUp,
  legacyImportMarkerKey,
  mergeRestoredActiveTask,
  normalizeServerSnapshot,
  pendingSubmissionItemId,
  parseConversationPersistenceEnvelope,
  persistConversationFallback,
  queryConversationId,
  reserveConversationId,
  resetConversationIdentity,
  toServerSnapshot,
  type ChatSessionSnapshot,
  type ConversationOperationContext,
  type ConversationPersistenceCapture,
  type PendingConversationSubmission,
  type SnapshotItem,
} from '@/utils/conversationSession'
import { attachConversationSession, beginGenerationRetry, buildArchivedConversation, NEW_PLAN_EVENT } from '@/utils/planConversation.js'
import type { PlanGenerationOutcome } from '@/utils/confirmationOrchestration.js'
import type { ChatMessage, ConversationSessionDetail, ParsedTripDraft, TripCheckpointSummary, TripConfirmReplyResponse, TripHistoryItem, TripParseApiResponse, TripPlanResponse, TripTaskDetail, TripTaskEvent, TripTaskStage } from '@/types'

interface WorkProgressStatus {
  visible: boolean
  progress: number
  message: string
  stage: TripTaskStage
  details: TripTaskDetail[]
}

type ChatItemData =
  | { role: 'user'; type: 'text'; text: string }
  | { role: 'assistant'; type: 'text'; text: string }
  | { role: 'assistant'; type: 'typing' }
  | { role: 'assistant'; type: 'streaming'; text: string }
  | { role: 'assistant'; type: 'draft'; text: string; draft: ParsedTripDraft; ready: boolean }
  | { role: 'assistant'; type: 'progress'; status: WorkProgressStatus }
  | {
      role: 'assistant'
      type: 'failed'
      taskId: string
      city: string
      dateRange?: string
      error: string
      checkpointSummary?: TripCheckpointSummary
    }
  | { role: 'assistant'; type: 'done'; planId: string; city: string; days: number }

type ChatItem = ChatItemData & { id: number }

const { t, tm } = useI18n()
const router = useRouter()
const route = useRoute()

// 行程期内(status=completed 且今日落在 start~end 之间)的进行中计划,首页空态直达今日视图
const ongoingPlans = computed(() => {
  const today = dayjs().format('YYYY-MM-DD')
  return plans.value.filter(
    (p) => p.status === 'completed' && p.start_date && p.end_date && p.start_date <= today && p.end_date >= today,
  )
})
const ongoingDayNumber = (p: TripHistoryItem) => dayjs().diff(dayjs(p.start_date), 'day') + 1
const openOngoing = (p: TripHistoryItem) => {
  router.push({ path: `/plan/${p.plan_id}`, query: { section: 'today' } })
}

const composerRef = ref<InstanceType<typeof PlanComposer> | null>(null)
const bubbleListRef = ref<{ scrollToBottom: (smooth?: boolean) => void } | null>(null)
const followingLatest = ref(true)
const previousScrollRestoration = typeof window !== 'undefined' && 'scrollRestoration' in window.history
  ? window.history.scrollRestoration
  : null
if (previousScrollRestoration !== null) {
  window.history.scrollRestoration = 'manual'
}
const items = ref<ChatItem[]>([])
const markdownStyle = {
  backgroundColor: 'transparent',
  color: 'var(--text-primary)',
  padding: '0',
}
const busy = ref(false)
const generating = ref(false)
let operationToken = 0
let isAlive = true

const userId = () => currentUser.value?.user_id || 'anonymous'
const beginOperation = (): ConversationOperationContext => captureConversationOperation({
  token: ++operationToken,
  ownerId: userId(),
  sessionId: conversationIdentity.sessionId,
})
const ownsOperation = (context: ConversationOperationContext): boolean =>
  isConversationOperationCurrent(context, {
    token: operationToken,
    ownerId: userId(),
    sessionId: conversationIdentity.sessionId,
    alive: isAlive,
  })
const invalidateOperations = (): void => { operationToken += 1 }
// 当前行程草稿的对话锚点:不完整时指向追问消息,完整时指向带操作按钮的草稿消息
const pendingConfirmId = ref<number | null>(null)
const pendingDraft = ref<ParsedTripDraft | null>(null)
const pendingReadinessToken = ref('')
// 正在等待流式回复的用户消息;刷新时若非空,说明回复被打断,恢复后自动重发续上
const pendingUserText = ref<string | null>(null)
let nextId = 1
const conversationIdentity = reactive(createConversationIdentity())
let conversationFirstMessage = ''
let restoreRequestToken = 0
let routeRestoreReady = false
let pendingSubmission: PendingConversationSubmission | null = null

// 首页示例建议:从 i18n 候选池里随机抽取一批展示,点"换一批"轮换,避免每次进入都是同一组。
// 待 mem0 记忆架构落地后,改为按用户历史偏好个性化推荐,新用户仍回退到此热门列表。
const SUGGESTION_BATCH = 5

const suggestionPool = computed<string[]>(() => {
  const list = (tm as (key: string) => unknown)('chatHome.suggestions')
  return Array.isArray(list) ? (list as string[]) : []
})

const suggestions = ref<string[]>([])

const promptItems = computed(() => suggestions.value.map((suggestion) => ({
  key: suggestion,
  label: suggestion,
})))

const isStructuredItem = (item: ChatItem): boolean =>
  item.type === 'progress' || item.type === 'failed' || item.type === 'done'

const shuffle = (arr: string[]): string[] => {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const refreshSuggestions = () => {
  const pool = suggestionPool.value
  if (pool.length <= SUGGESTION_BATCH) {
    suggestions.value = [...pool]
    return
  }
  const prevKey = suggestions.value.join('|')
  let next = shuffle(pool).slice(0, SUGGESTION_BATCH)
  // 最多重试几次,确保"换一批"后展示内容确实变化(而非偶然抽到同一组)
  for (let i = 0; i < 8 && next.join('|') === prevKey; i++) {
    next = shuffle(pool).slice(0, SUGGESTION_BATCH)
  }
  suggestions.value = next
}

// 初次进入随机抽一批;语言切换导致候选池变化时也重新抽取
watch(suggestionPool, refreshSuggestions, { immediate: true })

const fillSuggestion = (text: string) => {
  composerRef.value?.setText(text)
  composerRef.value?.focus()
}

const handlePromptClick = (item: { label?: string }) => fillSuggestion(item.label || '')

const scrollToBottom = (force = false) => {
  if (!force && !followingLatest.value) return
  nextTick(() => {
    requestAnimationFrame(() => {
      bubbleListRef.value?.scrollToBottom(false)
    })
  })
}

const handleConversationScroll = (state: string) => {
  followingLatest.value = state === 'AT_BOTTOM'
}

const pushItem = (item: ChatItemData & { id?: number }): number => {
  const id = item.id ?? nextId++
  items.value.push({ ...item, id } as ChatItem)
  scrollToBottom()
  return id
}

const replaceItem = (id: number, item: ChatItemData) => {
  const idx = items.value.findIndex((i) => i.id === id)
  if (idx !== -1) {
    items.value[idx] = { ...item, id } as ChatItem
  }
  scrollToBottom()
}

const removeItem = (id: number) => {
  const idx = items.value.findIndex((i) => i.id === id)
  if (idx !== -1) {
    items.value.splice(idx, 1)
  }
}

const stageText = (stage: TripTaskStage) => {
  if (stage === 'attraction_search') return t('home.loading.searchingAttractions')
  if (stage === 'weather_search') return t('home.loading.queryingWeather')
  if (stage === 'hotel_search') return t('home.loading.recommendingHotels')
  if (stage === 'planning' || stage === 'reviewing' || stage === 'graph_building') return t('home.loading.generatingPlan')
  if (stage === 'completed') return t('home.loading.done')
  return t('home.loading.initializing')
}

// ─── 对话会话持久化:本地兼容缓存 + 服务端 revision 快照 ───
const chatSessionStorageKey = (ownerId = userId()): string => `tripstar.chat_session.${ownerId}`

const removeLegacyChatSnapshot = (ownerId: string): void => {
  try { localStorage.removeItem(chatSessionStorageKey(ownerId)) } catch { /* ignore */ }
}

const buildChatSnapshot = (): ChatSessionSnapshot => toServerSnapshot(
  items.value as SnapshotItem[],
  {
    pendingConfirmId: pendingConfirmId.value,
    pendingDraft: pendingDraft.value,
    pendingReadinessToken: pendingReadinessToken.value,
    pendingUserText: pendingUserText.value,
    nextId,
  },
)

const readPersistedConversationCaptures = (ownerId: string): ConversationPersistenceCapture[] => {
  try {
    const prefix = conversationPersistenceStoragePrefix(ownerId)
    const captures: ConversationPersistenceCapture[] = []
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key?.startsWith(prefix)) continue
      const raw = localStorage.getItem(key)
      const capture = raw ? parseConversationPersistenceEnvelope(raw, ownerId) : null
      if (capture) captures.push(capture)
    }
    return captures
  } catch {
    return []
  }
}

const removePersistedConversationCapture = (capture: ConversationPersistenceCapture): void => {
  if (!capture.sessionId) return
  try {
    localStorage.removeItem(conversationPersistenceStorageKey(capture.ownerId, capture.sessionId))
  } catch { /* ignore */ }
}

const persistLocalChatSession = (capture = captureCurrentPersistence()) => {
  try {
    // 旧键只保存尚无服务端身份的草稿;任何 durable 写入都会再次退役它。
    persistConversationFallback(localStorage, chatSessionStorageKey(capture.ownerId), capture)
  } catch { /* 存储不可用时静默降级 */ }
}

let suppressChatPersistence = false

const applyChatSnapshot = (snapshot: ChatSessionSnapshot) => {
  suppressChatPersistence = true
  items.value = migrateLegacyDraftItems(snapshot.items, getCurrentLocale())
    .map((item) => ({ ...item })) as ChatItem[]
  nextId = Math.max(snapshot.nextId || 0, ...items.value.map((item) => item.id + 1), 1)
  pendingDraft.value = snapshot.pendingDraft as ParsedTripDraft | null
  pendingReadinessToken.value = snapshot.pendingReadinessToken
  pendingUserText.value = snapshot.pendingUserText
  const hasDraftAnchor = snapshot.pendingConfirmId != null
    && items.value.some((item) => item.id === snapshot.pendingConfirmId && (item.type === 'text' || item.type === 'draft'))
  pendingConfirmId.value = hasDraftAnchor ? snapshot.pendingConfirmId : null
  scrollToBottom()
  nextTick(() => { suppressChatPersistence = false })
}

const applyConversationDetail = (detail: ConversationSessionDetail): ChatSessionSnapshot | null => {
  const snapshot = normalizeServerSnapshot(detail.snapshot)
  if (!snapshot) return null
  if (!acceptConversationRevision(conversationIdentity, detail.session_id || '', detail.revision)) return null
  conversationFirstMessage = firstUserMessage(snapshot)
  applyChatSnapshot(snapshot)
  upsertRecord(detail)
  return snapshot
}

const writeConversationPersistence = async (
  capture: ReturnType<typeof captureConversationPersistence>,
) => {
  persistLocalChatSession(capture)
  const { ownerId, sessionId, snapshot } = capture
  if (!sessionId) return
  try {
    const updated = await updateConversationSession(
      sessionId,
      { revision: capture.revision, snapshot },
      ownerId,
    )
    if (userId() === ownerId && conversationIdentity.sessionId === sessionId) {
      acceptConversationRevision(conversationIdentity, sessionId, updated.revision)
      upsertRecord(updated)
    }
    removePersistedConversationCapture(capture)
    return { revision: updated.revision }
  } catch (error: unknown) {
    if (error instanceof ConversationSessionRevisionConflictError) {
      try {
        const current = await getConversationSession(sessionId, ownerId)
        if (userId() === ownerId && conversationIdentity.sessionId === sessionId) {
          applyConversationDetail(current)
        }
        removePersistedConversationCapture(capture)
        return { revision: current.revision, discardPendingForSession: true }
      } catch {
        return { retryPending: true }
      }
    }
    return { retryPending: true }
  }
}

const persistenceQueue = new ConversationPersistenceQueue(writeConversationPersistence)
for (const capture of readPersistedConversationCaptures(userId())) {
  persistenceQueue.schedule(capture)
}

function captureCurrentPersistence() {
  return captureConversationPersistence({
    ownerId: userId(),
    sessionId: conversationIdentity.sessionId,
    revision: conversationIdentity.revision,
    snapshot: buildChatSnapshot(),
  })
}

const persistSoon = () => {
  if (suppressChatPersistence) return
  persistenceQueue.schedule(captureCurrentPersistence())
}

const flushCurrentPersistence = async (): Promise<boolean> => {
  if (!suppressChatPersistence) persistenceQueue.schedule(captureCurrentPersistence())
  return persistenceQueue.flush()
}

const unregisterBeforeAuthTransition = registerBeforeAuthTransition(flushCurrentPersistence)

const clearChatSession = (options: { preserveLocal?: boolean } = {}) => {
  suppressChatPersistence = true
  restoreRequestToken += 1
  if (!options.preserveLocal) {
    removeLegacyChatSnapshot(userId())
  }
  if (!conversationIdentity.sessionId && conversationIdentity.pendingSessionId) {
    removeRecord(conversationIdentity.pendingSessionId)
  }
  resetConversationIdentity(conversationIdentity)
  conversationFirstMessage = ''
  pendingSubmission = null
}

const readChatSession = (): ChatSessionSnapshot | null => {
  try {
    const raw = localStorage.getItem(chatSessionStorageKey())
    if (!raw) return null
    return normalizeServerSnapshot(JSON.parse(raw))
  } catch {
    return null
  }
}

// 逐字流式:把增量文本写进对应的 streaming 气泡
const setStreamingText = (id: number, text: string) => {
  const idx = items.value.findIndex((i) => i.id === id)
  if (idx !== -1 && items.value[idx].type === 'streaming') {
    ;(items.value[idx] as Extract<ChatItem, { type: 'streaming' }>).text = text
    scrollToBottom()
  }
}

// 后端每次事件携带的 details 是全量累积列表，直接替换避免重复
const applyTaskEvent = (status: WorkProgressStatus, event: TripTaskEvent) => {
  if (Number.isFinite(event.progress)) {
    status.progress = Math.max(0, Math.min(100, event.progress))
  }
  status.message = event.message || stageText(event.stage)
  status.stage = event.stage
  if (event.details?.length) {
    status.details = [...event.details]
  }
  scrollToBottom()
}

const formatDateRange = (startDate?: string, endDate?: string): string | undefined =>
  startDate && endDate ? `${startDate} ${t('common.to')} ${endDate}` : undefined

const failedItem = (
  taskId: string,
  city: string,
  dateRange: string | undefined,
  error: unknown,
  event?: TripTaskEvent,
  checkpointSummary?: TripCheckpointSummary,
): ChatItemData => ({
  role: 'assistant',
  type: 'failed',
  taskId,
  city,
  dateRange: dateRange || formatDateRange(
    event?.request_payload?.start_date,
    event?.request_payload?.end_date,
  ),
  error: event?.error || (error instanceof Error ? error.message : '') || t('home.messages.generateRetry'),
  checkpointSummary: event?.checkpoint_summary || checkpointSummary,
})

const openPlan = (planId: string) => {
  if (!planId) return
  router.push(`/plan/${planId}`)
}

const focusFailedCard = (taskId: string, context: ConversationOperationContext) => nextTick(() => {
  if (!ownsOperation(context)) return
  document.getElementById(`trip-failure-${taskId}`)?.querySelector<HTMLButtonElement>('button')?.focus()
})

const handlePlanResponse = async (
  response: TripPlanResponse,
  progressId: number,
  context: ConversationOperationContext,
): Promise<boolean> => {
  if (!ownsOperation(context)) return false
  const planId = String(response.plan_id || '').trim()
  if (response.success && response.data && planId) {
    sessionStorage.setItem('tripPlan', JSON.stringify(response.data))
    sessionStorage.setItem('planId', planId)
    message.success(t('home.messages.generateSuccess'))
    notifyPlansUpdated()
    replaceItem(progressId, {
      role: 'assistant',
      type: 'done',
      planId,
      city: response.data.city,
      days: response.data.days.length,
    })
    const persisted = await flushCurrentPersistence()
    if (!ownsOperation(context)) return false
    generating.value = false
    busy.value = false
    clearChatSession({ preserveLocal: !persisted })
    notifyRecordsUpdated()
    void router.push(`/plan/${planId}`)
    return true
  } else {
    replaceItem(progressId, {
      role: 'assistant',
      type: 'text',
      text: response.success ? t('home.messages.generateFailed') : (response.message || t('home.messages.generateFailed')),
    })
    return false
  }
}

const clearPlanResultSession = () => {
  sessionStorage.removeItem('tripPlan')
  sessionStorage.removeItem('graphData')
  sessionStorage.removeItem('planId')
}

const resetConversation = async () => {
  invalidateOperations()
  restoreRequestToken += 1
  generating.value = false
  busy.value = false
  const persisted = await flushCurrentPersistence()
  clearChatSession({ preserveLocal: !persisted })
  items.value = []
  pendingConfirmId.value = null
  pendingDraft.value = null
  pendingReadinessToken.value = ''
  pendingUserText.value = null
  nextId = 1
  composerRef.value?.setText('')
  clearPlanResultSession()
  nextTick(() => {
    suppressChatPersistence = false
  })
}

// 页面刷新后:若存在进行中任务,重建对话并重连订阅(后端会先推送当前快照)
const resumeActiveTask = async (expectedTaskId = '') => {
  const ownerId = userId()
  const record = readActiveTripTask(ownerId)
  if (!record) return
  if (expectedTaskId && record.taskId !== expectedTaskId) return
  if (record.sessionId && record.sessionId !== conversationIdentity.sessionId) return

  const context = beginOperation()
  const restoredFailure = items.value.find(
    (item): item is Extract<ChatItem, { type: 'failed' }> =>
      item.type === 'failed' && item.taskId === record.taskId,
  )
  const hasContext = items.value.length > 0
  if (!hasContext && record.userText) {
    pushItem({ role: 'user', type: 'text', text: record.userText })
  }
  if (!hasContext) {
    pushItem({ role: 'assistant', type: 'text', text: t('chatHome.resumeNotice') })
  }

  generating.value = true
  busy.value = true
  const status = reactive<WorkProgressStatus>({
    visible: true,
    progress: 5,
    message: t('home.loading.initializing'),
    stage: 'submitted',
    details: [],
  })
  const progressId = restoredFailure?.id
    ?? pushItem({ role: 'assistant', type: 'progress', status })
  if (restoredFailure) replaceItem(progressId, { role: 'assistant', type: 'progress', status })
  let lastTaskEvent: TripTaskEvent | undefined

  try {
    const response = await watchTripTask(record.taskId, {
      onTaskEvent: (event) => {
        if (!ownsOperation(context)) return
        lastTaskEvent = event
        applyTaskEvent(status, event)
      },
    })
    if (await handlePlanResponse(response, progressId, context)) {
      clearActiveTripTask(record.taskId, ownerId)
      notifyRecordsUpdated()
    }
  } catch (error: unknown) {
    if (!ownsOperation(context)) return
    replaceItem(progressId, failedItem(
      record.taskId,
      record.city,
      formatDateRange(record.startDate, record.endDate),
      error,
      lastTaskEvent,
      restoredFailure?.checkpointSummary,
    ))
    notifyPlansUpdated()
    notifyRecordsUpdated()
  } finally {
    if (ownsOperation(context)) {
      generating.value = false
      busy.value = false
    }
  }
}

// 刷新后恢复整段对话;若上次回复被打断,自动重发续上
const retryFailedItem = async (
  item: Extract<ChatItem, { type: 'failed' }>,
  restartAll: boolean,
) => {
  if (generating.value) return

  const ownerId = userId()
  const activeTaskIdAtClick = readActiveTripTask(ownerId)?.taskId ?? null
  const context = beginOperation()
  generating.value = true
  busy.value = true
  const status = reactive<WorkProgressStatus>({
    visible: true,
    progress: 5,
    message: t('home.loading.initializing'),
    stage: 'submitted',
    details: [],
  })
  let lastTaskEvent: TripTaskEvent | undefined

  try {
    const task = await beginGenerationRetry(item.taskId, restartAll, {
      retry: retryTripPlan,
      notifyRecordsUpdated,
    })
    if (task.task_id !== item.taskId) {
      throw new Error(t('home.messages.generateRetry'))
    }
    if (!ownsOperation(context)) return
    const currentActiveTaskId = readActiveTripTask(ownerId)?.taskId ?? null
    const canClaimActive = currentActiveTaskId === null
      || currentActiveTaskId === item.taskId
      || currentActiveTaskId === activeTaskIdAtClick
    if (canClaimActive) {
      const [startDate, endDate] = item.dateRange?.match(/\d{4}-\d{2}-\d{2}/g) ?? []
      saveActiveTripTask({
        taskId: task.task_id,
        sessionId: context.sessionId || undefined,
        city: item.city,
        days: startDate && endDate ? dayjs(endDate).diff(dayjs(startDate), 'day') + 1 : 0,
        userText: '',
        startDate,
        endDate,
      }, ownerId)
    }
    if (!ownsOperation(context)) return
    if (!canClaimActive) throw new Error(t('home.messages.generateRetry'))
    replaceItem(item.id, { role: 'assistant', type: 'progress', status })
    await flushCurrentPersistence()
    if (!ownsOperation(context)) return
    const response = await watchTripTask(item.taskId, {
      onTaskEvent: (event) => {
        if (!ownsOperation(context)) return
        lastTaskEvent = event
        applyTaskEvent(status, event)
      },
    }, task.ws_url)
    if (await handlePlanResponse(response, item.id, context)) {
      clearActiveTripTask(item.taskId, ownerId)
      notifyRecordsUpdated()
    }
  } catch (error: unknown) {
    if (!ownsOperation(context)) return
    replaceItem(item.id, failedItem(
      item.taskId,
      item.city,
      item.dateRange,
      error,
      lastTaskEvent,
      item.checkpointSummary,
    ))
    notifyPlansUpdated()
    notifyRecordsUpdated()
    focusFailedCard(item.taskId, context)
  } finally {
    if (ownsOperation(context)) {
      generating.value = false
      busy.value = false
    }
  }
}

const resumeInterruptedSnapshot = (snapshot: ChatSessionSnapshot) => {
  if (!snapshot.pendingUserText || readActiveTripTask(userId())) return
  const text = snapshot.pendingUserText
  const lastUser = [...items.value].reverse().find((item) => item.role === 'user' && item.type === 'text')
  const lastUserId = lastUser?.id ?? pushItem({ role: 'user', type: 'text', text })
  if (pendingConfirmId.value !== null && pendingDraft.value) {
    void handlePendingReply(text, pendingConfirmId.value, pendingDraft.value, lastUserId)
  } else {
    void runParseStream(text, lastUserId)
  }
}

const updateConversationRoute = (sessionId: string) => {
  if (queryConversationId(route.query.conversation) === sessionId) return
  void router.replace({ path: '/', query: { ...route.query, conversation: sessionId } })
}

const ensureServerConversation = async (firstMessageText: string): Promise<boolean> => {
  if (conversationIdentity.sessionId) return true
  const ownerId = userId()
  const requestOperationToken = operationToken
  const snapshot = buildChatSnapshot()
  const sessionId = reserveConversationId(conversationIdentity)
  conversationFirstMessage ||= firstUserMessage(snapshot) || firstMessageText.trim()
  createOptimisticConversationRecord({
    sessionId,
    title: t('sidebar.newConversation'),
    userId: userId(),
  })

  try {
    const created = await createConversation({
      session_id: sessionId,
      first_message: conversationFirstMessage,
      snapshot,
    })
    if (operationToken !== requestOperationToken
      || userId() !== ownerId
      || conversationIdentity.pendingSessionId !== sessionId) return false
    if (!acceptConversationRevision(conversationIdentity, sessionId, created.revision)) return false
    removeLegacyChatSnapshot(ownerId)
    upsertRecord(created)
    pendingSubmission = null
    persistSoon()
    notifyRecordsUpdated()
    updateConversationRoute(sessionId)
    void waitForConversationTitle(sessionId)
    return true
  } catch (error: unknown) {
    if (operationToken !== requestOperationToken
      || userId() !== ownerId
      || conversationIdentity.pendingSessionId !== sessionId) return false
    message.error(error instanceof Error ? error.message : '对话记录保存失败，请重试')
    return false
  }
}

const restoreServerConversation = async (sessionId: string): Promise<void> => {
  const ownerId = userId()
  const requestToken = ++restoreRequestToken
  const persistedCapture = readPersistedConversationCaptures(ownerId)
    .find((capture) => capture.sessionId === sessionId)
  invalidateOperations()
  generating.value = false
  busy.value = false
  const outgoingPersisted = await flushCurrentPersistence()
  if (requestToken !== restoreRequestToken || userId() !== ownerId) return
  try {
    const detail = await getConversationSession(sessionId)
    if (!isCurrentConversationSelection({
      expectedSessionId: sessionId,
      selectedSessionId: queryConversationId(route.query.conversation),
      expectedOwnerId: ownerId,
      currentOwnerId: userId(),
      requestToken,
      currentToken: restoreRequestToken,
    })) return
    if (!conversationIdentity.sessionId && conversationIdentity.pendingSessionId) {
      removeRecord(conversationIdentity.pendingSessionId)
    }
    resetConversationIdentity(conversationIdentity)
    pendingSubmission = null
    conversationIdentity.pendingSessionId = sessionId
    const snapshot = !outgoingPersisted && persistedCapture
      ? (() => {
          acceptConversationRevision(
            conversationIdentity,
            sessionId,
            persistedCapture.revision,
          )
          conversationFirstMessage = firstUserMessage(persistedCapture.snapshot)
          applyChatSnapshot(persistedCapture.snapshot)
          return persistedCapture.snapshot
        })()
      : applyConversationDetail(detail)
    if (!snapshot) return
    persistSoon()
    const restoredActiveTask = activeTaskFromConversation(detail)
    if (restoredActiveTask) {
      const localActiveTask = readActiveTripTask(ownerId)
      if (!localActiveTask
        || localActiveTask.taskId !== restoredActiveTask.taskId
        || localActiveTask.sessionId !== restoredActiveTask.sessionId) {
        saveActiveTripTask(mergeRestoredActiveTask(localActiveTask, restoredActiveTask), ownerId)
      }
      void resumeActiveTask(restoredActiveTask.taskId)
    } else {
      resumeInterruptedSnapshot(snapshot)
    }
  } catch (error: unknown) {
    if (requestToken === restoreRequestToken && userId() === ownerId) {
      message.error(error instanceof Error ? error.message : '读取对话记录失败')
    }
  }
}

const importLegacyConversation = async (): Promise<boolean> => {
  const snapshot = readChatSession()
  const markerKey = legacyImportMarkerKey(userId())
  let importMarked = false
  try { importMarked = localStorage.getItem(markerKey) === '1' } catch { /* ignore */ }
  if (!isLegacyImportEligible({
    activeSessionId: conversationIdentity.sessionId || '',
    importMarked,
    snapshot,
  }) || !snapshot) return false

  applyChatSnapshot(snapshot)
  const initialMessage = firstUserMessage(snapshot)
  if (!initialMessage) return false
  const retryText = snapshot.pendingUserText || initialMessage
  const retryItem = [...items.value].reverse().find(
    (item) => item.role === 'user' && item.type === 'text' && item.text === retryText,
  )
  if (retryItem) {
    pendingSubmission = {
      sessionId: reserveConversationId(conversationIdentity),
      itemId: retryItem.id,
      text: retryText,
    }
  }
  const created = await ensureServerConversation(initialMessage)
  const followUp = legacyImportFollowUp(created)
  if (followUp.markImported) {
    try { localStorage.setItem(markerKey, '1') } catch { /* ignore */ }
  }
  if (!followUp.resumeInterrupted) {
    composerRef.value?.setText(retryText)
    return true
  }
  if (readActiveTripTask(userId())) void resumeActiveTask()
  else resumeInterruptedSnapshot(snapshot)
  return true
}

const initializeConversationSelection = async (initial = true) => {
  const selected = queryConversationId(route.query.conversation)
  const activeTaskSessionId = readActiveTripTask(userId())?.sessionId || ''
  const action = conversationSelectionAction({
    selectedSessionId: selected,
    currentSessionId: conversationIdentity.sessionId || '',
    activeTaskSessionId,
    initial,
  })
  if (action.type === 'restore') {
    if (!selected) {
      updateConversationRoute(action.sessionId)
      return
    }
    await restoreServerConversation(action.sessionId)
    return
  }
  if (action.type === 'blank') {
    await resetConversation()
    return
  }
  if (action.type === 'resume-local' && !await importLegacyConversation()) void resumeActiveTask()
}

onMounted(() => {
  routeRestoreReady = true
  void initializeConversationSelection(true)
  if (!plans.value.length) void refreshPlans()
  window.addEventListener(NEW_PLAN_EVENT, resetConversation)
  // 浏览器滚动恢复与字体布局可能晚于首帧,短暂校正确保刷新也落在最新消息
  followingLatest.value = true
  for (const delay of [0, 120, 360]) {
    window.setTimeout(() => scrollToBottom(true), delay)
  }
})

onBeforeRouteLeave(async () => {
  await flushCurrentPersistence()
})

onUnmounted(() => {
  isAlive = false
  invalidateOperations()
  unregisterBeforeAuthTransition()
  window.removeEventListener(NEW_PLAN_EVENT, resetConversation)
  if (previousScrollRestoration !== null) {
    window.history.scrollRestoration = previousScrollRestoration
  }
  persistenceQueue.schedule(captureCurrentPersistence())
  void persistenceQueue.flush()
  restoreRequestToken += 1
})

// 对话状态变化后防抖落盘,供刷新恢复
watch([items, pendingConfirmId, pendingDraft, pendingReadinessToken, pendingUserText], persistSoon, { deep: true })
watch(() => route.query.conversation, (value) => {
  if (!routeRestoreReady) return
  const selected = queryConversationId(value)
  if (selected === conversationIdentity.sessionId) return
  void initializeConversationSelection(false)
})
watch(() => currentUser.value?.user_id, async () => {
  invalidateOperations()
  restoreRequestToken += 1
  await persistenceQueue.flush()
  if (!conversationIdentity.sessionId && conversationIdentity.pendingSessionId) {
    removeRecord(conversationIdentity.pendingSessionId)
  }
  resetConversationIdentity(conversationIdentity)
  conversationFirstMessage = ''
  generating.value = false
  busy.value = false
  suppressChatPersistence = true
  items.value = []
  pendingConfirmId.value = null
  pendingDraft.value = null
  pendingReadinessToken.value = ''
  pendingUserText.value = null
  nextId = 1
  nextTick(() => {
    suppressChatPersistence = false
    for (const capture of readPersistedConversationCaptures(userId())) {
      persistenceQueue.schedule(capture)
    }
    if (routeRestoreReady) void initializeConversationSelection(true)
  })
})
watch(() => items.value.length, (length) => {
  if (length > 0) scrollToBottom(true)
})

const clearPendingConfirm = () => {
  pendingConfirmId.value = null
  pendingDraft.value = null
  pendingReadinessToken.value = ''
}

// 给 agent 的最近对话历史:包含可见的路线草稿文本,排除本轮刚加入的用户消息
const getConversationHistory = (currentUserItemId: number) =>
  buildConversationHistory(items.value, currentUserItemId)

const formatAgentReply = (res: TripParseApiResponse): string => {
  const parts: string[] = []
  if (res.reply?.trim()) parts.push(res.reply.trim())
  if (res.action === 'recommend' && res.recommendations?.length) {
    const choices = res.recommendations.map((rec, index) => {
      const days = rec.suggested_days > 0 ? `（建议 ${rec.suggested_days} 天）` : ''
      return `${index + 1}. ${rec.destination}${days}：${rec.reason}`
    })
    parts.push(choices.join('\n'))
  }
  if (res.follow_up_question?.trim()) parts.push(res.follow_up_question.trim())
  return parts.filter(Boolean).join('\n\n') || res.clarify_question || t('composer.clarifyFallback')
}

const pushDraftMessage = (draft: ParsedTripDraft): number => pushItem({
  role: 'assistant',
  type: 'draft',
  text: formatChatDraft(draft, getCurrentLocale()),
  draft,
  ready: true,
})

const canActOnDraft = (item: ChatItem): boolean =>
  item.type === 'draft'
  && item.id === pendingConfirmId.value
  && shouldShowDraftActions(item.ready, pendingReadinessToken.value)

// 草稿对话期间的所有回复都交给后端 Agent 决策,前端只解释结构化 action
const handlePendingReply = async (
  text: string,
  cardId: number,
  draft: ParsedTripDraft,
  currentUserItemId: number
) => {
  const context = beginOperation()
  busy.value = true
  pendingUserText.value = text
  persistSoon()
  const streamId = pushItem({ role: 'assistant', type: 'streaming', text: '' })
  let acc = ''
  // 流式版 confirmReply:过程逐字更新气泡,拿到完整结构化结果后 resolve,
  // 仍交给编排逻辑决策确认、修改、取消和闲聊
  const streamingConfirmReply = (
    replyText: string,
    replyDraft: ParsedTripDraft,
    language: string,
    history: ChatMessage[],
    readinessToken: string
  ): Promise<TripConfirmReplyResponse> =>
    new Promise((resolve, reject) => {
      confirmTripReplyStream(replyText, replyDraft, language, history, readinessToken, {
        onDelta: (d) => {
          if (!ownsOperation(context)) return
          acc += d
          setStreamingText(streamId, acc)
        },
        onFinal: (payload) => resolve(payload),
        onError: (msg) => reject(new Error(msg)),
      }).catch(reject)
    })
  try {
    const result = await orchestrateConfirmationReply(
      {
        text,
        draft,
        cardId,
        language: getCurrentLocale(),
        history: getConversationHistory(currentUserItemId),
        readinessToken: pendingReadinessToken.value,
      },
      {
        confirmReply: streamingConfirmReply,
        generate: (confirmedDraft, executionToken) => onConfirmGenerate(
          confirmedDraft,
          executionToken,
          context,
        ),
      }
    )
    if (!ownsOperation(context)) return
    const { effect } = result

    if (effect.type === 'generate') {
      removeItem(streamId)
      clearPendingConfirm()
      if (result.pending) {
        pendingDraft.value = result.pending.draft
        pendingReadinessToken.value = result.pending.readinessToken
        const anchor = items.value.find((item) => item.id === result.pending?.cardId)
        pendingConfirmId.value = anchor?.type === 'draft'
          ? anchor.id
          : pushDraftMessage(result.pending.draft)
      }
    } else if (effect.type === 'update') {
      replaceItem(streamId, {
        role: 'assistant',
        type: 'text',
        text: effect.message || t('composer.clarifyFallback'),
      })
      pendingDraft.value = effect.draft
      pendingReadinessToken.value = effect.readinessToken
      pendingConfirmId.value = effect.readyToGenerate && effect.readinessToken
        ? pushDraftMessage(effect.draft)
        : streamId
    } else if (effect.type === 'cancel') {
      replaceItem(streamId, {
        role: 'assistant',
        type: 'text',
        text: effect.message || t('composer.canceled'),
      })
      clearPendingConfirm()
    } else {
      // chat / ask_confirmation:流式气泡定格为最终回复
      replaceItem(streamId, {
        role: 'assistant',
        type: 'text',
        text: effect.message || (effect.type === 'error'
          ? t('composer.parseFailed')
          : t('composer.clarifyFallback')),
      })
      const anchor = items.value.find((item) => item.id === cardId)
      if ('readinessToken' in effect) pendingReadinessToken.value = effect.readinessToken || ''
      if (effect.type === 'message'
        && effect.readyToGenerate
        && effect.readinessToken
        && pendingDraft.value) {
        pendingConfirmId.value = anchor?.type === 'draft' && anchor.ready
          ? anchor.id
          : pushDraftMessage(pendingDraft.value)
      } else if (anchor?.type !== 'draft') {
        pendingConfirmId.value = streamId
      }
    }
  } finally {
    if (ownsOperation(context)) {
      pendingUserText.value = null
      busy.value = false
      persistSoon()
    }
  }
}

// 解析需求/推荐/追问:流式打字机版。不在此 push 用户消息,便于刷新后对同一条
// 用户消息重新发起(自动重发续上)
const runParseStream = async (text: string, userItemId: number) => {
  const context = beginOperation()
  busy.value = true
  pendingUserText.value = text
  persistSoon()
  const streamId = pushItem({ role: 'assistant', type: 'streaming', text: '' })
  let acc = ''
  let finalRes: TripParseApiResponse | null = null
  let streamError = false
  try {
    const history = getConversationHistory(userItemId)
    await parseTripTextStream(text, getCurrentLocale(), history, {
      onDelta: (d) => {
        if (!ownsOperation(context)) return
        acc += d
        setStreamingText(streamId, acc)
      },
      onFinal: (res) => { finalRes = res },
      onError: () => { streamError = true },
    })
    if (!ownsOperation(context)) return
    if (streamError || !finalRes) throw new Error(t('composer.parseFailed'))
    const res: TripParseApiResponse = finalRes

    if (res.action === 'recommend' || res.action === 'chat' || res.action === 'clarify' || !res.trip) {
      // 逐字流出的是 reply;final 到达后补全为完整回复(含推荐列表/追问)
      replaceItem(streamId, { role: 'assistant', type: 'text', text: formatAgentReply(res) })
    } else {
      // 未完整时继续用普通对话追问;完整后再补一条带常驻操作的路线草稿消息
      replaceItem(streamId, { role: 'assistant', type: 'text', text: formatAgentReply(res) })
      pendingDraft.value = res.trip
      pendingReadinessToken.value = res.readiness_token || ''
      pendingConfirmId.value = res.ready_to_generate === true && pendingReadinessToken.value
        ? pushDraftMessage(res.trip)
        : streamId
    }
  } catch (error: any) {
    if (!ownsOperation(context)) return
    replaceItem(streamId, {
      role: 'assistant',
      type: 'text',
      text: error?.message || t('composer.parseFailed'),
    })
  } finally {
    if (ownsOperation(context)) {
      pendingUserText.value = null
      busy.value = false
      persistSoon()
    }
  }
}

const restoreComposerFocus = async (): Promise<void> => {
  await nextTick()
  if (!busy.value) composerRef.value?.focus()
}

const generateDetailedTrip = async (item: ChatItem) => {
  if (busy.value || item.type !== 'draft' || !canActOnDraft(item)) return
  followingLatest.value = true
  const command = t('composer.generateDetailed')
  const userItemId = pushItem({ role: 'user', type: 'text', text: command })
  try {
    await handlePendingReply(command, item.id, item.draft, userItemId)
  } finally {
    await restoreComposerFocus()
  }
}

const adjustTripDraft = async () => {
  followingLatest.value = true
  await nextTick()
  composerRef.value?.focus()
}

const handleUserSend = async (text: string) => {
  if (busy.value) return
  // 用户主动发送新消息时重新跟随最新对话
  followingLatest.value = true
  let userItemId: number
  if (!conversationIdentity.sessionId) {
    const pendingSessionId = reserveConversationId(conversationIdentity)
    const reusableItemId = pendingSubmissionItemId(pendingSubmission, text, pendingSessionId)
    const reusableItem = reusableItemId === null
      ? undefined
      : items.value.find((item) => item.id === reusableItemId && item.role === 'user' && item.type === 'text')
    userItemId = reusableItem?.id ?? pushItem({ role: 'user', type: 'text', text })
    pendingSubmission = { sessionId: pendingSessionId, itemId: userItemId, text }
  } else {
    userItemId = pushItem({ role: 'user', type: 'text', text })
  }

  if (!conversationIdentity.sessionId) {
    const submissionToken = operationToken
    const submissionOwnerId = userId()
    busy.value = true
    const created = await ensureServerConversation(text)
    if (submissionToken !== operationToken || submissionOwnerId !== userId()) return
    busy.value = false
    if (!created) {
      composerRef.value?.setText(text)
      await restoreComposerFocus()
      return
    }
  }

  // 有行程草稿时,优先继续同一段对话;完整草稿也可用气泡下方的显式操作
  try {
    if (pendingConfirmId.value !== null && pendingDraft.value) {
      await handlePendingReply(text, pendingConfirmId.value, pendingDraft.value, userItemId)
      return
    }

    await runParseStream(text, userItemId)
  } finally {
    await restoreComposerFocus()
  }
}

const onConfirmGenerate = async (
  draft: ParsedTripDraft,
  executionToken: string,
  context: ConversationOperationContext,
): Promise<PlanGenerationOutcome> => {
  if (!ownsOperation(context)) return { status: 'submit_failed' }
  if (generating.value) return { status: 'submit_failed' }
  const baseRequest = buildTripPlanRequest(draft, executionToken, getCurrentLocale())
  if (!baseRequest) {
    message.warning(t('home.messages.travelDaysTooLong'))
    return { status: 'submit_failed' }
  }
  const requestData = attachConversationSession(baseRequest, context.sessionId)
  requestData.conversation = buildArchivedConversation(items.value)
  const travelDays = requestData.travel_days
  const ownerId = context.ownerId

  generating.value = true
  busy.value = true
  const status = reactive<WorkProgressStatus>({
    visible: true,
    progress: 5,
    message: t('home.loading.initializing'),
    stage: 'submitted',
    details: [],
  })
  const progressId = pushItem({ role: 'assistant', type: 'progress', status })

  let createdTaskId = ''
  let lastTaskEvent: TripTaskEvent | undefined
  try {
    sessionStorage.removeItem('tripPlan')
    sessionStorage.removeItem('graphData')
    sessionStorage.removeItem('planId')
    await flushCurrentPersistence()
    if (!ownsOperation(context)) return { status: 'submit_failed' }

    const response = await generateTripPlan(requestData, {
      onTaskCreated: (task) => {
        if (!ownsOperation(context)) return
        // 拿到 task_id 立即落地,刷新页面后可恢复;并让侧栏立刻出现"生成中"的任务
        createdTaskId = task.task_id
        saveActiveTripTask({
          taskId: task.task_id,
          sessionId: context.sessionId || undefined,
          city: draft.city,
          days: travelDays,
          userText: draft.origin_text || draft.free_text_input || '',
          startDate: requestData.start_date,
          endDate: requestData.end_date,
        }, ownerId)
        notifyPlansUpdated()
        notifyRecordsUpdated()
      },
      onTaskEvent: (event) => {
        if (!ownsOperation(context)) return
        lastTaskEvent = event
        applyTaskEvent(status, event)
      },
    })

    const completed = await handlePlanResponse(response, progressId, context)
    const outcome: PlanGenerationOutcome = completed
      ? { status: 'completed' }
      : { status: 'watch_failed', taskId: createdTaskId }
    if (shouldClearActiveTask(outcome) && createdTaskId) {
      clearActiveTripTask(createdTaskId, ownerId)
    }
    return outcome
  } catch (error: unknown) {
    if (!ownsOperation(context)) return createdTaskId
      ? { status: 'watch_failed', taskId: createdTaskId }
      : { status: 'submit_failed' }
    replaceItem(progressId, createdTaskId
      ? failedItem(
          createdTaskId,
          draft.city,
          formatDateRange(requestData.start_date, requestData.end_date),
          error,
          lastTaskEvent,
        )
      : {
          role: 'assistant',
          type: 'text',
          text: error instanceof Error ? error.message : t('home.messages.generateRetry'),
        })
    notifyPlansUpdated()
    notifyRecordsUpdated()
    return createdTaskId
      ? { status: 'watch_failed', taskId: createdTaskId }
      : { status: 'submit_failed' }
  } finally {
    if (ownsOperation(context)) {
      generating.value = false
      busy.value = false
    }
  }
}
</script>

<style scoped>
.chat-home {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.chat-scroll {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 32px 24px 16px;
  display: flex;
  justify-content: center;
}

.chat-scroll:has(+ .chat-input-area.is-empty) {
  display: none;
}

.thread {
  width: 100%;
  max-width: 768px;
  min-height: 0;
}

:deep(.el-bubble-list) {
  height: 100%;
  padding: 0 4px;
}

:deep(.el-bubble-list-item) {
  padding-bottom: 14px;
}

.chat-bubble {
  width: 100%;
  animation: chat-msg-in 0.2s ease-out;
}

.chat-bubble.role-user {
  --elx-bubble-bg: var(--accent-primary);
  --elx-bubble-text-color: #fff;
}

.bubble-avatar {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: var(--text-secondary);
  background: var(--surface-soft);
}

.bubble-avatar.assistant {
  color: #fff;
  background: var(--accent-primary);
}

.bubble-avatar svg {
  width: 17px;
  height: 17px;
}

.user-message,
.streaming-message {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.assistant-markdown {
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.65;
  overflow-wrap: anywhere;
}

.assistant-message {
  min-width: 0;
}

.draft-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--border-subtle);
}

.draft-action {
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  color: var(--text-primary);
  background: var(--surface-elevated);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.draft-action svg {
  width: 15px;
  height: 15px;
}

.draft-action:hover:not(:disabled) {
  border-color: var(--accent-primary);
  color: var(--accent-primary);
  background: var(--surface-soft);
}

.draft-action.primary {
  border-color: var(--accent-primary);
  color: #fff;
  background: var(--accent-primary);
}

.draft-action.primary:hover:not(:disabled) {
  color: #fff;
  background: var(--accent-strong);
}

.draft-action:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}

.draft-action:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

:deep(.assistant-markdown > :first-child) {
  margin-top: 0;
}

:deep(.assistant-markdown > :last-child) {
  margin-bottom: 0;
}

.streaming-message {
  display: inline;
}

.streaming-message .assistant-markdown {
  display: inline;
}

.stream-wait {
  color: var(--text-secondary);
}

.chat-scroll-end {
  height: 1px;
  flex: 0 0 1px;
}

.msg-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  animation: chat-msg-in 0.25s ease;
}

.msg-row.user {
  justify-content: flex-end;
}

.msg-row.assistant {
  justify-content: flex-start;
}

.msg-avatar {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 18px;
}

.msg-avatar.ai {
  background: linear-gradient(135deg, #D97757, #C4603D);
  color: #fff;
  box-shadow: 0 4px 12px rgba(217, 119, 87, 0.3);
}

.msg-avatar.user {
  background: rgba(61, 50, 41, 0.08);
  color: #6B5D52;
}

.msg-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  max-width: calc(100% - 44px);
}

.msg-col.assistant {
  flex: 1;
  align-items: flex-start;
}

.msg-col.user {
  align-items: flex-end;
}

.msg-name {
  font-size: 12px;
  color: #A89888;
  padding: 0 2px;
}

.msg-bubble {
  max-width: 100%;
  padding: 10px 16px;
  font-size: 14px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}

.msg-bubble.user {
  background: var(--chat-user-bubble);
  color: #fff;
  border-radius: 16px 16px 4px 16px;
}

.msg-bubble.assistant {
  background: var(--chat-ai-bg);
  border: 1px solid var(--chat-ai-border);
  color: #3D3229;
  border-radius: 16px 16px 16px 4px;
}

.msg-bubble.typing {
  display: inline-flex;
  gap: 5px;
  padding: 14px 18px;
}

.typing-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #D97757;
  animation: typing-pulse 1.2s infinite ease-in-out both;
}

.typing-dot:nth-child(2) { animation-delay: 0.15s; }
.typing-dot:nth-child(3) { animation-delay: 0.3s; }

@keyframes typing-pulse {
  0%, 80%, 100% { transform: scale(0.5); opacity: 0.4; }
  40% { transform: scale(1); opacity: 1; }
}

/* 流式打字机气泡:复用 assistant 气泡外观,追加闪烁光标 */
.msg-bubble.streaming {
  white-space: pre-wrap;
  word-break: break-word;
}

.msg-bubble.streaming .typing {
  display: inline-flex;
  gap: 5px;
  align-items: center;
}

.stream-caret {
  display: inline-block;
  width: 2px;
  height: 1em;
  margin-left: 2px;
  background: #D97757;
  vertical-align: text-bottom;
  animation: stream-blink 1s step-end infinite;
}

@keyframes stream-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.progress-wrap {
  width: 100%;
}

.done-card {
  background: var(--chat-ai-bg);
  border: 1px solid rgba(217, 119, 87, 0.3);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
  padding: 14px 18px;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.done-card:hover {
  border-color: rgba(217, 119, 87, 0.55);
  box-shadow: 0 6px 20px rgba(217, 119, 87, 0.18);
}

.done-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 14px;
  font-weight: 700;
  color: #3D3229;
}

.done-title svg {
  width: 17px;
  height: 17px;
  color: var(--status-success);
}

.done-desc {
  margin-top: 4px;
  font-size: 13px;
  color: #6B5D52;
}

.chat-input-area {
  width: 100%;
  max-width: 768px;
  margin: 0 auto;
  padding: 0 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.chat-input-area.is-empty {
  flex: 1;
  justify-content: center;
  align-items: center;
  padding-bottom: 48px;
}

.ongoing-banner {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  max-width: 640px;
  min-width: 0;
  margin-bottom: 4px;
}

.ongoing-card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  width: 100%;
  min-width: 0;
  padding: 13px 16px;
  border: 1px solid rgba(201, 138, 45, 0.25);
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(216, 169, 78, 0.14), rgba(201, 138, 45, 0.08));
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.ongoing-card:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(201, 138, 45, 0.12); }
.ongoing-card:focus-visible { outline: 2px solid #D97757; outline-offset: 2px; }
.ongoing-card-main { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
.ongoing-badge { flex-shrink: 0; font-size: 11px; font-weight: 600; padding: 2px 10px; border-radius: 999px; color: #fff; background: linear-gradient(135deg, #d8a94e, #c98a2d); }
.ongoing-title {
  display: -webkit-box;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: #3d3229;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
  word-break: keep-all;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.ongoing-card-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.ongoing-day { color: #8B7B6E; font-size: 12px; }
.ongoing-cta { display: inline-flex; flex-shrink: 0; align-items: center; gap: 4px; color: #a8752a; font-size: 12.5px; font-weight: 600; }

.welcome {
  width: 100%;
  max-width: 640px;
  text-align: center;
}

:deep(.welcome .el-welcome-title) {
  color: var(--text-primary);
  letter-spacing: 0;
}

:deep(.welcome .el-welcome-description) {
  color: var(--text-secondary);
}

.welcome-title {
  font-size: 32px;
  font-weight: 800;
  color: #3D3229;
  margin: 0 0 10px;
  letter-spacing: -0.01em;
}

.welcome-desc {
  font-size: 15px;
  color: #8B7B6E;
  margin: 0 0 4px;
}

.suggestions {
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
}

.suggestions :deep(.el-prompts) {
  width: 100%;
}

.suggestions :deep(.el-prompts-item) {
  min-height: 38px;
  border-color: var(--border-subtle);
  border-radius: 8px;
  background: var(--surface-elevated);
  color: var(--text-secondary);
}

.suggestions :deep(.el-prompts-item:hover) {
  border-color: var(--accent-primary);
  color: var(--accent-strong);
}

.suggestion-chip {
  border: 1px solid rgba(217, 119, 87, 0.25);
  background: rgba(255, 255, 255, 0.7);
  color: #C4603D;
  border-radius: 999px;
  padding: 8px 18px;
  font-size: 13.5px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.suggestion-chip:hover {
  background: rgba(217, 119, 87, 0.1);
  border-color: rgba(217, 119, 87, 0.45);
}

.suggestion-refresh {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: none;
  background: transparent;
  color: #A8998C;
  border-radius: 999px;
  padding: 8px 14px;
  font-size: 13px;
  cursor: pointer;
  transition: color 0.15s ease;
}

.suggestion-refresh svg {
  transition: transform 0.4s ease;
}

.suggestion-refresh:hover {
  color: #C4603D;
}

.suggestion-refresh:hover svg {
  transform: rotate(180deg);
}

@media (max-width: 768px) {
  .chat-input-area.is-empty.has-ongoing {
    justify-content: flex-start;
    align-items: stretch;
    padding-top: 24px;
  }

  .chat-input-area.is-empty.has-ongoing .ongoing-banner,
  .chat-input-area.is-empty.has-ongoing .welcome {
    align-self: center;
  }
}
</style>
