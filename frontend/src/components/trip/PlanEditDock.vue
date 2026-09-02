<script setup lang="ts">
import type { ChatMessageDto } from '@youban/contracts'
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { extractTripPlan } from '@/features/result/model'
import type { TripPlan } from '@/features/result/model'
import { chatEditPlan, getPlanConversation } from '@/services/v2'

interface PanelMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  changes?: string[]
  snapshot?: TripPlan
  undone?: boolean
}

const props = defineProps<{
  plan: TripPlan
  planId: string
}>()

const emit = defineEmits<{
  update: [plan: TripPlan]
}>()
const { t } = useI18n()

const quickPrompts = computed(() => [
  t('result.agent.quick1'),
  t('result.agent.quick2'),
  t('result.agent.quick3'),
])
const input = ref('')
const messages = ref<PanelMessage[]>([])
const loading = ref(false)
const focused = ref(false)
const collapsed = ref(true)
const scrollTarget = ref('')
let loadSequence = 0

function identifier(): string {
  return `edit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

async function followLatest(): Promise<void> {
  await nextTick()
  scrollTarget.value = messages.value.at(-1)?.id || ''
}

function history(): ChatMessageDto[] {
  return messages.value.map(item => ({ role: item.role, content: item.content })).slice(-20)
}

async function send(value = input.value): Promise<void> {
  const text = value.trim()
  if (!text || loading.value)
    return
  input.value = ''
  collapsed.value = false
  messages.value.push({ id: identifier(), role: 'user', content: text })
  loading.value = true
  void followLatest()
  try {
    const previous = structuredClone(props.plan) as TripPlan
    const response = await chatEditPlan(
      text,
      props.plan as unknown as Record<string, unknown>,
      history().slice(0, -1),
      props.planId,
    )
    const updated = response.updated_plan ? extractTripPlan({ data: response.updated_plan }) : null
    if (updated)
      emit('update', updated)
    messages.value.push({
      id: identifier(),
      role: 'assistant',
      content: response.reply || t('result.agent.replyFallback'),
      changes: response.changes,
      snapshot: updated ? previous : undefined,
    })
  }
  catch (error) {
    const message = (error as { message?: unknown } | null)?.message
    messages.value.push({
      id: identifier(),
      role: 'assistant',
      content: typeof message === 'string' && message ? message : t('result.agent.networkError'),
    })
  }
  finally {
    loading.value = false
    void followLatest()
  }
}

function undo(message: PanelMessage): void {
  if (!message.snapshot || message.undone)
    return
  emit('update', structuredClone(message.snapshot) as TripPlan)
  message.undone = true
}

watch(() => props.planId, async (planId) => {
  const sequence = ++loadSequence
  messages.value = []
  collapsed.value = true
  try {
    const records = await getPlanConversation(planId)
    if (sequence !== loadSequence)
      return
    messages.value = records.map(record => ({ id: identifier(), ...record }))
  }
  catch {
    if (sequence === loadSequence)
      messages.value = []
  }
}, { immediate: true })
</script>

<template>
  <view class="edit-dock">
    <view v-if="!collapsed && (focused || loading || messages.length)" class="edit-thread">
      <view class="thread-header">
        <view>
          <text class="thread-title">{{ t('result.agent.title') }}</text>
          <text class="thread-subtitle">{{ t('result.agent.subtitle') }}</text>
        </view>
        <button class="icon-command" :title="t('result.agent.collapse')" :aria-label="t('result.agent.collapse')" @click="collapsed = true">
          <wd-icon name="arrow-down" size="20px" />
        </button>
      </view>
      <view v-if="!messages.length" class="quick-prompts">
        <button v-for="prompt in quickPrompts" :key="prompt" @click="send(prompt)">
          {{ prompt }}
        </button>
      </view>
      <scroll-view
        v-else
        scroll-y
        class="message-list"
        :scroll-into-view="scrollTarget"
        :scroll-with-animation="true"
      >
        <view
          v-for="message in messages"
          :id="message.id"
          :key="message.id"
          class="message-row"
          :class="message.role"
        >
          <view class="message-bubble">
            <text>{{ message.content }}</text>
            <view v-if="message.changes?.length" class="change-list">
              <text class="change-title">{{ t('result.agent.changesTitle') }}</text>
              <text v-for="(change, index) in message.changes" :key="`${message.id}-${index}`">· {{ change }}</text>
              <button
                v-if="message.snapshot"
                class="undo-command"
                :disabled="message.undone"
                @click="undo(message)"
              >
                {{ message.undone ? t('result.agent.undone') : t('result.agent.undo') }}
              </button>
            </view>
          </view>
        </view>
        <view v-if="loading" class="message-row assistant">
          <view class="message-bubble typing-bubble">
            <view class="typing-dot" />
            <view class="typing-dot" />
            <view class="typing-dot" />
          </view>
        </view>
      </scroll-view>
    </view>

    <view class="edit-composer" :class="{ focused }">
      <textarea
        v-model="input"
        class="edit-input"
        :disabled="loading"
        :maxlength="2000"
        auto-height
        confirm-type="send"
        placeholder-style="line-height: 22px;"
        :placeholder="t('result.agent.placeholder')"
        @focus="focused = true; collapsed = false"
        @blur="focused = false"
        @confirm="send()"
      />
      <button class="send-command" :disabled="loading || !input.trim()" :title="t('result.agent.send')" :aria-label="t('result.agent.send')" @click="send()">
        <wd-icon name="arrow-up" size="20px" color="#ffffff" />
      </button>
    </view>
  </view>
</template>

<style scoped>
.edit-dock {
  position: fixed;
  z-index: 80;
  left: calc(50% + 130px);
  bottom: max(24px, env(safe-area-inset-bottom));
  display: flex;
  width: min(640px, calc(100vw - 28px));
  transform: translateX(-50%);
  flex-direction: column;
  gap: 9px;
  pointer-events: none;
}
.edit-thread,
.edit-composer {
  pointer-events: auto;
}
.edit-thread {
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface-elevated);
  box-shadow: 0 18px 48px rgba(61, 50, 41, 0.18);
}
.thread-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 15px;
  border-bottom: 1px solid var(--border-subtle);
}
.thread-header > view {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}
.thread-title {
  font-size: 14px;
  font-weight: 750;
}
.thread-subtitle {
  color: var(--text-secondary);
  font-size: 11px;
}
.icon-command,
.quick-prompts button,
.undo-command,
.send-command {
  box-sizing: border-box;
  margin: 0;
  border: 0;
  line-height: 1.4;
}
.icon-command::after,
.quick-prompts button::after,
.undo-command::after,
.send-command::after {
  display: none;
}
.icon-command {
  display: flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--surface-soft);
  color: var(--text-primary);
}
.quick-prompts {
  display: grid;
  gap: 7px;
  padding: 13px;
}
.quick-prompts button {
  min-height: 38px;
  padding: 8px 11px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--surface-page);
  color: var(--text-primary);
  font-size: 13px;
  text-align: left;
}
.message-list {
  height: min(420px, 48vh);
  padding: 13px 0;
}
.message-row {
  display: flex;
  box-sizing: border-box;
  width: 100%;
  padding: 5px 13px;
}
.message-row.user {
  justify-content: flex-end;
}
.message-bubble {
  max-width: 82%;
  padding: 9px 11px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface-page);
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-wrap;
}
.message-row.user .message-bubble {
  border-color: var(--accent-primary);
  background: var(--accent-primary);
  color: white;
}
.change-list {
  display: flex;
  margin-top: 9px;
  padding-top: 8px;
  border-top: 1px solid var(--border-subtle);
  flex-direction: column;
  gap: 4px;
  color: var(--text-secondary);
  font-size: 11px;
}
.change-title {
  color: var(--text-primary);
  font-weight: 700;
}
.undo-command {
  align-self: flex-start;
  margin-top: 5px;
  padding: 4px 0;
  background: transparent;
  color: var(--accent-strong);
  font-size: 11px;
}
.typing-bubble {
  display: flex;
  align-items: center;
  gap: 5px;
}
.typing-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent-primary);
  animation: typing 1s ease-in-out infinite;
}
.typing-dot:nth-child(2) {
  animation-delay: 0.14s;
}
.typing-dot:nth-child(3) {
  animation-delay: 0.28s;
}
.edit-composer {
  display: flex;
  box-sizing: border-box;
  min-height: 54px;
  align-items: center;
  gap: 9px;
  padding: 2px 9px 2px 14px;
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  background: var(--surface-elevated);
  box-shadow: 0 10px 32px rgba(61, 50, 41, 0.16);
}
.edit-composer.focused {
  border-color: var(--accent-primary);
}
.edit-input {
  display: block;
  flex: 1;
  box-sizing: border-box;
  min-width: 0;
  min-height: 38px;
  max-height: 110px;
  padding: 8px 0;
  color: var(--text-primary);
  font-size: 14px;
  line-height: 22px;
}
.send-command {
  display: flex;
  width: 38px;
  height: 38px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--accent-primary);
}
.send-command[disabled] {
  opacity: 0.42;
}
@keyframes typing {
  0%,
  100% {
    opacity: 0.35;
    transform: translateY(0);
  }
  50% {
    opacity: 1;
    transform: translateY(-3px);
  }
}
@media (max-width: 560px) {
  .edit-dock {
    left: 50%;
    bottom: max(12px, env(safe-area-inset-bottom));
    width: calc(100vw - 20px);
  }
  .message-list {
    height: min(380px, 52vh);
  }
}
</style>
