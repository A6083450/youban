<template>
  <div class="work-progress" v-if="visible">
    <!-- 头部：当前状态 + 进度条 -->
    <div class="wp-header">
      <div class="wp-status-row">
        <span class="wp-pulse-dot"></span>
        <span class="wp-status-text">{{ currentMessage }}</span>
      </div>
      <div class="wp-progress-bar">
        <div class="wp-progress-fill" :style="{ width: progress + '%' }"></div>
      </div>
      <div class="wp-progress-pct">{{ progress }}%</div>
    </div>

    <!-- 阶段总览:紧凑 chips,一眼看完全部阶段的等待/进行/完成状态 -->
    <div class="wp-stages">
      <div
        v-for="s in stageChips"
        :key="s.key"
        class="wp-stage-chip"
        :class="s.status"
      >
        <svg v-if="s.status === 'done'" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        <span v-else-if="s.status === 'active'" class="wp-spinner wp-spinner-sm"></span>
        <span v-else class="wp-stage-dot"></span>
        <span>{{ s.label }}</span>
      </div>
    </div>

    <!-- 事件明细:只展示真实发生的事件,不再有占位的"等待"步骤 -->
    <div v-if="visibleEvents.length || currentThinking" class="wp-timeline" ref="timelineRef">
      <div
        v-for="step in visibleEvents"
        :key="step.key"
        class="wp-step"
        :class="[step.status]"
      >
        <!-- 左侧图标 -->
        <div class="wp-step-icon" :class="step.type">
          <svg v-if="step.status === 'done'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          <span v-else-if="step.status === 'active'" class="wp-spinner"></span>
          <span v-else class="wp-step-dot"></span>
        </div>

        <!-- 右侧内容 -->
        <div class="wp-step-body">
          <div class="wp-step-title">{{ step.title }}</div>
          <div v-if="step.content" class="wp-step-content">
            <div class="wp-step-content-text" :class="{ expanded: expandedKeys.has(step.key) }">
              {{ step.content }}
            </div>
            <button
              v-if="step.content.length > 80"
              class="wp-expand-btn"
              @click="toggleExpand(step.key)"
            >
              {{ expandedKeys.has(step.key) ? '收起' : '展开' }}
            </button>
          </div>
        </div>
      </div>

      <!-- 当前正在思考的动画:仅当最新一条事件是 thinking 时展示,避免过期残留 -->
      <div v-if="currentThinking" class="wp-step active thinking-step">
        <div class="wp-step-icon thinking">
          <span class="wp-thinking-dots"><span></span><span></span><span></span></span>
        </div>
        <div class="wp-step-body">
          <div class="wp-step-title">{{ currentThinking }}</div>
        </div>
      </div>
    </div>

    <!-- 展开/收起控制:默认展开,事件较多时可收起只看最新两条 -->
    <button v-if="eventSteps.length > COLLAPSED_COUNT" class="wp-toggle" @click="expanded = !expanded">
      <svg :class="{ rotated: expanded }" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      {{ expanded ? '收起详情' : '查看详情' }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import type { TripTaskDetail, TripTaskStage } from '@/types'

interface StepItem {
  key: string
  type: TripTaskDetail['type']
  title: string
  content?: string
  status: 'done' | 'active' | 'pending'
}

const props = defineProps<{
  visible: boolean
  progress: number
  message: string
  stage: TripTaskStage
  details: TripTaskDetail[]
}>()

// 默认展开详情;事件较多时收起只保留最新两条
const COLLAPSED_COUNT = 2
const expanded = ref(true)
// 每条事件正文的展开状态用响应式 Set 维护(直接改 computed 产物不会触发重渲染)
const expandedKeys = ref<Set<string>>(new Set())
const timelineRef = ref<HTMLElement | null>(null)

const toggleExpand = (key: string) => {
  const next = new Set(expandedKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedKeys.value = next
}

const stageOrder: TripTaskStage[] = [
  'submitted', 'initializing', 'attraction_search', 'weather_search', 'hotel_search', 'planning', 'graph_building', 'completed'
]

const stageLabels: Record<TripTaskStage, string> = {
  submitted: '任务提交',
  initializing: '初始化',
  attraction_search: '搜索景点',
  weather_search: '查询天气',
  hotel_search: '搜索酒店',
  planning: '生成行程',
  graph_building: '整理行程脉络',
  completed: '完成',
  failed: '失败',
}

const currentStageIdx = computed(() => {
  const idx = stageOrder.indexOf(props.stage)
  return idx >= 0 ? idx : 0
})

const currentMessage = computed(() => props.message || stageLabels[props.stage] || '处理中...')

// 阶段总览 chips:只反映状态,不携带正文,避免与事件明细重复
const stageChips = computed(() =>
  stageOrder.map((s, i) => ({
    key: s,
    label: stageLabels[s],
    status: (i < currentStageIdx.value ? 'done' : i === currentStageIdx.value ? 'active' : 'pending') as StepItem['status'],
  }))
)

// 仅当最新一条事件是 thinking 时才展示思考动画,避免旧的"正在初始化…"残留
const currentThinking = computed(() => {
  const list = props.details || []
  const last = list[list.length - 1]
  return last?.type === 'thinking' ? last.title : null
})

// 后端详情正文是 LLM 输出的 markdown(标题/表格/分隔线等),直接展示用户看不懂,
// 这里清洗为纯文本摘要:去标记符号,表格行合并为逗号分隔的单元格
const stripMarkdown = (raw: string): string => {
  const out: string[] = []
  for (const rawLine of raw.replace(/\r/g, '').split('\n')) {
    let line = rawLine.trim()
    if (!line) continue
    if (/^\|?[\s:|-]+\|?$/.test(line)) continue // 表格分隔行 |---|---|
    if (/^\*{3,}$/.test(line)) continue // *** 水平线
    line = line.replace(/^#{1,6}\s*/, '') // 标题
    if (line.includes('|')) {
      // 表格行 → 单元格用逗号拼接
      line = line.replace(/^\||\|$/g, '').split('|').map(c => c.trim()).filter(Boolean).join('，')
    }
    line = line
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+[.、]\s+/, '')
    if (line) out.push(line)
  }
  return out.join(' ').replace(/\s{2,}/g, ' ').trim()
}

// 事件明细:只保留真实发生的事件(搜索/发现/信息),同标题取最新一条,按时间顺序排列;
// tool_call 是原始工具调用/代码输出,用户看不懂,跳过;thinking 由思考动画单独展示
const eventSteps = computed<StepItem[]>(() => {
  const list: StepItem[] = []
  for (const d of props.details || []) {
    if (d.type !== 'searching' && d.type !== 'found' && d.type !== 'info') continue
    const item: StepItem = {
      key: d.title,
      type: d.type,
      title: d.title,
      content: d.content ? stripMarkdown(d.content) : undefined,
      status: 'done',
    }
    const existing = list.findIndex((s) => s.key === item.key)
    if (existing !== -1) list.splice(existing, 1)
    list.push(item)
  }
  return list
})

const visibleEvents = computed<StepItem[]>(() => {
  const steps = eventSteps.value
  // 生成仍在进行且没有思考动画时,把最新一条事件标记为进行中
  const running = props.stage !== 'completed' && props.stage !== 'failed'
  const markActive = running && !currentThinking.value && steps.length > 0
  const sliced = expanded.value ? steps : steps.slice(-COLLAPSED_COUNT)
  return sliced.map((s) => ({
    ...s,
    status: markActive && s.key === steps[steps.length - 1].key ? 'active' : s.status,
  }))
})

// 自动滚动到底部
watch(() => props.details?.length, () => {
  nextTick(() => {
    if (timelineRef.value) {
      timelineRef.value.scrollTop = timelineRef.value.scrollHeight
    }
  })
})
</script>

<style scoped>
.work-progress {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(217, 119, 87, 0.2);
  border-radius: 16px;
  padding: 16px 20px;
  max-width: 520px;
  width: 100%;
  box-shadow: 0 4px 24px rgba(100, 80, 60, 0.08);
  animation: wp-slide-in 0.3s ease-out;
  align-self: flex-start;
}

@keyframes wp-slide-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.wp-header { margin-bottom: 12px; }

.wp-status-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.wp-pulse-dot {
  width: 8px;
  height: 8px;
  background: #D97757;
  border-radius: 50%;
  animation: wp-pulse 1.5s ease-in-out infinite;
  flex-shrink: 0;
}

@keyframes wp-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.8); }
}

