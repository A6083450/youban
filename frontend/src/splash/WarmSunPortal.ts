import * as THREE from 'three'
import { NOISE_GLSL } from './shaders'

// 阶段一：晨光门户 —— 奶油渐变天空 + 日出金光 + 轻微体积光，全屏正交层
export class WarmSunPortal {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  readonly uniforms: Record<string, THREE.IUniform>

  constructor(octaves: number) {
    this.uniforms = {
      uTime: { value: 0 },
      uSunrise: { value: 0 }, // 0→1 太阳升起
      uAspect: { value: 1 },
    }
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uSunrise;
        uniform float uAspect;
        varying vec2 vUv;
        ${NOISE_GLSL}
        void main() {
          // 纸张质感渐变：奶油白 → 浅沙 → 暖米（略降亮度，给金光留出层次空间）
          vec3 top = vec3(0.980, 0.945, 0.880);
          vec3 mid = vec3(0.950, 0.890, 0.780);
          vec3 bot = vec3(0.920, 0.835, 0.690);
          vec3 col = mix(bot, mid, smoothstep(0.0, 0.55, vUv.y));
          col = mix(col, top, smoothstep(0.55, 1.0, vUv.y));
          // 细腻纸纹
          float grain = fbm(vec3(vUv * vec2(uAspect, 1.0) * 6.0, uTime * 0.02), ${octaves});
          col += (grain - 0.5) * 0.03;

          // 边缘轻微压暗，衬托中央光源
          float vig = smoothstep(0.35, 1.1, length((vUv - 0.5) * vec2(uAspect, 1.0)));
          col *= 1.0 - 0.10 * vig;

          // 太阳从地平线附近升起
          vec2 sunPos = vec2(0.5, mix(0.16, 0.40, uSunrise));
          vec2 d = vUv - sunPos;
          d.x *= uAspect;
          float dist = length(d);
          float sunRise = smoothstep(0.0, 1.0, uSunrise);
          // 核心光斑 + 大范围暖晕：向深金色偏移（浅底上加光无效，要改色相）
          float core = exp(-dist * dist * 90.0);
          float halo = exp(-dist * 3.0);
          vec3 deepGold = vec3(0.96, 0.60, 0.22);
          vec3 paleGold = vec3(0.99, 0.80, 0.45);
          float glowAmt = clamp(core * 1.2 + halo * 0.45, 0.0, 1.0) * (0.25 + 0.75 * sunRise);
          col = mix(col, mix(paleGold, deepGold, core), glowAmt);
          // 白炽中心
          col += vec3(1.0, 0.92, 0.75) * core * core * 0.9 * sunRise;

          // 体积光：绕太阳的放射条纹，噪声扰动缓慢摆动
          float ang = atan(d.y, d.x);
          float rays = fbm(vec3(ang * 3.0, dist * 2.0 - uTime * 0.05, uTime * 0.03), 2);
          float rayMask = exp(-dist * 2.0) * smoothstep(0.02, 0.2, dist);
          col = mix(col, paleGold, rays * rayMask * 0.30 * sunRise);

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    })
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat))
  }

  setAspect(aspect: number) {
    this.uniforms.uAspect.value = aspect
  }

  update(time: number) {
    this.uniforms.uTime.value = time
  }
}
