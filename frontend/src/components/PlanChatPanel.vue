<template>
  <div class="agent-dock">
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
            <ArrowDownBold aria-hidden="true" />
          </button>
        </header>

        <div v-if="messages.length === 0" class="agent-empty">
          <Welcome :description="t('result.agent.welcome')" />
          <Prompts :items="quickPrompts" vertical @item-click="sendQuickPrompt" />
        </div>
        <BubbleList
          v-else
          ref="bubbleListRef"
          class="agent-messages"
          :list="panelBubbleItems"
          item-key="id"
          max-height="min(420px, 48vh)"
          :auto-scroll="true"
          :show-back-button="true"
        >
          <template #item="{ item }">
            <Bubble
              :class="`role-${item.message.role}`"
              :placement="item.message.role === 'user' ? 'end' : 'start'"
              :variant="item.message.role === 'user' ? 'filled' : 'outlined'"
              :loading="item.message.kind === 'typing'"
              max-width="88%"
            >
              <template #content>
                <span v-if="item.message.role === 'user'">{{ item.message.content }}</span>
                <template v-else-if="item.message.kind !== 'typing'">
                  <MarkdownRenderer
                    class="agent-markdown"
                    :markdown="item.message.content"
                    :allow-html="false"
                    :enable-shiki="false"
                    :enable-mermaid="false"
                    :style="markdownStyle"
                  />
                  <div v-if="item.message.kind === 'changes' && item.message.changes.length" class="agent-changes-card">
                    <div class="agent-changes-title">{{ t('result.agent.changesTitle') }}</div>
                    <ul class="agent-changes-list">
                      <li v-for="(change, changeIndex) in item.message.changes" :key="changeIndex">{{ change }}</li>
                    </ul>
                    <button
                      type="button"
                      class="agent-undo-btn"
                      :disabled="item.message.undone"
                      @click="undoChange(item.message)"
                    >
                      {{ item.message.undone ? t('result.agent.undone') : t('result.agent.undo') }}
                    </button>
                  </div>
                </template>
              </template>
            </Bubble>
          </template>
        </BubbleList>
      </section>
    </transition>

    <div
      ref="senderRoot"
      class="agent-inputbar"
      :class="{ 'is-focused': focused, 'is-disabled': !tripPlan }"
      @focusin="onFocus"
      @focusout="handleFocusOut"
    >
      <XSender
        ref="senderRef"
        class="agent-sender"
        :placeholder="t('result.agent.placeholder')"
        :disabled="loading || !tripPlan"
        :loading="loading"
        :max-length="2000"
        submit-type="enter"
        @submit="send()"
        @change="syncEmptyState"
      >
        <template #action-list>
          <ElButton
            circle
            type="primary"
            :aria-label="t('result.agent.send')"
            :disabled="loading || !tripPlan || isEmpty"
            :loading="loading"
            @click="send()"
          >
            <ElIcon><Promotion /></ElIcon>
          </ElButton>
        </template>
      </XSender>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Bubble, BubbleList, Prompts, Welcome, XSender } from 'vue-element-plus-x'
import { ArrowDownBold, Promotion } from '@element-plus/icons-vue'
import { ElButton, ElIcon } from 'element-plus'
import { MarkdownRenderer } from 'x-markdown-vue'
import { chatEditPlan, getPlanConversation } from '@/services/api'
import type { ChatMessage, PanelMessage, TripPlan } from '@/types'

const props = defineProps<{ tripPlan: TripPlan | null; planId?: string }>()
const emit = defineEmits<{
  (e: 'apply-plan', plan: TripPlan): void
  (e: 'restore-plan', plan: TripPlan): void
}>()

const { t } = useI18n()
const loading = ref(false)
const focused = ref(false)
const collapsed = ref(false)
const messages = ref<PanelMessage[]>([])
const snapshots = ref<TripPlan[]>([])
const bubbleListRef = ref<{ scrollToBottom: (smooth?: boolean) => void } | null>(null)
const senderRef = ref<InstanceType<typeof XSender> | null>(null)
const senderRoot = ref<HTMLElement | null>(null)
const isEmpty = ref(true)
const markdownStyle = {
  backgroundColor: 'transparent',
  color: 'var(--text-primary)',
  padding: '0',
}

