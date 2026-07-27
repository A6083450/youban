<template>
  <div class="agent-dock">
    <!-- 对话浮层:悬浮在输入条上方 -->
    <transition name="agent-pop">
      <section v-if="threadVisible" class="agent-thread">
        <header class="agent-thread-header">
          <div class="agent-header-text">
            <div class="agent-title">{{ t('result.agent.title') }}</div>
            <div class="agent-subtitle">{{ t('result.agent.subtitle') }}</div>
          </div>
          <button
            type="button"
            class="agent-collapse"
            :aria-label="t('result.agent.collapse')"
            @mousedown.prevent
            @click="collapsed = true"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
        </header>

        <div class="agent-messages" ref="messagesRef">
          <div v-if="messages.length === 0" class="agent-empty">
            <p>{{ t('result.agent.welcome') }}</p>
            <div class="agent-quick">
              <button
                v-for="key in ['quick1', 'quick2', 'quick3']"
                :key="key"
                type="button"
                class="agent-quick-chip"
                :disabled="loading || !tripPlan"
                @mousedown.prevent
                @click="sendQuick(t(`result.agent.${key}`))"
              >
                {{ t(`result.agent.${key}`) }}
              </button>
            </div>
          </div>

          <template v-for="(msg, idx) in messages" :key="idx">
            <!-- 用户消息 -->
            <div v-if="msg.role === 'user'" class="agent-row user">
              <div class="agent-bubble user">{{ msg.content }}</div>
            </div>
            <!-- typing -->
            <div v-else-if="msg.kind === 'typing'" class="agent-row assistant">
              <div class="agent-bubble assistant typing">
                <span class="agent-dot"></span>
                <span class="agent-dot"></span>
                <span class="agent-dot"></span>
              </div>
            </div>
            <!-- 文本回复 -->
            <div v-else-if="msg.kind === 'text'" class="agent-row assistant">
              <div class="agent-bubble assistant">{{ msg.content }}</div>
            </div>
            <!-- 修改摘要卡 -->
            <div v-else class="agent-row assistant">
              <div class="agent-bubble assistant">{{ msg.content }}</div>
              <div v-if="msg.changes.length" class="agent-changes-card">
                <div class="agent-changes-title">{{ t('result.agent.changesTitle') }}</div>
                <ul class="agent-changes-list">
                  <li v-for="(c, ci) in msg.changes" :key="ci">{{ c }}</li>
                </ul>
                <button
                  type="button"
                  class="agent-undo-btn"
                  :disabled="msg.undone"
                  @click="undoChange(msg)"
                >
                  {{ msg.undone ? t('result.agent.undone') : t('result.agent.undo') }}
                </button>
              </div>
            </div>
          </template>
        </div>
      </section>
    </transition>

    <!-- 底部常驻输入条:直接输入与 Agent 对话改计划 -->
    <div class="agent-inputbar" :class="{ 'is-focused': focused, 'is-disabled': !tripPlan }">
      <textarea
        ref="textareaRef"
        v-model="input"
        class="agent-textarea"
        :placeholder="t('result.agent.placeholder')"
        :disabled="loading || !tripPlan"
        rows="1"
        @focus="onFocus"
        @blur="focused = false"
        @input="autoGrow"
        @keydown.enter.exact.prevent="send"
      ></textarea>
      <button
        type="button"
        class="agent-send"
        :disabled="!input.trim() || loading || !tripPlan"
        :aria-label="t('result.agent.send')"
        @click="send"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { chatEditPlan, getPlanConversation } from '@/services/api'
import type { ChatMessage, PanelMessage, TripPlan } from '@/types'

const props = defineProps<{ tripPlan: TripPlan | null; planId?: string }>()
const emit = defineEmits<{
  (e: 'apply-plan', plan: TripPlan): void
  (e: 'restore-plan', plan: TripPlan): void
}>()

const { t } = useI18n()
const input = ref('')
const loading = ref(false)
const focused = ref(false)
const collapsed = ref(false)
const messages = ref<PanelMessage[]>([])
const snapshots = ref<TripPlan[]>([])
const messagesRef = ref<HTMLElement | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)

