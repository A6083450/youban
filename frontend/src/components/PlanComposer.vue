<template>
  <div ref="composerRoot" class="composer">
    <XSender
      ref="senderRef"
      class="composer-sender"
      :placeholder="t('composer.placeholder')"
      :disabled="disabled"
      :loading="disabled"
      :max-length="2000"
      submit-type="enter"
      @submit="handleSend"
      @change="syncEmptyState"
    >
      <template #action-list>
        <ElButton
          circle
          type="primary"
          :aria-label="t('composer.send')"
          :disabled="disabled || isEmpty"
          :loading="disabled"
          @click="handleSend"
        >
          <ElIcon><Promotion /></ElIcon>
        </ElButton>
      </template>
    </XSender>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Promotion } from '@element-plus/icons-vue'
import { ElButton, ElIcon } from 'element-plus'
import { XSender } from 'vue-element-plus-x'

const props = withDefaults(defineProps<{ disabled?: boolean }>(), { disabled: false })
const emit = defineEmits<{ (e: 'send', text: string): void }>()

const { t } = useI18n()
const senderRef = ref<InstanceType<typeof XSender> | null>(null)
const composerRoot = ref<HTMLElement | null>(null)
const isEmpty = ref(true)

const editorElement = () => composerRoot.value?.querySelector<HTMLElement>('[contenteditable]') ?? null

const syncEditorAccessibility = () => {
  const editor = editorElement()
  if (!editor) return
  const label = t('composer.placeholder')
  editor.setAttribute('role', 'textbox')
  editor.setAttribute('aria-label', label)
  editor.setAttribute('aria-multiline', 'true')
  editor.setAttribute('placeholder', label)
}

const syncEmptyState = () => {
  isEmpty.value = !senderRef.value?.getModelValue().text.trim()
}

onMounted(async () => {
  await nextTick()
  syncEditorAccessibility()
})

const handleSend = () => {
  const text = senderRef.value?.getModelValue().text.trim() || ''
  if (!text || props.disabled) return
  emit('send', text)
  senderRef.value?.clear()
  isEmpty.value = true
}

const setText = (text: string) => {
  senderRef.value?.setText(text)
  isEmpty.value = !text.trim()
}
const focus = () => {
  syncEditorAccessibility()
  editorElement()?.focus()
  senderRef.value?.focus('last')
}

defineExpose({ focus, setText })
</script>

<style scoped>
.composer {
  width: 100%;
  max-width: 768px;
  margin: 0 auto;
}

.composer-sender {
  --el-color-primary: var(--accent-primary);
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(60, 64, 67, 0.1);
}

.composer-sender:focus-within {
  box-shadow: 0 0 0 3px var(--accent-soft), 0 5px 22px rgba(60, 64, 67, 0.12);
}

:deep(.el-sender-wrap) {
  border-color: var(--border-subtle);
  background: var(--surface-elevated);
}
</style>
