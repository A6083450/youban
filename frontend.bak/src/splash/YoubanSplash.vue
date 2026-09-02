<template>
  <div
    v-if="visible"
    class="youban-splash"
    :class="{ 'is-leaving': leaving, 'is-static': staticMode }"
    aria-hidden="true"
    @click="skip"
  >
    <div class="splash-fallback"></div>
    <canvas v-show="!staticMode" ref="canvasRef" class="splash-canvas"></canvas>
    <div class="splash-brand" :class="{ show: brandShown }">
      <span class="splash-brand-name">游伴</span>
      <span class="splash-brand-sub">YouBan · 你的 AI 旅行伙伴</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const SESSION_KEY = 'youban_splashed'

const visible = ref(false)
const leaving = ref(false)
const staticMode = ref(false)
const brandShown = ref(false)
const canvasRef = ref<HTMLCanvasElement>()

let manager: { skip: () => void; dispose: () => void } | null = null
let hideTimer = 0

function supportsWebGL2(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!c.getContext('webgl2')
  } catch {
    return false
  }
}

function finish() {
  if (leaving.value) return
  leaving.value = true
  brandShown.value = false
  // CSS 淡出后移除并释放 GPU 资源
  hideTimer = window.setTimeout(() => {
    visible.value = false
    manager?.dispose()
    manager = null
  }, 850)
}

function skip() {
  if (staticMode.value) {
    finish()
    return
  }
  manager?.skip()
}

onMounted(async () => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  // ?splash=1 强制重播完整版，用于预览调试
  const force = new URLSearchParams(location.search).has('splash')
  const seen = !force && sessionStorage.getItem(SESSION_KEY)
  visible.value = true

  // 降级路径：reduced-motion / 无 WebGL2 / 本会话已播放 → 静态暖光快速淡入淡出
  if (reduced || seen || !supportsWebGL2()) {
    staticMode.value = true
    brandShown.value = true
    hideTimer = window.setTimeout(finish, seen ? 700 : 1200)
    return
  }
  sessionStorage.setItem(SESSION_KEY, '1')

  // 懒加载 Three.js chunk，不阻塞首屏
  const { SceneManager } = await import('./SceneManager')
  if (!visible.value || !canvasRef.value) return
  manager = new SceneManager(canvasRef.value, { onDone: finish })
  brandShown.value = true
  // 品牌字在穿越前淡出
  window.setTimeout(() => (brandShown.value = false), 3400)
})

onBeforeUnmount(() => {
  window.clearTimeout(hideTimer)
  manager?.dispose()
  manager = null
})
</script>

<style scoped>
.youban-splash {
  position: fixed;
  inset: 0;
  z-index: 9999;
  cursor: pointer;
  opacity: 1;
  transition: opacity 0.8s ease;
}
.youban-splash.is-leaving {
  opacity: 0;
  pointer-events: none;
}
/* CSS 兜底暖色渐变：WebGL chunk 加载期间 500ms 内即有画面，也是静态降级的主体 */
.splash-fallback {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 60% 45% at 50% 38%, rgba(255, 214, 150, 0.85), rgba(255, 214, 150, 0) 70%),
    linear-gradient(to bottom, #fdf8f0 0%, #f5e9d5 55%, #f0dfc4 100%);
}
.splash-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.splash-brand {
  position: absolute;
  left: 50%;
  top: 62%;
  transform: translate(-50%, 8px);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  opacity: 0;
  transition: opacity 1.2s ease, transform 1.2s ease;
  pointer-events: none;
}
.splash-brand.show {
  opacity: 1;
  transform: translate(-50%, 0);
}
.splash-brand-name {
  font-size: 34px;
  font-weight: 600;
  letter-spacing: 14px;
  text-indent: 14px;
  color: #8a6a3f;
}
.splash-brand-sub {
  font-size: 13px;
  letter-spacing: 3px;
  color: rgba(138, 106, 63, 0.65);
}
</style>
