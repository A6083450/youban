<template>
  <div class="chat-home">
    <!-- 对话流 -->
    <div v-show="items.length > 0" ref="scrollRef" class="chat-scroll" @scroll="handleConversationScroll">
      <div class="thread">
        <template v-for="item in items" :key="item.id">
          <div class="msg-row" :class="item.role">
            <!-- 左侧:游伴头像 -->
            <div v-if="item.role === 'assistant'" class="msg-avatar ai" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>
            </div>

            <div class="msg-col" :class="item.role">
              <div class="msg-name">{{ item.role === 'assistant' ? t('chatHome.assistantName') : t('chatHome.userName') }}</div>

              <!-- 文本消息(用户/AI) -->
              <div v-if="item.type === 'text'" class="msg-bubble" :class="item.role">{{ item.text }}</div>

              <!-- AI typing -->
              <div v-else-if="item.type === 'typing'" class="msg-bubble assistant typing">
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
              </div>

              <!-- AI 流式打字机:游伴回复逐字流出 -->
              <div v-else-if="item.type === 'streaming'" class="msg-bubble assistant streaming">
                <template v-if="item.text">{{ item.text }}<span class="stream-caret" aria-hidden="true"></span></template>
                <span v-else class="typing">
                  <span class="typing-dot"></span>
                  <span class="typing-dot"></span>
                  <span class="typing-dot"></span>
                </span>
              </div>

              <!-- 确认卡片(纯展示,用户在下方输入框用自然语言确认/修改) -->
              <TripDraftConfirmCard
                v-else-if="item.type === 'confirm'"
                :draft="item.draft"
              />

              <!-- 生成进度 -->
              <div v-else-if="item.type === 'progress'" class="progress-wrap">
                <WorkProgress
                  :visible="item.status.visible"
                  :progress="item.status.progress"
                  :message="item.status.message"
                  :stage="item.status.stage"
                  :details="item.status.details"
                />
              </div>

              <!-- 完成卡片 -->
              <div v-else class="done-card" role="button" tabindex="0" @click="openPlan(item.planId)" @keydown.enter="openPlan(item.planId)">
                <div class="done-title">✅ {{ t('chatHome.doneTitle') }}</div>
                <div class="done-desc">{{ item.city }} · {{ item.days }}{{ t('composer.daysUnit') }} · {{ t('chatHome.doneCta') }}</div>
              </div>
            </div>

            <!-- 右侧:用户头像 -->
            <div v-if="item.role === 'user'" class="msg-avatar user" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </div>
          </div>
        </template>
        <div ref="scrollEndRef" class="chat-scroll-end" aria-hidden="true"></div>
      </div>
    </div>

    <!-- 输入区(空态时整体居中,含欢迎语) -->
    <div class="chat-input-area" :class="{ 'is-empty': items.length === 0 }">
      <div v-if="items.length === 0" class="welcome">
        <h1 class="welcome-title">{{ t('chatHome.title') }}</h1>
        <p class="welcome-desc">{{ t('chatHome.desc') }}</p>
      </div>
      <PlanComposer ref="composerRef" :disabled="busy" @send="handleUserSend" />
      <div v-if="items.length === 0" class="suggestions">
        <button
          v-for="s in suggestions"
          :key="s"
          type="button"
          class="suggestion-chip"
          @click="fillSuggestion(s)"
        >{{ s }}</button>
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
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { message } from 'ant-design-vue'
import PlanComposer from '@/components/PlanComposer.vue'
import TripDraftConfirmCard from '@/components/TripDraftConfirmCard.vue'
import WorkProgress from '@/components/WorkProgress.vue'
import { parseTripTextStream, confirmTripReplyStream, generateTripPlan, watchTripTask } from '@/services/api'
import { getCurrentLocale } from '@/i18n'
import { notifyPlansUpdated } from '@/stores/plans'
import { currentUser } from '@/stores/auth'
import { buildTripPlanRequest, orchestrateConfirmationReply, shouldClearActiveTask } from '@/utils/confirmationOrchestration.js'
import { buildConversationHistory } from '@/utils/conversationHistory.js'
import { buildArchivedConversation, NEW_PLAN_EVENT } from '@/utils/planConversation.js'
import { isConversationNearBottom, scrollConversationToBottom } from '@/utils/chatScroll.js'
import type { PlanGenerationOutcome } from '@/utils/confirmationOrchestration.js'
import type { ChatMessage, ParsedTripDraft, TripConfirmReplyResponse, TripParseApiResponse, TripPlanResponse, TripTaskDetail, TripTaskEvent, TripTaskStage } from '@/types'

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
  | { role: 'assistant'; type: 'confirm'; draft: ParsedTripDraft }
  | { role: 'assistant'; type: 'progress'; status: WorkProgressStatus }
  | { role: 'assistant'; type: 'done'; planId: string; city: string; days: number }

