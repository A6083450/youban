<template>
  <div class="composer">
    <div class="input-box" :class="{ disabled }">
      <textarea
        ref="textareaRef"
        v-model="inputText"
        class="input-textarea"
        :placeholder="t('composer.placeholder')"
        :disabled="disabled"
        rows="2"
        @keydown.enter.exact.prevent="handleSend"
      ></textarea>
      <button
        type="button"
        class="send-btn"
        :disabled="!inputText.trim() || disabled"
        :aria-label="t('composer.send')"
        @click="handleSend"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = withDefaults(defineProps<{ disabled?: boolean }>(), { disabled: false })
const emit = defineEmits<{ (e: 'send', text: string): void }>()

const { t } = useI18n()
const inputText = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)

const handleSend = () => {
  const text = inputText.value.trim()
  if (!text || props.disabled) return
  emit('send', text)
  inputText.value = ''
}

const setText = (text: string) => {
  inputText.value = text
}

const focus = () => {
  textareaRef.value?.focus()
}

defineExpose({ focus, setText })
</script>

<style scoped>
.composer {
  width: 100%;
  max-width: 768px;
  margin: 0 auto;
}

.input-box {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  background: #FFFFFF;
  border: 1px solid rgba(100, 80, 60, 0.18);
  border-radius: 24px;
  padding: 12px 14px;
  box-shadow: 0 4px 20px rgba(100, 80, 60, 0.08);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.input-box:focus-within {
  border-color: #D97757;
  box-shadow: 0 0 0 3px rgba(217, 119, 87, 0.1);
}

.input-box.disabled {
  opacity: 0.7;
}

.input-textarea {
  flex: 1;
  border: none;
  outline: none;
  resize: none;
  font-family: inherit;
  font-size: 15px;
  color: #3D3229;
  background: transparent;
  line-height: 1.5;
}

.input-textarea::placeholder {
  color: #A89888;
}

.send-btn {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  border: none;
  border-radius: 50%;
  background: var(--chat-user-bubble);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
