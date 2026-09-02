<script setup lang="ts">
import { useI18n } from 'vue-i18n'

withDefaults(defineProps<{
  message: string
  compact?: boolean
}>(), {
  compact: false,
})

const { t } = useI18n()
</script>

<template>
  <view
    class="youban-generation-loader"
    :class="{ 'youban-generation-loader--compact': compact }"
    role="status"
    aria-live="polite"
  >
    <view class="youban-generation-loader__mark" aria-hidden="true">
      <view class="youban-generation-loader__foot-frame youban-generation-loader__foot-frame--left">
        <image class="youban-generation-loader__foot-image" src="/static/brand-logo.png" mode="aspectFit" />
      </view>
      <view class="youban-generation-loader__foot-frame youban-generation-loader__foot-frame--right">
        <image class="youban-generation-loader__foot-image youban-generation-loader__foot-image--right" src="/static/brand-logo.png" mode="aspectFit" />
      </view>
    </view>

    <text class="youban-generation-loader__brand">{{ t('app.brand') }}</text>
    <text class="youban-generation-loader__message">{{ message }}</text>
    <view class="youban-generation-loader__dots" aria-hidden="true">
      <text class="youban-generation-loader__dot" />
      <text class="youban-generation-loader__dot" />
      <text class="youban-generation-loader__dot" />
    </view>
  </view>
</template>

<style scoped>
.youban-generation-loader {
  display: flex;
  box-sizing: border-box;
  width: 100%;
  align-items: center;
  flex-direction: column;
  color: var(--text-primary);
  text-align: center;
}

.youban-generation-loader__mark {
  position: relative;
  width: 88px;
  height: 88px;
  animation: youban-mark-sway 1.4s ease-in-out infinite;
}

.youban-generation-loader__foot-frame {
  position: absolute;
  top: 0;
  width: 44px;
  height: 88px;
  overflow: hidden;
  transform-origin: center 70%;
  animation: youban-foot-step 1.4s ease-in-out infinite;
}

.youban-generation-loader__foot-frame--left {
  left: 0;
}

.youban-generation-loader__foot-frame--right {
  left: 44px;
  animation-delay: -0.7s;
}

.youban-generation-loader__foot-image {
  position: absolute;
  top: 0;
  left: 0;
  display: block;
  width: 88px;
  height: 88px;
}

.youban-generation-loader__foot-image--right {
  left: -44px;
}

.youban-generation-loader__brand {
  margin-top: 8px;
  color: var(--text-primary);
  font-size: 28px;
  font-weight: 700;
  line-height: 1.3;
}

.youban-generation-loader__message {
  min-height: 24px;
  margin-top: 12px;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.6;
}

.youban-generation-loader__dots {
  display: flex;
  margin-top: 20px;
  align-items: center;
  gap: 8px;
}

.youban-generation-loader__dot {
  display: block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-secondary);
  animation: youban-dot-pulse 1.2s ease-in-out infinite;
}

.youban-generation-loader__dot:nth-child(2) {
  animation-delay: 0.16s;
}

.youban-generation-loader__dot:nth-child(3) {
  animation-delay: 0.32s;
}

.youban-generation-loader--compact .youban-generation-loader__mark {
  width: 72px;
  height: 72px;
}

.youban-generation-loader--compact .youban-generation-loader__foot-frame {
  width: 36px;
  height: 72px;
}

.youban-generation-loader--compact .youban-generation-loader__foot-frame--right {
  left: 36px;
}

.youban-generation-loader--compact .youban-generation-loader__foot-image {
  width: 72px;
  height: 72px;
}

.youban-generation-loader--compact .youban-generation-loader__foot-image--right {
  left: -36px;
}

.youban-generation-loader--compact .youban-generation-loader__brand {
  margin-top: 4px;
  font-size: 24px;
}

.youban-generation-loader--compact .youban-generation-loader__message {
  margin-top: 8px;
}

.youban-generation-loader--compact .youban-generation-loader__dots {
  margin-top: 12px;
}

@keyframes youban-foot-step {
  0%,
  100% {
    transform: translate(-2px, 1px) rotate(-1deg);
  }

  50% {
    transform: translate(3px, -7px) rotate(4deg);
  }
}

@keyframes youban-mark-sway {
  0%,
  100% {
    transform: translateX(-2px) rotate(-1deg);
  }

  50% {
    transform: translateX(2px) rotate(1deg);
  }
}

@keyframes youban-dot-pulse {
  0%,
  80%,
  100% {
    opacity: 0.28;
    transform: scale(0.75);
  }

  40% {
    opacity: 0.9;
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .youban-generation-loader__mark,
  .youban-generation-loader__foot-frame {
    animation: none;
  }

  .youban-generation-loader__dot {
    animation: youban-dot-fade 1.2s ease-in-out infinite;
  }
}

@keyframes youban-dot-fade {
  0%,
  100% {
    opacity: 0.3;
  }

  50% {
    opacity: 0.75;
  }
}
</style>
