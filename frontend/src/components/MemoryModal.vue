<template>
  <a-modal
    :open="open"
    :title="t('user.memoriesTitle')"
    :footer="null"
    width="480px"
    @cancel="emit('close')"
  >
    <a-spin :spinning="loading">
      <template v-if="items.length">
        <div v-for="item in items" :key="item.id" class="memory-item">
          <span class="memory-text">{{ item.memory }}</span>
          <a-button type="text" size="small" danger @click="remove(item.id)">
            {{ t('user.memoryDelete') }}
          </a-button>
        </div>
      </template>
      <a-empty v-else-if="!loading" :description="t('user.memoriesEmpty')" />
    </a-spin>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { message } from 'ant-design-vue'
import type { UserMemoryItem } from '@/types'
import { deleteUserMemory, getUserMemories } from '@/services/api'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const { t } = useI18n()

const loading = ref(false)
const items = ref<UserMemoryItem[]>([])

watch(() => props.open, async (open) => {
  if (!open) return
  loading.value = true
  try {
    items.value = await getUserMemories()
  } finally {
    loading.value = false
  }
})

const remove = async (id: string) => {
  try {
    await deleteUserMemory(id)
    items.value = items.value.filter((it) => it.id !== id)
    message.success(t('user.memoryDeleted'))
  } catch {
    message.error(t('user.memoryDeleteFailed'))
  }
}
</script>

<style scoped>
.memory-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 4px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}
.memory-text { flex: 1; font-size: 13px; color: #374151; line-height: 1.5; }
</style>
