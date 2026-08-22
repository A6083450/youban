<template>
  <div v-if="currentUser" class="user-badge">
    <a-dropdown placement="topLeft" :trigger="['click']">
      <button class="user-badge-btn" type="button">
        <span class="user-avatar">{{ initial }}</span>
        <span class="user-nickname">{{ currentUser.nickname }}</span>
      </button>
      <template #overlay>
        <a-menu>
          <a-menu-item key="memories" @click="memoryOpen = true">
            <DatabaseOutlined class="account-menu-icon" aria-hidden="true" />
            <span>{{ t('user.myMemories') }}</span>
          </a-menu-item>
          <a-menu-item key="logout" @click="handleLogout">
            <SwapOutlined class="account-menu-icon" aria-hidden="true" />
            <span>{{ t('user.switchUser') }}</span>
          </a-menu-item>
        </a-menu>
      </template>
    </a-dropdown>
    <MemoryModal :open="memoryOpen" @close="memoryOpen = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { DatabaseOutlined, SwapOutlined } from '@ant-design/icons-vue'
import { currentUser, logout } from '@/stores/auth'
import MemoryModal from '@/components/MemoryModal.vue'

const { t } = useI18n()
const router = useRouter()
const memoryOpen = ref(false)

const initial = computed(() =>
  (currentUser.value?.nickname || '?').trim().charAt(0).toUpperCase(),
)

const handleLogout = () => {
  logout()
  router.replace('/login')
}
</script>

<style scoped>
.user-badge { width: 100%; }
.user-badge-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 44px;
  padding: 7px 10px;
  border: none;
  border-radius: 8px;
  background: var(--surface-soft);
  cursor: pointer;
  transition: background 0.2s ease;
}
.user-badge-btn:hover { background: var(--accent-soft); }
.user-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--accent-primary);
  color: #fff;
  font-weight: 700;
  font-size: 14px;
  flex-shrink: 0;
}
.user-nickname {
  flex: 1;
  text-align: left;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.account-menu-icon {
  color: var(--text-secondary);
  font-size: 15px;
}
</style>
