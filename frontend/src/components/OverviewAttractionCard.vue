<template>
  <article class="overview-card-item" :aria-label="item.name">
    <div :class="['card-img', `card-img--${visualIndex % 5}`]">
      <img v-if="imageSrc" :src="imageSrc" :alt="item.name" loading="lazy" @error="emit('image-error', item.name)" />
      <div v-else class="image-placeholder">{{ item.name }}</div>
      <span class="day-badge">D{{ item.dayArrayIndex + 1 }}</span>
      <button
        type="button"
        class="show-more"
        :aria-label="`${item.name} - ${t('result.side.days')}`"
        :title="t('result.side.days')"
        @click="emit('select-day', item.dayArrayIndex)"
      >
        <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M17.25 8.25L21 12m0 0l-3.75 3.75M21 12H3"></path>
        </svg>
      </button>
    </div>
    <div class="card-content">
      <h2>{{ item.name }}</h2>
      <p>{{ item.description || item.address || t('common.noData') }}</p>
    </div>
  </article>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

type OverviewAttractionItem = {
  readonly name: string
  readonly address: string
  readonly visit_duration: number
  readonly description: string
  readonly dayArrayIndex: number
}

defineProps<{
  readonly item: OverviewAttractionItem
  readonly imageSrc: string
  readonly visualIndex: number
}>()

const emit = defineEmits<{
  (e: 'select-day', dayArrayIndex: number): void
  (e: 'image-error', name: string): void
}>()

const { t } = useI18n()
</script>

<style scoped lang="scss">
/* 入场错开(GSAP)与图片持续漂移(Anime.js)由 Result.vue 驱动,
   组件内不声明对应 CSS 动画,避免与内联样式冲突 */
.overview-card-item {
  width: 100%;
  min-width: 0;
  display: inline-flex;
  flex-direction: column;
  margin: 0 0 20px;
  border: 0;
  background: transparent;
  box-shadow: none;
  break-inside: avoid;
}

.card-img {
  position: relative;
  width: 100%;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: 10px;
  line-height: 0;
  background: var(--surface-soft);

  img {
    width: 100%;
    height: 100%;
    position: absolute;
    inset: 0;
    object-fit: cover;
    z-index: 0;
    transition: transform 0.25s ease;
  }

  .image-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-soft);
    color: var(--text-secondary);
    font-size: 14px;
    font-weight: 600;
    line-height: 1.5;
    text-align: center;
    padding: 16px;
  }

  .day-badge {
    position: absolute;
    left: 0.65rem;
    top: 0.65rem;
    z-index: 2;
    padding: 2px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--text-primary) 68%, transparent);
    backdrop-filter: blur(6px);
    color: var(--surface-elevated);
    font-size: 12px;
    font-weight: 700;
    line-height: 1.5;
    letter-spacing: 0;
  }

  .show-more {
    position: absolute;
    right: 0.65rem;
    bottom: 0.85rem;
    z-index: 2;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: var(--accent-primary);
    border-radius: 50%;
    box-shadow: 0 4px 12px color-mix(in srgb, var(--text-primary) 25%, transparent);
    cursor: pointer;
    opacity: 0;
    transform: translateY(4px);
    transition: opacity 0.2s ease, transform 0.2s ease, background 0.2s ease;

    &:hover {
      background: var(--accent-strong);
    }

    &:focus-visible {
      opacity: 1;
      outline: 2px solid var(--accent-primary);
      outline-offset: 2px;
      transform: translateY(0);
    }

    svg {
      width: 18px;
      height: 18px;
      color: var(--surface-elevated);
    }
  }
}

.card-img--0 {
  aspect-ratio: 4 / 3;
}

.card-img--1 {
  aspect-ratio: 3 / 4;
}

.card-img--2 {
  aspect-ratio: 1;
}

.card-img--3 {
  aspect-ratio: 4 / 5;
}

.card-img--4 {
  aspect-ratio: 5 / 4;
}

.overview-card-item:hover .card-img img {
  transform: scale(1.06);
}

.overview-card-item:hover .show-more {
  opacity: 1;
  transform: translateY(0);
}

.card-content {
  padding: 10px 4px 0;
  display: flex;
  flex-direction: column;

  h2 {
    margin: 0 0 4px;
    color: var(--text-primary);
    font-weight: 600;
    font-size: 15px;
    line-height: 1.45;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: break-word;
    word-break: auto-phrase;
    text-wrap: pretty;
    transition: color 0.15s ease;
  }

  p {
    margin: 0;
    color: var(--text-secondary);
    line-height: 1.5;
    font-size: 13px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-overflow: ellipsis;
    overflow-wrap: break-word;
    word-break: auto-phrase;
    text-wrap: balance;
  }
}

.overview-card-item:hover .card-content h2 {
  color: var(--accent-strong);
}

@media (hover: none) {
  .card-img .show-more {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
