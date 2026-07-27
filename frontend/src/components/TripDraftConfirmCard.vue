<template>
  <div class="confirm-card">
    <div class="confirm-title">{{ t('composer.confirmTitle') }}</div>
    <div class="confirm-row">
      <span class="confirm-label">{{ t('composer.cities') }}</span>
      <div class="city-chips">
        <span v-for="c in draft.cities" :key="c.city" class="city-chip">{{ c.city }} · {{ c.days }}{{ t('composer.daysUnit') }}</span>
      </div>
    </div>
    <div class="confirm-row">
      <span class="confirm-label">{{ t('composer.dates') }}</span>
      <span class="confirm-value">{{ draft.start_date }} → {{ draft.end_date }}</span>
    </div>
    <div v-if="draft.preferences.length" class="confirm-row">
      <span class="confirm-label">{{ t('composer.prefs') }}</span>
      <div class="pref-chips">
        <span v-for="opt in draft.preferences" :key="opt" class="pref-chip">{{ preferenceLabel(opt) }}</span>
      </div>
    </div>
    <div class="confirm-row">
      <span class="confirm-label">{{ t('composer.transport') }}</span>
      <span class="confirm-value">{{ transportLabel(draft.transportation) }} · {{ accommodationLabel(draft.accommodation) }}</span>
    </div>
    <div class="confirm-hint">
      <div>{{ t('composer.confirmHint') }}</div>
      <template v-if="suggestions.length">
        <div class="confirm-tips-title">{{ isAgentSuggestions ? t('composer.suggestionsTitle') : t('composer.hintDefaultsTitle') }}</div>
        <ul class="confirm-tips">
          <li v-for="s in suggestions" :key="s">{{ s }}</li>
        </ul>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ParsedTripDraft } from '@/types'

const props = defineProps<{
  draft: ParsedTripDraft
}>()

const { t } = useI18n()

const preferenceLabelKeys: Record<string, string> = {
  历史文化: 'home.interests.history',
  自然风光: 'home.interests.nature',
  美食: 'home.interests.food',
  购物: 'home.interests.shopping',
  艺术: 'home.interests.art',
  休闲: 'home.interests.leisure',
}
const preferenceLabel = (value: string) => t(preferenceLabelKeys[value] || value)

const transportLabelKeys: Record<string, string> = {
  公共交通: 'home.transportation.public',
  自驾: 'home.transportation.drive',
  步行: 'home.transportation.walk',
  混合: 'home.transportation.mixed',
}
const transportLabel = (value: string) => t(transportLabelKeys[value] || value)

const accommodationLabelKeys: Record<string, string> = {
  经济型酒店: 'home.accommodation.budget',
  舒适型酒店: 'home.accommodation.comfort',
  豪华酒店: 'home.accommodation.luxury',
  民宿: 'home.accommodation.homestay',
}
const accommodationLabel = (value: string) => t(accommodationLabelKeys[value] || value)

// 建议优先级:后端 LLM 推理生成的个性化建议 > LLM 标记的默认字段模板提示 > 前端正则兜底
const isAgentSuggestions = computed(() => Boolean(props.draft.suggestions?.length))

const INFERRED_HINT_KEYS: Record<string, string> = {
  dates: 'composer.hintDates',
  transportation: 'composer.hintTransport',
  accommodation: 'composer.hintAccommodation',
  preferences: 'composer.hintPrefs',
}

const suggestions = computed(() => {
  // 1. agent 推理给出的个性化建议
  const fromAgent = (props.draft.suggestions || []).filter(Boolean)
  if (fromAgent.length) return fromAgent

  // 2. 后端 LLM 标记的默认填充字段 → 模板提示
  if (props.draft.inferred_fields) {
    return props.draft.inferred_fields
      .map((f) => INFERRED_HINT_KEYS[f])
      .filter(Boolean)
      .map((k) => t(k))
  }

  // 3. 老版本后端兜底:前端正则检测用户没提到的字段
  const text = `${props.draft.origin_text || ''} ${props.draft.free_text_input || ''}`
  const tips: string[] = []
  const mentionedDates = /(\d{1,2}\s*月|\d{4}\s*[-/.年]|\d+\s*[-/.]\s*\d+|明天|后天|下周|这周|本周|周末|周[一二三四五六日天]|\d{1,2}\s*[号日]|国庆|十一|五一|元旦|春节|中秋|端午|暑假|寒假|tomorrow|next\s+week|weekend)/i.test(text)
  const mentionedTransport = /(公共交通|地铁|公交|自驾|开车|租车|步行|走路|打车|骑行|driv|walk|public\s+transit|subway|metro|taxi)/i.test(text)
  const mentionedAccommodation = /(酒店|民宿|住宿|青旅|宾馆|客栈|hotel|hostel|airbnb|bnb|inn)/i.test(text)
  const mentionedPrefs = props.draft.preferences.length > 0

  if (!mentionedDates) tips.push(t('composer.hintDates'))
  if (!mentionedTransport) tips.push(t('composer.hintTransport'))
  if (!mentionedAccommodation) tips.push(t('composer.hintAccommodation'))
  if (!mentionedPrefs) tips.push(t('composer.hintPrefs'))
  return tips
})
</script>

<style scoped>
.confirm-card {
  background: var(--chat-ai-bg);
  border: 1px solid var(--chat-ai-border);
  border-radius: var(--card-radius);
  padding: 20px 22px;
  box-shadow: var(--card-shadow);
  max-width: 640px;
}

.confirm-title {
  font-size: 15px;
  font-weight: 700;
  color: #3D3229;
  margin-bottom: 14px;
}

.confirm-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.confirm-label {
  width: 56px;
  flex-shrink: 0;
  font-size: 13px;
  color: #6B5D52;
}

.confirm-value {
  font-size: 13.5px;
  color: #3D3229;
  font-weight: 500;
}

.city-chips, .pref-chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.city-chip {
  background: rgba(217, 119, 87, 0.1);
  border: 1px solid rgba(217, 119, 87, 0.3);
  color: #C4603D;
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 13px;
  font-weight: 600;
}

.pref-chip {
  border: 1px solid #D97757;
  background: rgba(217, 119, 87, 0.1);
  color: #C4603D;
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 13px;
  user-select: none;
}

.confirm-hint {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed rgba(100, 80, 60, 0.15);
  font-size: 12.5px;
  color: #A89888;
  line-height: 1.6;
}

.confirm-tips-title {
  margin-top: 8px;
  color: #8B7B6E;
  font-weight: 600;
}

.confirm-tips {
  margin: 4px 0 0;
  padding-left: 18px;
}

.confirm-tips li {
  margin: 2px 0;
}
</style>
