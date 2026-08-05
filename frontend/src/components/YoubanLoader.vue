<template>
  <div
    class="youban-loader"
    :class="{ 'youban-loader--compact': compact }"
    role="status"
    aria-live="polite"
  >
    <svg
      class="youban-loader__mark"
      viewBox="0 0 512 512"
      aria-hidden="true"
    >
      <g transform="translate(256,259) scale(1.34) translate(-256,-259)">
        <g class="youban-loader__foot youban-loader__foot--left">
          <path
            fill="var(--accent-primary)"
            transform="translate(0,7)"
            d="M242,150 C244,118 214,94 178,97 C136,102 106,148 100,222 C94,300 108,378 138,406 C160,424 196,422 210,398 C222,368 230,260 242,150 Z"
          />
        </g>
        <g class="youban-loader__foot youban-loader__foot--right">
          <g transform="translate(512,-7) scale(-1,1)">
            <path
              fill="var(--brand-companion)"
              d="M242,150 C244,118 214,94 178,97 C136,102 106,148 100,222 C94,300 108,378 138,406 C160,424 196,422 210,398 C222,368 230,260 242,150 Z"
            />
          </g>
        </g>
      </g>
    </svg>

    <strong class="youban-loader__brand">游伴</strong>
    <span class="youban-loader__message">{{ message }}</span>
    <span class="youban-loader__dots" aria-hidden="true">
      <i></i><i></i><i></i>
    </span>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  message: string
  compact?: boolean
}>(), {
  compact: false,
})
</script>

<style scoped>
.youban-loader {
  display: flex;
  flex-direction: column;
  align-items: center;
  inline-size: 100%;
  color: var(--text-primary);
  text-align: center;
}

.youban-loader__mark {
  inline-size: 88px;
  block-size: 88px;
  animation: youban-mark-sway 1.4s ease-in-out infinite;
  overflow: visible;
}

.youban-loader__foot {
  transform-box: fill-box;
  transform-origin: center;
  animation: youban-foot-step 1.4s ease-in-out infinite;
}

.youban-loader__foot--right {
  animation-delay: -0.7s;
}

.youban-loader__brand {
  margin-block-start: 8px;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.3;
}

.youban-loader__message {
  margin-block-start: 12px;
  min-block-size: 24px;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.6;
}

.youban-loader__dots {
  display: flex;
  gap: 8px;
  margin-block-start: 20px;
}

.youban-loader__dots i {
  inline-size: 7px;
  block-size: 7px;
  border-radius: 50%;
  background: var(--text-secondary);
  animation: youban-dot-pulse 1.2s ease-in-out infinite;
}

.youban-loader__dots i:nth-child(2) { animation-delay: 0.16s; }
.youban-loader__dots i:nth-child(3) { animation-delay: 0.32s; }

.youban-loader--compact .youban-loader__mark {
  inline-size: 72px;
  block-size: 72px;
}

.youban-loader--compact .youban-loader__brand {
  margin-block-start: 4px;
  font-size: 24px;
}

.youban-loader--compact .youban-loader__message {
  margin-block-start: 8px;
}

.youban-loader--compact .youban-loader__dots {
  margin-block-start: 12px;
}

@keyframes youban-foot-step {
  0%, 100% { transform: translate3d(-2px, 1px, 0) rotate(-1deg); }
  50% { transform: translate3d(3px, -7px, 0) rotate(4deg); }
}

@keyframes youban-mark-sway {
  0%, 100% { transform: translateX(-2px) rotate(-1deg); }
  50% { transform: translateX(2px) rotate(1deg); }
}

@keyframes youban-dot-pulse {
  0%, 80%, 100% { opacity: 0.28; transform: scale(0.75); }
  40% { opacity: 0.9; transform: scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .youban-loader__mark,
  .youban-loader__foot {
    animation: none;
  }

  .youban-loader__dots i {
    animation-name: youban-dot-fade;
  }
}

@keyframes youban-dot-fade {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 0.75; }
}
</style>