// 聚焦或已有对话时展开浮层;collapsed 为用户手动收起的覆盖开关
const threadVisible = computed(
  () =>
    !collapsed.value &&
    !!props.tripPlan &&
    (messages.value.length > 0 || loading.value || focused.value)
)

const scrollToBottom = () => {
  nextTick(() => {
    if (messagesRef.value) {
      messagesRef.value.scrollTop = messagesRef.value.scrollHeight
    }
  })
}

watch(threadVisible, (open) => {
  if (open) scrollToBottom()
})

let conversationLoadSequence = 0
watch(
  () => props.planId,
  async (planId) => {
    const sequence = ++conversationLoadSequence
    messages.value = []
    snapshots.value = []
    loading.value = false
    collapsed.value = false

    const targetPlanId = String(planId || '').trim()
    if (!targetPlanId) return

    try {
      const history = await getPlanConversation(targetPlanId)
      if (sequence !== conversationLoadSequence || targetPlanId !== String(props.planId || '').trim()) return
      messages.value = history.map((message) => ({
        role: message.role,
        kind: 'text' as const,
        content: message.content,
      }))
      scrollToBottom()
    } catch (error) {
      if (sequence !== conversationLoadSequence) return
      console.warn('读取计划创建对话失败:', error)
    }
  },
  { immediate: true }
)

const onFocus = () => {
  focused.value = true
  collapsed.value = false
}

