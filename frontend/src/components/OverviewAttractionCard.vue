<template>
  <div class="overview-card-item">
    <div class="card-img">
      <img v-if="imageSrc" :src="imageSrc" :alt="item.name" loading="lazy" @error="emit('image-error', item.name)" />
      <div v-else class="image-placeholder">{{ item.name }}</div>
      <svg data-name="Layer 1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 120" preserveAspectRatio="none">
        <path d="M0,0V46.29c47.79,22.2,103.59,32.17,158,28,70.36-5.37,136.33-33.31,206.8-37.5C438.64,32.43,512.34,53.67,583,72.05c69.27,18,138.3,24.88,209.4,13.08,36.15-6,69.85-17.84,104.45-29.34C989.49,25,1113-14.29,1200,52.47V0Z" opacity=".25" class="shape-fill"></path>
        <path d="M0,0V15.81C13,36.92,27.64,56.86,47.69,72.05,99.41,111.27,165,111,224.58,91.58c31.15-10.15,60.09-26.07,89.67-39.8,40.92-19,84.73-46,130.83-49.67,36.26-2.85,70.9,9.42,98.6,31.56,31.77,25.39,62.32,62,103.63,73,40.44,10.79,81.35-6.69,119.13-24.28s75.16-39,116.92-43.05c59.73-5.85,113.28,22.88,168.9,38.84,30.2,8.66,59,6.17,87.09-7.5,22.43-10.89,48-26.93,60.65-49.24V0Z" opacity=".5" class="shape-fill"></path>
        <path d="M0,0V5.63C149.93,59,314.09,71.32,475.83,42.57c43-7.64,84.23-20.12,127.61-26.46,59-8.63,112.48,12.24,165.56,35.4C827.93,77.22,886,95.24,951.2,90c86.53-7,172.46-45.71,248.8-84.81V0Z" class="shape-fill"></path>
      </svg>
      <span class="day-badge">D{{ item.dayArrayIndex + 1 }}</span>
      <button type="button" class="show-more" :aria-label="item.name" @click="emit('select-day', item.dayArrayIndex)">
        <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M17.25 8.25L21 12m0 0l-3.75 3.75M21 12H3"></path>
        </svg>
      </button>
    </div>
    <div class="card-content">
      <h2>{{ item.name }}</h2>
      <p>{{ item.description || item.address || t('common.noData') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

type OverviewAttractionItem = {
  name: string
  address: string
  visit_duration: number
  description: string
  dayArrayIndex: number
}

defineProps<{
  item: OverviewAttractionItem
  imageSrc: string
}>()

const emit = defineEmits<{
  (e: 'select-day', dayArrayIndex: number): void
  (e: 'image-error', name: string): void
}>()

const { t } = useI18n()
</script>

<style scoped lang="scss">
.overview-card-item {
  width: 100%;
  display: flex;
  flex-direction: column;
  background-color: #FFFFFF;
  border: 1px solid rgba(100, 80, 60, 0.1);
  border-radius: 14px;
  box-shadow: 0 4px 16px rgba(100, 80, 60, 0.06);
  overflow: hidden;
  transition: transform 0.2s ease, box-shadow 0.2s ease;

  &:hover {
    transform: translateY(-3px);
    box-shadow: 0 10px 28px rgba(100, 80, 60, 0.14);
  }
}

.card-img {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 3;
  flex-shrink: 0;
  overflow: hidden;
  line-height: 0;
  background-color: #F5EDE4;

  img {
    width: 100%;
    height: 100%;
    position: absolute;
    inset: 0;
    object-fit: cover;
    z-index: 0;
    transition: transform 0.3s ease-in-out;
  }

  .image-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #E8DFD5 0%, #D9CBB8 100%);
    color: #8B7B6E;
    font-size: 1rem;
    font-weight: 600;
    text-align: center;
    padding: 1rem;
  }

  > svg {
    position: absolute;
    bottom: -1px;
    left: 0;
    display: block;
    width: calc(300% + 1.3px);
    height: 3.5rem;
    transform: scaleY(-1);
    z-index: 1;
  }

  .shape-fill {
    fill: #FFFFFF;
  }

  .day-badge {
    position: absolute;
    left: 0.65rem;
    top: 0.65rem;
    z-index: 2;
    padding: 0.15rem 0.6rem;
    border-radius: 999px;
    background: rgba(61, 50, 41, 0.55);
    backdrop-filter: blur(6px);
    color: #fff;
    font-size: 0.75rem;
    font-weight: 700;
    line-height: 1.5;
    letter-spacing: 0.04em;
  }

  .show-more {
    position: absolute;
    right: 0.65rem;
    bottom: 0.85rem;
    z-index: 2;
    width: 2.25rem;
    height: 2.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: rgba(217, 119, 87, 0.92);
    border-radius: 50%;
    box-shadow: 0 0.25rem 0.75rem rgba(61, 50, 41, 0.25);
    cursor: pointer;
    opacity: 0;
    transform: translateY(4px);
    transition: opacity 0.2s ease, transform 0.2s ease, background 0.2s ease;

    &:hover {
      background: #C4654A;
    }

    svg {
      width: 1.25rem;
      height: 1.25rem;
      color: #fff;
    }
  }
}

.overview-card-item:hover .card-img img {
  transform: scale(1.06);
}

.overview-card-item:hover .show-more {
  opacity: 1;
  transform: translateY(0);
}

.card-content {
  position: relative;
  z-index: 2;
  background: #FFFFFF;
  padding: 0.15rem 1.1rem 1rem;
  flex: 1;
  display: flex;
  flex-direction: column;

  h2 {
    margin: 0 0 0.35rem;
    color: #3D3229;
    font-weight: 700;
    font-size: 1.05rem;
    line-height: 1.4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  p {
    margin: 0;
    color: #6B5D52;
    line-height: 1.6;
    font-size: 0.82rem;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}
</style>
