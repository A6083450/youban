<template>
  <header
    v-if="state.variant !== 'hidden' && (state.showMenu || state.showHome || state.showNewPlan || state.showAccount)"
    class="mobile-app-header"
    :class="{
      'mobile-app-header--mini-program': embeddedMiniProgram,
      'mobile-app-header--public': state.variant === 'public',
    }"
  >
    <div class="mobile-app-header__row">
      <button
        v-if="state.showMenu"
        type="button"
        class="mobile-app-header__button"
        :aria-label="t('sidebar.plans')"
        :title="t('sidebar.plans')"
        @click="emit('open-menu')"
      >
        <MenuOutlined aria-hidden="true" />
      </button>
      <button
        v-else-if="state.showHome"
        type="button"
        class="mobile-app-header__button"
        :aria-label="t('app.navigation.home')"
        :title="t('app.navigation.home')"
        @click="emit('go-home')"
      >
        <HomeOutlined aria-hidden="true" />
      </button>

      <router-link to="/" class="mobile-app-header__brand">{{ t('app.brand') }}</router-link>

      <div class="mobile-app-header__actions">
        <button
          v-if="state.showNewPlan"
          type="button"
          class="mobile-app-header__button mobile-app-header__button--accent"
          :aria-label="t('sidebar.newPlan')"
          :title="t('sidebar.newPlan')"
          @click="emit('new-plan')"
        >
          <PlusOutlined aria-hidden="true" />
        </button>
        <UserBadge v-if="state.showAccount" compact />
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { HomeOutlined, MenuOutlined, PlusOutlined } from '@ant-design/icons-vue'
import { useI18n } from 'vue-i18n'
import UserBadge from '@/components/UserBadge.vue'
import type { MobileHeaderState } from '@/platform/miniProgramHost'

defineProps<{
  state: MobileHeaderState
  embeddedMiniProgram: boolean
}>()

const emit = defineEmits<{
  (event: 'open-menu'): void
  (event: 'new-plan'): void
  (event: 'go-home'): void
}>()

const { t } = useI18n()
</script>

<style scoped>
.mobile-app-header {
  position: relative;
  z-index: 90;
  display: none;
  flex: 0 0 auto;
  background: var(--surface-navigation);
  border-bottom: 1px solid var(--border-subtle);
}

.mobile-app-header__row {
  position: relative;
  display: flex;
  align-items: center;
  height: 52px;
  padding: 4px 12px;
}

.mobile-app-header__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  min-width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 21px;
  line-height: 1;
  cursor: pointer;
}

.mobile-app-header__button:hover {
  background: var(--surface-soft);
}

.mobile-app-header__button:focus-visible,
.mobile-app-header__brand:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}

.mobile-app-header__button--accent {
  color: var(--accent-strong);
}

.mobile-app-header__brand {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: var(--text-primary);
  font-size: 17px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0;
  text-decoration: none;
  white-space: nowrap;
}

.mobile-app-header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin-left: auto;
}

.mobile-app-header--mini-program {
  display: block;
}

.mobile-app-header--mini-program .mobile-app-header__row {
  height: 44px;
  padding: 0 8px;
}

.mobile-app-header--mini-program .mobile-app-header__brand {
  display: none;
}

@media (max-width: 768px) {
  .mobile-app-header {
    display: block;
  }
}

@media (max-width: 350px) {
  .mobile-app-header__row {
    padding-left: 8px;
  }
}
</style>
