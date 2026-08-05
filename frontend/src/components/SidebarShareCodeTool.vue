<template>
  <section class="sidebar-share-tool">
    <button
      :id="triggerId"
      type="button"
      class="sidebar-share-tool__trigger"
      :class="{ 'sidebar-share-tool__trigger--expanded': expanded }"
      :aria-expanded="expanded"
      :aria-controls="panelId"
      @click="expanded = !expanded"
    >
      <LinkOutlined class="sidebar-share-tool__link" aria-hidden="true" />
      <span class="sidebar-share-tool__label">{{ t('shareCode.entryTitle') }}</span>
      <DownOutlined
        class="sidebar-share-tool__chevron"
        :class="{ 'sidebar-share-tool__chevron--expanded': expanded }"
        aria-hidden="true"
      />
    </button>

    <Transition name="share-tool-panel">
      <div
        v-if="expanded"
        :id="panelId"
        class="sidebar-share-tool__panel"
        role="region"
        :aria-labelledby="triggerId"
      >
        <ShareCodeEntry compact autofocus />
      </div>
    </Transition>
  </section>
</template>

<script setup lang="ts">
import { ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { DownOutlined, LinkOutlined } from '@ant-design/icons-vue'
import ShareCodeEntry from '@/components/ShareCodeEntry.vue'

const { t } = useI18n()
const id = useId()
const triggerId = `sidebar-share-trigger-${id}`
const panelId = `sidebar-share-panel-${id}`
const expanded = ref(false)
</script>

<style scoped>
.sidebar-share-tool {
  padding: 10px 12px 8px;
}

.sidebar-share-tool__trigger {
  width: 100%;
  min-height: 44px;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: #6b5d52;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) 14px;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.sidebar-share-tool__trigger:hover,
.sidebar-share-tool__trigger--expanded {
  border-color: rgba(217, 119, 87, 0.2);
  background: rgba(217, 119, 87, 0.08);
  color: #c4603d;
}

.sidebar-share-tool__trigger:focus-visible {
  outline: 2px solid #d97757;
  outline-offset: 2px;
}

.sidebar-share-tool__link {
  font-size: 16px;
}

.sidebar-share-tool__label {
  min-width: 0;
  overflow-wrap: anywhere;
}

.sidebar-share-tool__chevron {
  justify-self: end;
  color: rgba(61, 50, 41, 0.45);
  font-size: 11px;
  transition: transform 0.15s ease;
}

.sidebar-share-tool__chevron--expanded {
  transform: rotate(180deg);
}

.sidebar-share-tool__panel {
  padding: 10px 0 2px;
}

.share-tool-panel-enter-active,
.share-tool-panel-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.share-tool-panel-enter-from,
.share-tool-panel-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (prefers-reduced-motion: reduce) {
  .sidebar-share-tool__trigger,
  .sidebar-share-tool__chevron,
  .share-tool-panel-enter-active,
  .share-tool-panel-leave-active {
    transition: none;
  }
}
</style>
