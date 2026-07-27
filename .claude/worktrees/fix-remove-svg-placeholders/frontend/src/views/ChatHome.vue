<template>
  <div class="chat-home">
    <div class="chat-scroll">
      <div class="welcome">
        <h1 class="welcome-title">{{ t('chatHome.title') }}</h1>
        <p class="welcome-desc">{{ t('chatHome.desc') }}</p>
        <div class="suggestions">
          <button
            v-for="s in suggestions"
            :key="s"
            type="button"
            class="suggestion-chip"
            @click="fillSuggestion(s)"
          >{{ s }}</button>
        </div>
      </div>
      <div v-if="sentMessages.length" class="sent-list">
        <div v-for="(m, i) in sentMessages" :key="i" class="sent-bubble">{{ m }}</div>
        <!-- 工作状态面板 -->
        <WorkProgress
          :visible="workProgress.visible"
          :progress="workProgress.progress"
          :message="workProgress.message"
          :stage="workProgress.stage"
          :details="workProgress.details"
        />
      </div>
    </div>
    <div class="chat-input-area">
      <PlanComposer ref="composerRef" @sent="onSent" @work-progress="onWorkProgress" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import PlanComposer from '@/components/PlanComposer.vue'
import WorkProgress from '@/components/WorkProgress.vue'
import type { TripTaskDetail, TripTaskStage } from '@/types'

const { t, tm } = useI18n()
const composerRef = ref<InstanceType<typeof PlanComposer> | null>(null)
const sentMessages = ref<string[]>([])

const workProgress = reactive({
  visible: false,
  progress: 0,
  message: '',
  stage: 'submitted' as TripTaskStage,
  details: [] as TripTaskDetail[],
})

const suggestions = computed(() => {
  const list = (tm as (key: string) => unknown)('chatHome.suggestions')
  return Array.isArray(list) ? (list as string[]) : []
})

const fillSuggestion = (text: string) => {
  const composer = composerRef.value as any
  if (composer) {
    composer.inputText = text
  }
}

const onSent = (text: string) => {
  sentMessages.value.push(text)
}

const onWorkProgress = (status: {
  visible: boolean
  progress: number
  message: string
  stage: TripTaskStage
  details: TripTaskDetail[]
}) => {
  workProgress.visible = status.visible
  workProgress.progress = status.progress
  workProgress.message = status.message
  workProgress.stage = status.stage
  workProgress.details = status.details
}
</script>

<style scoped>
.chat-home {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.chat-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 48px 24px 24px;
  display: flex;
  flex-direction: column;
}

.welcome {
  margin: auto auto 32px;
  max-width: 1080px;
  width: 100%;
  text-align: center;
}

.welcome-title {
  font-size: 40px;
  font-weight: 800;
  color: #3D3229;
  margin: 0 0 16px;
  letter-spacing: -0.02em;
}

.welcome-desc {
  font-size: 16px;
  color: #6B5D52;
  margin: 0 0 28px;
}

.suggestions {
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
}

.suggestion-chip {
  border: 1px solid rgba(217, 119, 87, 0.3);
  background: rgba(217, 119, 87, 0.06);
  color: #C4603D;
  border-radius: 999px;
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.suggestion-chip:hover {
  background: rgba(217, 119, 87, 0.14);
}

.sent-list {
  max-width: 1080px;
  width: 100%;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-end;
}

.sent-bubble {
  background: linear-gradient(135deg, #D97757 0%, #C4603D 100%);
  color: #fff;
  border-radius: 16px 16px 4px 16px;
  padding: 10px 16px;
  font-size: 14px;
  max-width: 80%;
}

.chat-input-area {
  padding: 16px 24px 24px;
}
</style>