type ChatItem = ChatItemData & { id: number }

const { t, tm } = useI18n()
const router = useRouter()

const composerRef = ref<InstanceType<typeof PlanComposer> | null>(null)
const scrollRef = ref<HTMLElement | null>(null)
const scrollEndRef = ref<HTMLElement | null>(null)
const followingLatest = ref(true)
const previousScrollRestoration = typeof window !== 'undefined' && 'scrollRestoration' in window.history
  ? window.history.scrollRestoration
  : null
if (previousScrollRestoration !== null) {
  window.history.scrollRestoration = 'manual'
}
const items = ref<ChatItem[]>([])
const busy = ref(false)
const generating = ref(false)
// 待确认的行程卡片:用户可直接在输入框里回复"确定/再想想/补充修改",不必点卡片按钮
const pendingConfirmId = ref<number | null>(null)
const pendingDraft = ref<ParsedTripDraft | null>(null)
// 正在等待流式回复的用户消息;刷新时若非空,说明回复被打断,恢复后自动重发续上
const pendingUserText = ref<string | null>(null)
let nextId = 1

// 首页示例建议:从 i18n 候选池里随机抽取一批展示,点"换一批"轮换,避免每次进入都是同一组。
// 待 mem0 记忆架构落地后,改为按用户历史偏好个性化推荐,新用户仍回退到此热门列表。
const SUGGESTION_BATCH = 5

const suggestionPool = computed<string[]>(() => {
  const list = (tm as (key: string) => unknown)('chatHome.suggestions')
  return Array.isArray(list) ? (list as string[]) : []
})

const suggestions = ref<string[]>([])

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
}

const scrollToBottom = (force = false) => {
  if (!force && !followingLatest.value) return
  nextTick(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollConversationToBottom(scrollRef.value, scrollEndRef.value)
      })
    })
  })
}

const handleConversationScroll = () => {
  followingLatest.value = isConversationNearBottom(scrollRef.value)
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

// ─── 进行中任务持久化:刷新页面后可凭 task_id 重连 WebSocket 恢复进度 ───
// key 按用户命名空间隔离,切换用户后互不干扰
const activeTaskStorageKey = (): string => {
  const uid = currentUser.value?.user_id || 'anonymous'
  return `tripstar.active_task.${uid}`
}

interface ActiveTaskRecord {
  taskId: string
  city: string
  days: number
  userText: string
}

const saveActiveTask = (record: ActiveTaskRecord) => {
  try {
    localStorage.setItem(activeTaskStorageKey(), JSON.stringify(record))
  } catch { /* 存储不可用时静默降级 */ }
}

const clearActiveTask = () => {
  localStorage.removeItem(activeTaskStorageKey())
}

const readActiveTask = (): ActiveTaskRecord | null => {
  try {
    const raw = localStorage.getItem(activeTaskStorageKey())
    if (!raw) return null
    const data = JSON.parse(raw)
    return data && typeof data.taskId === 'string' && data.taskId ? data : null
  } catch {
    return null
  }
}

// ─── 对话会话持久化:刷新后整段恢复;中途被打断那条自动重发续上 ───
const chatSessionStorageKey = (): string => {
  const uid = currentUser.value?.user_id || 'anonymous'
  return `tripstar.chat_session.${uid}`
}

// 仅持久化稳定对话项;typing/streaming/progress 等瞬态不落盘
type PersistItem = Extract<ChatItem, { type: 'text' | 'confirm' | 'done' }>
const isPersistable = (item: ChatItem): item is PersistItem =>
  item.type === 'text' || item.type === 'confirm' || item.type === 'done'

interface ChatSessionSnapshot {
  items: PersistItem[]
  pendingConfirmId: number | null
  pendingDraft: ParsedTripDraft | null
  pendingUserText: string | null
  nextId: number
}

const persistChatSession = () => {
  try {
    const snapshot: ChatSessionSnapshot = {
      items: items.value.filter(isPersistable),
      pendingConfirmId: pendingConfirmId.value,
      pendingDraft: pendingDraft.value,
      pendingUserText: pendingUserText.value,
      nextId,
    }
    // 没有任何有效对话时清掉,避免残留空会话
    if (snapshot.items.length === 0 && !snapshot.pendingUserText) {
      localStorage.removeItem(chatSessionStorageKey())
      return
    }
    localStorage.setItem(chatSessionStorageKey(), JSON.stringify(snapshot))
  } catch { /* 存储不可用时静默降级 */ }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null
let suppressChatPersistence = false
const persistSoon = () => {
  if (suppressChatPersistence) return
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    if (!suppressChatPersistence) persistChatSession()
  }, 200)
}

