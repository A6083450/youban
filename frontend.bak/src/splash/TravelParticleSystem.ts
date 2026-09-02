import * as THREE from 'three'

// 旅行粒子系统：尘埃漂浮 →(uFormation 0→1)→ 聚合成地球轮廓
// 全部运动在 GPU，JS 每帧只更新 uTime/uFormation
export class TravelParticleSystem {
  readonly points: THREE.Points
  readonly uniforms: Record<string, THREE.IUniform>

  constructor(count: number, pixelRatio: number) {
    const seeds = new Float32Array(count * 3)
    const sizes = new Float32Array(count)
    const warmth = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      seeds[i * 3] = Math.random()
      seeds[i * 3 + 1] = Math.random()
      seeds[i * 3 + 2] = Math.random()
      sizes[i] = 0.6 + Math.random() * 1.6
      warmth[i] = Math.random() < 0.35 ? 0.5 + Math.random() * 0.5 : Math.random() * 0.3
    }
    const geo = new THREE.BufferGeometry()
    // position 占位，实际位置在 vertex shader 内由 seed 计算
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3))
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
    geo.setAttribute('aWarmth', new THREE.BufferAttribute(warmth, 1))
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50)

    this.uniforms = {
      uTime: { value: 0 },
      uFormation: { value: 0 },
      uFade: { value: 1 },
      uPixelRatio: { value: pixelRatio },
    }
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      vertexShader: /* glsl */ `
        attribute vec3 aSeed;
        attribute float aSize;
        attribute float aWarmth;
        uniform float uTime;
        uniform float uFormation;
        uniform float uPixelRatio;
        varying float vWarmth;
        varying float vAlpha;
        void main() {
          // 漂移模式：宽域流场，缓慢旋转
          vec3 drift = (aSeed - 0.5) * vec3(11.0, 7.0, 5.0);
          float t = uTime * 0.12;
          drift += 0.7 * vec3(
            sin(t + aSeed.y * 6.283 + drift.y * 1.7),
            cos(t * 0.8 + aSeed.x * 6.283 + drift.x * 1.3),
            sin(t * 0.6 + aSeed.z * 6.283)
          );
          // 地球模式：球面均匀分布 + 轻微脉动
          float z = aSeed.y * 2.0 - 1.0;
          float th = aSeed.x * 6.2831 + uTime * 0.06;
          float rr = sqrt(max(0.0, 1.0 - z * z));
          vec3 globe = vec3(rr * cos(th), rr * sin(th), z)
                     * (2.0 + 0.03 * sin(uTime * 1.5 + aSeed.x * 12.0));

          float f = smoothstep(0.0, 1.0, uFormation);
          vec3 pos = mix(drift, globe, f);
          // 漂移阶段整体缓慢环绕
          float sw = uTime * 0.05 * (1.0 - f);
          float c = cos(sw), s = sin(sw);
          pos.xz = mat2(c, -s, s, c) * pos.xz;

          vec4 mv = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uPixelRatio * (42.0 / max(0.1, -mv.z));
          vWarmth = aWarmth;
          // 穿越时近处粒子淡出，避免糊屏
          vAlpha = smoothstep(0.4, 1.6, -mv.z);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uFade;
        varying float vWarmth;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float alpha = smoothstep(0.5, 0.06, d) * vAlpha * uFade;
          if (alpha < 0.003) discard;
          // 浅底上粒子要偏饱和才可见：暖沙金尘埃
          vec3 sand = vec3(0.90, 0.78, 0.55);
          vec3 gold = vec3(0.85, 0.55, 0.14);
          vec3 col = mix(sand, gold, vWarmth);
          gl_FragColor = vec4(col, alpha * 0.55);
        }
      `,
    })
    this.points = new THREE.Points(geo, mat)
    this.points.frustumCulled = false
  }

  update(time: number) {
    this.uniforms.uTime.value = time
  }
}