const panelBubbleItems = computed(() => messages.value.map((message, index) => ({
  id: `${index}-${message.role}-${message.kind}`,
  message,
})))

const quickPrompts = computed(() => ['quick1', 'quick2', 'quick3'].map((key) => ({
  key,
  label: t(`result.agent.${key}`),
  disabled: loading.value || !props.tripPlan,
})))

const syncEmptyState = () => {
  isEmpty.value = !senderRef.value?.getModelValue().text.trim()
}

const syncEditorAccessibility = () => {
  const editor = senderRoot.value?.querySelector<HTMLElement>('[contenteditable]')
  if (!editor) return
  const label = t('result.agent.placeholder')
  editor.setAttribute('role', 'textbox')
  editor.setAttribute('aria-label', label)
  editor.setAttribute('aria-multiline', 'true')
  editor.setAttribute('placeholder', label)
}

onMounted(async () => {
  await nextTick()
  syncEditorAccessibility()
})

// 聚焦或已有对话时展开浮层;collapsed 为用户手动收起的覆盖开关
const threadVisible = computed(
  () =>
    !collapsed.value &&
    !!props.tripPlan &&
    (messages.value.length > 0 || loading.value || focused.value)
)

const scrollToBottom = () => {
  nextTick(() => {
    bubbleListRef.value?.scrollToBottom(false)
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
    // Keep restored conversation history from covering plan controls after a route switch.
    collapsed.value = true

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

const handleFocusOut = () => {
  window.setTimeout(() => {
    focused.value = false
  }, 0)
}

const sendQuick = (text: string) => {
  senderRef.value?.setText(text)
  isEmpty.value = !text.trim()
  void send(text)
}

const sendQuickPrompt = (prompt: { label?: string }) => sendQuick(prompt.label || '')

const send = async (textOverride?: string) => {
  const text = (textOverride ?? senderRef.value?.getModelValue().text ?? '').trim()
  if (!text || loading.value || !props.tripPlan) return

  collapsed.value = false
  messages.value.push({ role: 'user', kind: 'text', content: text })
  senderRef.value?.clear()
  isEmpty.value = true
  loading.value = true
  messages.value.push({ role: 'assistant', kind: 'typing' })
  scrollToBottom()

  try {
    const history: ChatMessage[] = messages.value
      .filter((m): m is Extract<PanelMessage, { kind: 'text' }> => m.kind === 'text')
      .slice(0, -1)
      .map((m) => ({ role: m.role, content: m.content }))

    const res = await chatEditPlan(text, props.tripPlan, history, props.planId)
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
  left: calc(50% + var(--desktop-sidebar-width) / 2);
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
  background: var(--surface-page);
  border: 1px solid var(--chat-ai-border);
  border-radius: var(--card-radius);
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
  background: var(--surface-elevated);
}

.agent-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
}

.agent-subtitle {
  font-size: 12px;
  color: var(--text-secondary);
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

.agent-collapse svg {
  width: 15px;
  height: 15px;
}

.agent-collapse:hover {
  background: rgba(217, 119, 87, 0.15);
  color: #D97757;
}

.agent-messages {
  padding: 16px 14px;
  min-height: 100px;
}

.agent-empty {
  padding: 16px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.agent-empty :deep(.el-prompts-item) {
  border-radius: 8px;
  border-color: var(--border-subtle);
}

.agent-markdown {
  color: var(--text-primary);
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.agent-messages :deep(.role-user) {
  --elx-bubble-bg: var(--accent-primary);
  --elx-bubble-text-color: #fff;
}

.agent-markdown :deep(> :first-child) {
  margin-top: 0;
}

.agent-markdown :deep(> :last-child) {
  margin-bottom: 0;
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
  width: 100%;
  border-radius: 16px;
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

.agent-sender {
  width: 100%;
  --el-color-primary: var(--accent-primary);
}

.agent-sender :deep(.el-sender-wrap) {
  border-color: var(--border-subtle);
  border-radius: 16px;
  background: var(--surface-elevated);
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
    left: 50%;
    bottom: 12px;
    width: calc(100vw - 20px);
  }

  .agent-messages {
    max-height: 46vh;
  }
}
</style>