.wp-status-text { font-size: 14px; font-weight: 600; color: #3D3229; }

.wp-progress-bar {
  width: 100%;
  height: 4px;
  background: rgba(100, 80, 60, 0.1);
  border-radius: 2px;
  overflow: hidden;
}

.wp-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #D97757, #C4603D);
  border-radius: 2px;
  transition: width 0.6s ease;
}

.wp-progress-pct { text-align: right; font-size: 11px; color: #A89888; margin-top: 4px; }

/* 阶段总览 chips */
.wp-stages {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.wp-stage-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgba(100, 80, 60, 0.06);
  color: #A89888;
  white-space: nowrap;
}

.wp-stage-chip.done {
  background: rgba(76, 175, 80, 0.1);
  color: #4CAF50;
}

.wp-stage-chip.active {
  background: rgba(217, 119, 87, 0.12);
  color: #D97757;
  font-weight: 600;
}

.wp-stage-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(100, 80, 60, 0.25);
}

.wp-timeline {
  max-height: 280px;
  overflow-y: auto;
  padding-right: 4px;
}

.wp-timeline::-webkit-scrollbar { width: 4px; }
.wp-timeline::-webkit-scrollbar-thumb { background: rgba(100, 80, 60, 0.15); border-radius: 2px; }

.wp-step {
  display: flex;
  gap: 12px;
  padding: 8px 0;
  position: relative;
}

