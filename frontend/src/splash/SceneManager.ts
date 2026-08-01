import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import gsap from 'gsap'
import { WarmSunPortal } from './WarmSunPortal'
import { TravelParticleSystem } from './TravelParticleSystem'
import { Globe } from './Globe'
import { LightTransition } from './LightTransition'

export interface SplashCallbacks {
  onDone: () => void
}

type Tier = 'high' | 'medium' | 'low'

const TIERS: Record<Tier, { particles: number; bloomScale: number; octaves: number; bloom: boolean }> = {
  high: { particles: 15000, bloomScale: 0.5, octaves: 4, bloom: true },
  medium: { particles: 8000, bloomScale: 0.25, octaves: 3, bloom: true },
  low: { particles: 3000, bloomScale: 0.25, octaves: 2, bloom: false },
}

function detectTier(): Tier {
  const mobile = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
  const cores = navigator.hardwareConcurrency || 4
  if (!mobile) return 'high'
  return cores >= 6 ? 'medium' : 'low'
}

export class SceneManager {
  private renderer: THREE.WebGLRenderer
  private composer: EffectComposer
  private camera: THREE.PerspectiveCamera
  private portal: WarmSunPortal
  private particles: TravelParticleSystem
  private globe: Globe
  private transition: LightTransition
  private mainScene = new THREE.Scene()
  private clock = new THREE.Clock()
  private timeline: gsap.core.Timeline
  private raf = 0
  private disposed = false

  constructor(canvas: HTMLCanvasElement, cb: SplashCallbacks) {
    const tier = TIERS[detectTier()]
    const dpr = Math.min(window.devicePixelRatio || 1, tier === TIERS.low ? 1.5 : 2)

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.autoClear = true

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100)
    this.camera.position.set(0, 0.4, 8)
    this.camera.lookAt(0, 0, 0)

    this.portal = new WarmSunPortal(tier.octaves)
    this.portal.setAspect(this.camera.aspect)
    this.particles = new TravelParticleSystem(tier.particles, dpr)
    this.globe = new Globe(tier.octaves)
    this.transition = new LightTransition()
    this.mainScene.add(this.particles.points, this.globe.group)

    // 合成顺序：晨光背景 → 粒子/地球 → 光幕 → Bloom
    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.portal.scene, this.portal.camera))
    const mainPass = new RenderPass(this.mainScene, this.camera)
    mainPass.clear = false
    this.composer.addPass(mainPass)
    const overlayPass = new RenderPass(this.transition.scene, this.transition.camera)
    overlayPass.clear = false
    this.composer.addPass(overlayPass)
    if (tier.bloom) {
      const size = this.renderer.getSize(new THREE.Vector2()).multiplyScalar(tier.bloomScale)
      this.composer.addPass(new UnrealBloomPass(size, 0.45, 0.7, 0.97))
    }
    this.composer.addPass(new OutputPass())

    // 三阶段编排
    const u = {
      sunrise: this.portal.uniforms.uSunrise,
      formation: this.particles.uniforms.uFormation,
      globeP: this.globe.uniforms.uProgress,
      cities: this.globe.citiesProgress,
      fade: this.particles.uniforms.uFade,
      light: this.transition.uniforms.uIntensity,
    }
    this.timeline = gsap.timeline({
      defaults: { ease: 'power2.inOut' },
      onComplete: () => cb.onDone(),
    })
    this.timeline
      // 阶段一：日出（0–1.8s）
      .to(u.sunrise, { value: 1, duration: 1.8 }, 0)
      .to(this.camera.position, { z: 7.2, duration: 1.8, ease: 'sine.inOut' }, 0)
      // 阶段二：世界形成（1.6–3.6s）
      .to(u.formation, { value: 1, duration: 1.6 }, 1.6)
      .to(u.globeP, { value: 1, duration: 1.2 }, 2.2)
      .to(u.cities, { value: 1, duration: 1.2, ease: 'power1.in' }, 2.4)
      .to(this.camera.position, { z: 5.6, y: 0.15, duration: 2.0, ease: 'sine.inOut' }, 1.6)
      // 阶段三：穿越光幕（3.8–5.2s）
      .to(this.camera.position, { z: -0.5, y: 0, duration: 1.4, ease: 'power2.in' }, 3.8)
      .to(this.camera, { fov: 75, duration: 1.4, ease: 'power2.in', onUpdate: () => this.camera.updateProjectionMatrix() }, 3.8)
      .to(u.light, { value: 1, duration: 1.1, ease: 'power2.in' }, 4.0)
      .to(u.fade, { value: 0.15, duration: 1.0 }, 4.0)
      // 收尾停顿，等 Vue 层做 CSS 淡出
      .to({}, { duration: 0.15 })

    window.addEventListener('resize', this.onResize)
    this.loop()
  }

  private onResize = () => {
    const w = window.innerWidth
    const h = window.innerHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.portal.setAspect(this.camera.aspect)
    this.renderer.setSize(w, h)
    this.composer.setSize(w, h)
  }

  private loop = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.loop)
    const t = this.clock.getElapsedTime()
    this.portal.update(t)
    this.particles.update(t)
    this.globe.update(t)
    this.composer.render()
  }

  skip() {
    // 快进到穿越段，保留收尾的完整感
    if (this.timeline.progress() < 0.72) {
      this.timeline.seek(3.8)
    }
    this.timeline.timeScale(1.6)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.timeline.kill()
    window.removeEventListener('resize', this.onResize)
    this.mainScene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
        obj.geometry.dispose()
        const mat = obj.material as THREE.Material
        mat.dispose()
      }
    })
    this.composer.dispose()
    this.renderer.dispose()
  }
}
