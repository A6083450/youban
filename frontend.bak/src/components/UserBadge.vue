<template>
  <div v-if="currentUser" class="user-badge" :class="{ 'user-badge--compact': compact }">
    <a-dropdown :placement="embeddedMiniProgram || compact ? 'bottomRight' : 'topLeft'" :trigger="['click']">
      <button class="user-badge-btn" type="button" :aria-label="currentUser.nickname" :title="compact ? currentUser.nickname : undefined">
        <span class="user-avatar">
          <img v-if="currentUser.avatar_url" :src="currentUser.avatar_url" alt="" />
          <span v-else>{{ initial }}</span>
        </span>
        <span class="user-nickname">{{ currentUser.nickname }}</span>
      </button>
      <template #overlay>
        <a-menu>
          <a-menu-item key="memories" @click="memoryOpen = true">
            <DatabaseOutlined class="account-menu-icon" aria-hidden="true" />
            <span>{{ t('user.myMemories') }}</span>
          </a-menu-item>
          <a-menu-item v-if="embeddedMiniProgram" key="avatar" @click="changeAvatar">
            <UserOutlined class="account-menu-icon" aria-hidden="true" />
            <span>更换微信头像</span>
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
import { DatabaseOutlined, SwapOutlined, UserOutlined } from '@ant-design/icons-vue'
import { currentUser, logout } from '@/stores/auth'
import MemoryModal from '@/components/MemoryModal.vue'
import {
  isMiniProgramEmbedded,
  navigateToNativeAccountAction,
} from '@/platform/miniProgramHost'

withDefaults(defineProps<{ compact?: boolean }>(), {
  compact: false,
})

const { t } = useI18n()
const router = useRouter()
const memoryOpen = ref(false)
const embeddedMiniProgram = isMiniProgramEmbedded()

const initial = computed(() =>
  (currentUser.value?.nickname || '?').trim().charAt(0).toUpperCase(),
)

const handleLogout = async () => {
  await logout()
  if (embeddedMiniProgram && navigateToNativeAccountAction('logout')) return
  await router.replace('/login')
}

const changeAvatar = () => {
  navigateToNativeAccountAction('avatar')
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
  overflow: hidden;
}
.user-avatar img { width: 100%; height: 100%; object-fit: cover; }
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
.user-badge--compact {
  width: 44px;
}
.user-badge--compact .user-badge-btn {
  justify-content: center;
  width: 44px;
  height: 44px;
  min-height: 44px;
  padding: 7px;
}
.user-badge--compact .user-nickname {
  display: none;
}
</style>
