<template>
  <form
    class="share-code-entry"
    :class="{ 'share-code-entry--compact': compact }"
    @submit.prevent="submit"
  >
    <label :for="inputId" class="share-code-entry__label">
      {{ t('shareCode.label') }}
    </label>
    <div class="share-code-entry__row">
      <a-input
        ref="inputRef"
        :id="inputId"
        :value="code"
        :placeholder="t('shareCode.placeholder')"
        autocomplete="off"
        @update:value="updateCode"
      />
      <a-button type="primary" html-type="submit" :disabled="!code">
        <ArrowRightOutlined />
        <span>{{ t('shareCode.submit') }}</span>
      </a-button>
    </div>
    <p v-if="invalid" class="share-code-entry__error" role="alert">
      {{ t('shareCode.invalid') }}
    </p>
  </form>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, useId, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowRightOutlined } from '@ant-design/icons-vue'
import { isValidShareCode, normalizeShareCode } from '@/utils/shareCode'

const props = withDefaults(defineProps<{
  autofocus?: boolean
  compact?: boolean
  initialCode?: string
}>(), {
  autofocus: false,
  compact: false,
  initialCode: '',
})
const router = useRouter()
const { t } = useI18n()
const inputId = `share-code-${useId()}`
const inputRef = ref<{ focus: () => void } | null>(null)
const code = ref(normalizeShareCode(props.initialCode))
const invalid = ref(false)

onMounted(() => {
  if (props.autofocus) {
    void nextTick(() => inputRef.value?.focus())
  }
})

watch(
  () => props.initialCode,
  (value) => {
    code.value = normalizeShareCode(value)
    invalid.value = false
  },
)

const updateCode = (value: string) => {
  code.value = normalizeShareCode(value)
  invalid.value = false
}

const submit = () => {
  if (!isValidShareCode(code.value)) {
    invalid.value = true
    return
  }
  void router.push({ name: 'Share', params: { id: code.value } })
}
</script>

<style scoped>
.share-code-entry {
  width: 100%;
  text-align: left;
}

.share-code-entry__label {
  display: block;
  margin-bottom: 8px;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
}

.share-code-entry__row {
  display: flex;
  align-items: stretch;
  gap: 8px;
  min-width: 0;
}

.share-code-entry__row :deep(.ant-input) {
  min-width: 0;
  height: 40px;
  border-color: var(--border-subtle);
  border-radius: 8px;
  background: var(--surface-elevated);
  color: var(--text-primary);
  font-size: 14px;
}

.share-code-entry__row :deep(.ant-input:hover),
.share-code-entry__row :deep(.ant-input:focus) {
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.share-code-entry__row :deep(.ant-btn) {
  flex: 0 0 auto;
  min-width: 76px;
  height: 40px;
  border-color: var(--accent-primary);
  border-radius: 8px;
  background: var(--accent-primary);
  font-weight: 600;
}

.share-code-entry__row :deep(.ant-btn:not(:disabled):hover) {
  border-color: var(--accent-strong);
  background: var(--accent-strong);
}

.share-code-entry__error {
  margin: 8px 0 0;
  color: var(--status-danger);
  font-size: 12px;
  line-height: 1.4;
}

.share-code-entry--compact .share-code-entry__row :deep(.ant-btn) {
  min-width: 68px;
  padding-inline: 10px;
}
</style>