.wp-step:not(:last-child)::after {
  content: '';
  position: absolute;
  left: 15px;
  top: 30px;
  bottom: -8px;
  width: 2px;
  background: rgba(100, 80, 60, 0.1);
}

.wp-step.done:not(:last-child)::after { background: rgba(217, 119, 87, 0.3); }

.wp-step-icon {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  position: relative;
  z-index: 1;
}

.wp-step-icon.searching { background: rgba(217, 119, 87, 0.1); color: #D97757; }
.wp-step-icon.planning { background: rgba(100, 120, 200, 0.1); color: #6478C8; }
.wp-step-icon.thinking { background: rgba(180, 140, 60, 0.1); color: #B48C3C; }
.wp-step-icon.info,
.wp-step-icon.found { background: rgba(100, 80, 60, 0.08); color: #6B5D52; }
.wp-step.done .wp-step-icon { background: rgba(76, 175, 80, 0.1); color: #4CAF50; }
.wp-step.active .wp-step-icon { box-shadow: 0 0 0 3px rgba(217, 119, 87, 0.15); }

.wp-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(217, 119, 87, 0.25);
  border-top-color: #D97757;
  border-radius: 50%;
  animation: wp-spin 0.8s linear infinite;
}

.wp-spinner-sm {
  width: 10px;
  height: 10px;
  border-width: 1.5px;
}

@keyframes wp-spin { to { transform: rotate(360deg); } }

.wp-step-dot { width: 8px; height: 8px; background: rgba(100, 80, 60, 0.2); border-radius: 50%; }

.wp-step-body { flex: 1; min-width: 0; padding-top: 5px; }
.wp-step-title { font-size: 13px; font-weight: 500; color: #3D3229; line-height: 1.4; }
.wp-step.pending .wp-step-title { color: #A89888; }

.wp-step-content { margin-top: 4px; }
.wp-step-content-text {
  font-size: 12px;
  color: #6B5D52;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.wp-step-content-text.expanded { -webkit-line-clamp: unset; }

.wp-expand-btn {
  background: none;
  border: none;
  color: #D97757;
  font-size: 11px;
  cursor: pointer;
  padding: 2px 0;
  margin-top: 2px;
}
.wp-expand-btn:hover { text-decoration: underline; }

.wp-thinking-dots { display: flex; gap: 3px; align-items: center; }
.wp-thinking-dots span {
  width: 5px;
  height: 5px;
  background: #B48C3C;
  border-radius: 50%;
  animation: wp-think-bounce 1.2s ease-in-out infinite;
}
.wp-thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
.wp-thinking-dots span:nth-child(3) { animation-delay: 0.4s; }

@keyframes wp-think-bounce {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
  40% { transform: translateY(-4px); opacity: 1; }
}

.wp-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  background: none;
  border: none;
  border-top: 1px solid rgba(100, 80, 60, 0.08);
  color: #A89888;
  font-size: 12px;
  cursor: pointer;
  padding: 10px 0 0;
  margin-top: 10px;
  transition: color 0.15s;
}
.wp-toggle:hover { color: #D97757; }
.wp-toggle svg { transition: transform 0.2s ease; }
.wp-toggle svg.rotated { transform: rotate(180deg); }
</style>
