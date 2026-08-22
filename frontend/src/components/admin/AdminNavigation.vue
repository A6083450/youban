<template>
  <nav class="admin-navigation" :aria-label="t('admin.navigation.label')">
    <div class="admin-navigation-items">
      <button
        v-for="item in ADMIN_SECTIONS"
        :key="item.id"
        type="button"
        class="admin-navigation-item"
        :class="{ active: activeSection === item.id }"
        :aria-current="activeSection === item.id ? 'page' : undefined"
        @click="emit('select', item.id)"
      >
        <component :is="sectionIcons[item.id]" class="admin-navigation-icon" aria-hidden="true" />
        <span>{{ t(item.labelKey) }}</span>
      </button>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { CompassOutlined, SettingOutlined, ToolOutlined } from '@ant-design/icons-vue'
import { useI18n } from 'vue-i18n'
import { ADMIN_SECTIONS } from '@/admin/navigation'
import type { AdminSection } from '@/admin/navigation'

defineProps<{
  activeSection: AdminSection
}>()

const emit = defineEmits<{
  select: [section: AdminSection]
}>()

const { t } = useI18n()
const sectionIcons = {
  settings: SettingOutlined,
  skills: ToolOutlined,
  trips: CompassOutlined,
}
</script>

<style scoped>
.admin-navigation {
  position: relative;
  display: flex;
  width: 212px;
  flex: 0 0 212px;
  align-self: stretch;
  background: #292725;
}

.admin-navigation-items {
  position: sticky;
  top: 20px;
  flex-direction: column;
  display: flex;
  gap: 4px;
  padding: 12px;
}

.admin-navigation-item {
  display: flex;
  align-items: center;
  gap: 11px;
  min-height: 44px;
  width: 100%;
  padding: 0 13px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  font-size: 14px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.admin-navigation-item:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.admin-navigation-item.active {
  border-color: rgba(229, 135, 99, 0.38);
  background: rgba(196, 96, 61, 0.22);
  color: #fff;
}

.admin-navigation-item:focus-visible {
  outline: 3px solid #f0a283;
  outline-offset: 2px;
}

.admin-navigation-icon {
  flex: 0 0 auto;
  font-size: 17px;
}

@media (max-width: 760px) {
  .admin-navigation {
    position: sticky;
    top: 0;
    z-index: 20;
    width: 100%;
    flex: none;
    padding: 0;
    gap: 0;
    background: #fff;
    border-bottom: 1px solid rgba(61, 50, 41, 0.12);
  }

  .admin-navigation-items {
    position: static;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0;
    padding: 0;
  }

  .admin-navigation-item {
    justify-content: center;
    gap: 6px;
    min-width: 0;
    min-height: 48px;
    padding: 0 6px;
    border: 0;
    border-bottom: 3px solid transparent;
    border-radius: 0;
    color: #665e57;
    font-size: 12px;
    white-space: nowrap;
  }

  .admin-navigation-item:hover {
    background: rgba(61, 50, 41, 0.04);
    color: #3d3229;
  }

  .admin-navigation-item.active {
    border-color: #c4603d;
    background: rgba(196, 96, 61, 0.08);
    color: #9f482c;
  }

  .admin-navigation-icon {
    font-size: 15px;
  }
}

@media (max-width: 350px) {
  .admin-navigation-item {
    gap: 4px;
    padding: 0 3px;
    font-size: 11px;
  }
}
</style>