const autoGrow = () => {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 108)}px`
}

const sendQuick = (text: string) => {
  input.value = text
  void send()
}

const send = async () => {
  const text = input.value.trim()
  if (!text || loading.value || !props.tripPlan) return

  collapsed.value = false
  messages.value.push({ role: 'user', kind: 'text', content: text })
  input.value = ''
  nextTick(autoGrow)
  loading.value = true
  messages.value.push({ role: 'assistant', kind: 'typing' })
  scrollToBottom()

  try {
    const history: ChatMessage[] = messages.value
      .filter((m): m is Extract<PanelMessage, { kind: 'text' }> => m.kind === 'text')
      .slice(0, -1)
      .map((m) => ({ role: m.role, content: m.content }))

    const res = await chatEditPlan(text, props.tripPlan, history)
    messages.value.pop() // 移除 typing

    if (res.updated_plan) {
      const snapshotIndex = snapshots.value.length
      snapshots.value.push(JSON.parse(JSON.stringify(props.tripPlan)))
      emit('apply-plan', res.updated_plan)
      messages.value.push({
        role: 'assistant',
        kind: 'changes',
        content: res.reply,
        changes: res.changes ?? [],
        snapshotIndex,
      })
    } else {
      messages.value.push({
        role: 'assistant',
        kind: 'text',
        content: res.reply || t('result.agent.replyFallback'),
      })
    }
  } catch (err) {
    console.error('Agent chat error:', err)
    messages.value.pop()
    messages.value.push({ role: 'assistant', kind: 'text', content: t('result.agent.networkError') })
  } finally {
    loading.value = false
    scrollToBottom()
  }
}

const undoChange = (msg: Extract<PanelMessage, { kind: 'changes' }>) => {
  if (msg.undone) return
  const snapshot = snapshots.value[msg.snapshotIndex]
  if (!snapshot) return
  emit('restore-plan', snapshot)
  msg.undone = true
}
</script>

<style scoped>
.agent-dock {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  z-index: 1000;
  width: min(640px, calc(100vw - 32px));
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.agent-thread {
  display: flex;
  flex-direction: column;
  background: #FAF7F2;
  border: 1px solid var(--chat-ai-border);
  border-radius: 18px;
  box-shadow: 0 18px 48px rgba(61, 50, 41, 0.18);
  overflow: hidden;
}

.agent-pop-enter-active,
.agent-pop-leave-active {
  transition: transform 0.25s ease-out, opacity 0.25s ease-out;
}

.agent-pop-enter-from,
.agent-pop-leave-to {
  transform: translateY(12px);
  opacity: 0;
}

.agent-thread-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--chat-ai-border);
  background: #fff;
}

.agent-title {
  font-size: 14px;
  font-weight: 700;
  color: #3D3229;
}

.agent-subtitle {
  font-size: 12px;
  color: #A89888;
  margin-top: 2px;
}

.agent-collapse {
  border: none;
  background: rgba(61, 50, 41, 0.06);
  color: #6B5D52;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
}

.agent-collapse:hover {
  background: rgba(217, 119, 87, 0.15);
  color: #D97757;
}

.agent-messages {
  max-height: min(420px, 48vh);
  overflow-y: auto;
  padding: 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.agent-empty {
  color: #6B5D52;
  font-size: 13px;
  line-height: 1.6;
}

.agent-quick {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}

.agent-quick-chip {
  border: 1px solid rgba(217, 119, 87, 0.3);
  background: rgba(217, 119, 87, 0.06);
  color: #C4603D;
  border-radius: 12px;
  padding: 8px 12px;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: all 0.15s ease;
}

.agent-quick-chip:hover:not(:disabled) {
  background: rgba(217, 119, 87, 0.14);
}

.agent-quick-chip:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.agent-row {
  display: flex;
  animation: chat-msg-in 0.25s ease;
}

.agent-row.user {
  justify-content: flex-end;
}

.agent-row.assistant {
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}

.agent-bubble {
  max-width: 88%;
  border-radius: 14px;
  padding: 10px 14px;
  font-size: 13.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.agent-bubble.user {
  background: var(--chat-user-bubble);
  color: #fff;
  border-radius: 14px 14px 4px 14px;
}

.agent-bubble.assistant {
  background: var(--chat-ai-bg);
  border: 1px solid var(--chat-ai-border);
  color: #3D3229;
  border-radius: 14px 14px 14px 4px;
}

.agent-bubble.typing {
  display: inline-flex;
  gap: 5px;
  padding: 12px 16px;
}

.agent-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #D97757;
  animation: agent-dot-pulse 1.2s infinite ease-in-out both;
}

.agent-dot:nth-child(2) { animation-delay: 0.15s; }
.agent-dot:nth-child(3) { animation-delay: 0.3s; }

@keyframes agent-dot-pulse {
  0%, 80%, 100% { transform: scale(0.5); opacity: 0.4; }
  40% { transform: scale(1); opacity: 1; }
}

.agent-changes-card {
  width: 88%;
  background: rgba(217, 119, 87, 0.06);
  border: 1px solid rgba(217, 119, 87, 0.22);
  border-radius: 12px;
  padding: 10px 14px;
}

.agent-changes-title {
  font-size: 12px;
  font-weight: 700;
  color: #C4603D;
  margin-bottom: 6px;
}

.agent-changes-list {
  margin: 0 0 8px;
  padding-left: 16px;
  font-size: 12.5px;
  color: #3D3229;
  line-height: 1.7;
}

.agent-undo-btn {
  border: 1px solid rgba(100, 80, 60, 0.2);
  background: #fff;
  color: #6B5D52;
  border-radius: 8px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.agent-undo-btn:hover:not(:disabled) {
  border-color: #D97757;
  color: #C4603D;
}

.agent-undo-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.agent-inputbar {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 8px 8px 8px 18px;
  background: #fff;
  border: 1px solid var(--chat-ai-border);
  border-radius: 24px;
  box-shadow: 0 10px 32px rgba(61, 50, 41, 0.16);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.agent-inputbar.is-focused {
  border-color: #D97757;
  box-shadow: 0 12px 36px rgba(217, 119, 87, 0.25);
}

.agent-inputbar.is-disabled {
  opacity: 0.6;
}

.agent-textarea {
  flex: 1;
  border: none;
  background: transparent;
  padding: 8px 0;
  font-family: inherit;
  font-size: 14px;
  color: #3D3229;
  resize: none;
  outline: none;
  line-height: 1.5;
  max-height: 108px;
}

.agent-textarea::placeholder {
  color: #B8A99A;
}

.agent-send {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border: none;
  border-radius: 50%;
  background: var(--chat-user-bubble);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.15s ease;
}

.agent-send:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

@media (max-width: 768px) {
  .agent-dock {
    bottom: 12px;
    width: calc(100vw - 20px);
  }

  .agent-messages {
    max-height: 46vh;
  }
}
</style>