const clearChatSession = () => {
  suppressChatPersistence = true
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null }
  try { localStorage.removeItem(chatSessionStorageKey()) } catch { /* ignore */ }
}

const readChatSession = (): ChatSessionSnapshot | null => {
  try {
    const raw = localStorage.getItem(chatSessionStorageKey())
    if (!raw) return null
    const data = JSON.parse(raw)
    return Array.isArray(data?.items) ? data : null
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

const openPlan = (planId: string) => {
  if (!planId) return
  router.push(`/plan/${planId}`)
}

const handlePlanResponse = (response: TripPlanResponse, progressId: number): boolean => {
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
    // 计划已生成并即将进入结果页,当前新建对话到此完结,清掉会话快照
    clearChatSession()
    setTimeout(() => {
      router.push(`/plan/${planId}`)
    }, 900)
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

const resetConversation = () => {
  if (busy.value || generating.value) return
  clearChatSession()
  items.value = []
  pendingConfirmId.value = null
  pendingDraft.value = null
  pendingUserText.value = null
  nextId = 1
  composerRef.value?.setText('')
  clearPlanResultSession()
  nextTick(() => {
    suppressChatPersistence = false
  })
}

// 页面刷新后:若存在进行中任务,重建对话并重连订阅(后端会先推送当前快照)
const resumeActiveTask = async () => {
  const record = readActiveTask()
  if (!record) return

  if (record.userText) {
    pushItem({ role: 'user', type: 'text', text: record.userText })
  }
  pushItem({ role: 'assistant', type: 'text', text: t('chatHome.resumeNotice') })

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

  try {
    const response = await watchTripTask(record.taskId, {
      onTaskEvent: (event) => applyTaskEvent(status, event),
    })
    if (handlePlanResponse(response, progressId)) clearActiveTask()
  } catch (error: any) {
    replaceItem(progressId, {
      role: 'assistant',
      type: 'text',
      text: error?.message || t('home.messages.generateRetry'),
    })
    notifyPlansUpdated()
  } finally {
    generating.value = false
    busy.value = false
  }
}

// 刷新后恢复整段对话;若上次回复被打断,自动重发续上
const restoreChatSession = () => {
  const snap = readChatSession()
  if (!snap || !snap.items.length) return
  items.value = snap.items.map((it) => ({ ...it })) as ChatItem[]
  nextId = Math.max(snap.nextId || 0, ...items.value.map((i) => i.id + 1), 1)
  pendingDraft.value = snap.pendingDraft || null
  // 仅当该卡片确实在恢复的对话里时才认它,避免悬空引用
  const hasCard =
    snap.pendingConfirmId != null &&
    items.value.some((i) => i.id === snap.pendingConfirmId && i.type === 'confirm')
  pendingConfirmId.value = hasCard ? snap.pendingConfirmId : null
  scrollToBottom()

  // 被打断那条自动重发续上;生成中(存在 active_task)的恢复交给 resumeActiveTask,此处不重发
  if (snap.pendingUserText && !readActiveTask()) {
    const lastUser = [...items.value].reverse().find((i) => i.role === 'user' && i.type === 'text')
    const lastUserId = lastUser
      ? lastUser.id
      : pushItem({ role: 'user', type: 'text', text: snap.pendingUserText })
    if (pendingConfirmId.value !== null && pendingDraft.value) {
      void handlePendingReply(snap.pendingUserText, pendingConfirmId.value, pendingDraft.value, lastUserId)
    } else {
      void runParseStream(snap.pendingUserText, lastUserId)
    }
  }
}

onMounted(() => {
  restoreChatSession()
  void resumeActiveTask()
  window.addEventListener(NEW_PLAN_EVENT, resetConversation)
  // 浏览器滚动恢复与字体布局可能晚于首帧,短暂校正确保刷新也落在最新消息
  followingLatest.value = true
  for (const delay of [0, 120, 360]) {
    window.setTimeout(() => scrollToBottom(true), delay)
  }
})

onUnmounted(() => {
  window.removeEventListener(NEW_PLAN_EVENT, resetConversation)
  if (previousScrollRestoration !== null) {
    window.history.scrollRestoration = previousScrollRestoration
  }
  if (persistTimer) clearTimeout(persistTimer)
})

// 对话状态变化后防抖落盘,供刷新恢复
watch([items, pendingConfirmId, pendingDraft, pendingUserText], persistSoon, { deep: true })
watch(() => items.value.length, (length) => {
  if (length > 0) scrollToBottom(true)
})

const clearPendingConfirm = () => {
  pendingConfirmId.value = null
  pendingDraft.value = null
}

// 给 agent 的最近对话历史:包含确认卡片语义,排除本轮刚加入的用户消息
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

// 待确认卡片期间的所有回复都交给后端 Agent 决策,前端只解释结构化 action
const handlePendingReply = async (
  text: string,
  cardId: number,
  draft: ParsedTripDraft,
  currentUserItemId: number
) => {
  busy.value = true
  pendingUserText.value = text
  persistSoon()
  const streamId = pushItem({ role: 'assistant', type: 'streaming', text: '' })
  let acc = ''
  // 流式版 confirmReply:过程逐字更新气泡,拿到完整结构化结果后 resolve,
  // 仍交给既有编排逻辑决策(确认/修改/取消/闲聊),编排本身无需改动
  const streamingConfirmReply = (
    replyText: string,
    replyDraft: ParsedTripDraft,
    language: string,
    history: ChatMessage[]
  ): Promise<TripConfirmReplyResponse> =>
    new Promise((resolve, reject) => {
      confirmTripReplyStream(replyText, replyDraft, language, history, {
        onDelta: (d) => { acc += d; setStreamingText(streamId, acc) },
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
      },
      {
        confirmReply: streamingConfirmReply,
        generate: onConfirmGenerate,
      }
    )
    const { effect } = result

    if (effect.type === 'generate') {
      removeItem(streamId)
      clearPendingConfirm()
      if (result.pending) {
        pendingConfirmId.value = result.pending.cardId
        pendingDraft.value = result.pending.draft
        replaceItem(result.pending.cardId, {
          role: 'assistant',
          type: 'confirm',
          draft: result.pending.draft,
        })
      }
    } else if (effect.type === 'update') {
      replaceItem(streamId, {
        role: 'assistant',
        type: 'text',
        text: effect.message || t('composer.clarifyFallback'),
      })
      pendingConfirmId.value = effect.cardId
      pendingDraft.value = effect.draft
      replaceItem(effect.cardId, { role: 'assistant', type: 'confirm', draft: effect.draft })
    } else if (effect.type === 'cancel') {
      removeItem(streamId)
      clearPendingConfirm()
      replaceItem(effect.cardId, {
        role: 'assistant',
        type: 'text',
        text: effect.message || t('composer.canceled'),
      })
    } else {
      // chat / ask_confirmation:流式气泡定格为最终回复
      replaceItem(streamId, {
        role: 'assistant',
        type: 'text',
        text: effect.message || (effect.type === 'error'
          ? t('composer.parseFailed')
          : t('composer.clarifyFallback')),
      })
    }
  } finally {
    pendingUserText.value = null
    busy.value = false
    persistSoon()
  }
}

// 解析需求/推荐/追问:流式打字机版。不在此 push 用户消息,便于刷新后对同一条
// 用户消息重新发起(自动重发续上)
const runParseStream = async (text: string, userItemId: number) => {
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
      onDelta: (d) => { acc += d; setStreamingText(streamId, acc) },
      onFinal: (res) => { finalRes = res },
      onError: () => { streamError = true },
    })
    if (streamError || !finalRes) throw new Error(t('composer.parseFailed'))
    const res: TripParseApiResponse = finalRes

    if (res.action === 'recommend' || res.action === 'chat' || res.action === 'clarify' || !res.trip) {
      // 逐字流出的是 reply;final 到达后补全为完整回复(含推荐列表/追问)
      replaceItem(streamId, { role: 'assistant', type: 'text', text: formatAgentReply(res) })
    } else {
      // 任何 plan 都必须进入确认卡片;先保留 agent 的自然回应,再展示草稿卡片
      if (res.reply?.trim()) {
        replaceItem(streamId, { role: 'assistant', type: 'text', text: res.reply.trim() })
        pendingConfirmId.value = pushItem({ role: 'assistant', type: 'confirm', draft: res.trip })
      } else {
        replaceItem(streamId, { role: 'assistant', type: 'confirm', draft: res.trip })
        pendingConfirmId.value = streamId
      }
      pendingDraft.value = res.trip
    }
  } catch (error: any) {
    replaceItem(streamId, {
      role: 'assistant',
      type: 'text',
      text: error?.message || t('composer.parseFailed'),
    })
  } finally {
    pendingUserText.value = null
    busy.value = false
    persistSoon()
  }
}

const handleUserSend = async (text: string) => {
  if (busy.value) return
  // 用户主动发送新消息时重新跟随最新对话
  followingLatest.value = true
  const userItemId = pushItem({ role: 'user', type: 'text', text })

  // 有待确认的行程卡片时,优先用对话方式处理,不要求用户点卡片按钮
  if (pendingConfirmId.value !== null && pendingDraft.value) {
    await handlePendingReply(text, pendingConfirmId.value, pendingDraft.value, userItemId)
    return
  }

  await runParseStream(text, userItemId)
}

const onConfirmGenerate = async (
  draft: ParsedTripDraft,
  executionToken: string
): Promise<PlanGenerationOutcome> => {
  if (generating.value) return { status: 'submit_failed' }
  const requestData = buildTripPlanRequest(draft, executionToken, getCurrentLocale())
  if (!requestData) {
    message.warning(t('home.messages.travelDaysTooLong'))
    return { status: 'submit_failed' }
  }
  requestData.conversation = buildArchivedConversation(items.value)
  const travelDays = requestData.travel_days

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
  try {
    sessionStorage.removeItem('tripPlan')
    sessionStorage.removeItem('graphData')
    sessionStorage.removeItem('planId')

    const response = await generateTripPlan(requestData, {
      onTaskCreated: (task) => {
        // 拿到 task_id 立即落地,刷新页面后可恢复;并让侧栏立刻出现"生成中"的任务
        createdTaskId = task.task_id
        saveActiveTask({
          taskId: task.task_id,
          city: draft.city,
          days: travelDays,
          userText: draft.origin_text || draft.free_text_input || '',
        })
        notifyPlansUpdated()
      },
      onTaskEvent: (event) => applyTaskEvent(status, event),
    })

    const completed = handlePlanResponse(response, progressId)
    const outcome: PlanGenerationOutcome = completed
      ? { status: 'completed' }
      : { status: 'watch_failed', taskId: createdTaskId }
    if (shouldClearActiveTask(outcome)) clearActiveTask()
    return outcome
  } catch (error: any) {
    replaceItem(progressId, {
      role: 'assistant',
      type: 'text',
      text: error?.message || t('home.messages.generateRetry'),
    })
    notifyPlansUpdated()
    return createdTaskId
      ? { status: 'watch_failed', taskId: createdTaskId }
      : { status: 'submit_failed' }
  } finally {
    generating.value = false
    busy.value = false
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
  overflow-y: auto;
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
  display: flex;
  flex-direction: column;
  gap: 16px;
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
  font-size: 14px;
  font-weight: 700;
  color: #3D3229;
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

.welcome {
  width: 100%;
  max-width: 640px;
  text-align: center;
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
</style>
