import * as THREE from 'three'
import { NOISE_GLSL } from './shaders'

// 阶段二：程序化地球 —— fbm 抽象大陆 + 发光经纬线 + 晨昏暖光（非真实地图）
export class Globe {
  readonly group = new THREE.Group()
  readonly uniforms: Record<string, THREE.IUniform>
  private citiesUniforms: Record<string, THREE.IUniform>

  get citiesProgress(): THREE.IUniform {
    return this.citiesUniforms.uCities
  }

  constructor(octaves: number, cityCount = 40) {
    this.uniforms = {
      uTime: { value: 0 },
      uProgress: { value: 0 },
    }
    const globeMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vNormal;
        void main() {
          vUv = uv;
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uProgress;
        varying vec2 vUv;
        varying vec3 vNormal;
        ${NOISE_GLSL}
        void main() {
          vec3 n = normalize(vNormal);
          // 抽象大陆：球面 fbm 阈值化（沙金配色，与浅色背景拉开对比）
          float land = fbm(n * 2.6 + vec3(3.1, 7.7, 1.3), ${octaves});
          float isLand = smoothstep(0.52, 0.56, land);
          float edge = smoothstep(0.50, 0.52, land) - smoothstep(0.56, 0.60, land);
          vec3 ocean = vec3(0.870, 0.780, 0.600);
          vec3 soil = vec3(0.700, 0.500, 0.280);
          vec3 col = mix(ocean, soil, isLand);
          col = mix(col, vec3(0.93, 0.63, 0.22), max(edge, 0.0) * 0.7);

          // 发光经纬线
          vec2 grid = abs(fract(vUv * vec2(18.0, 9.0)) - 0.5);
          vec2 fw = fwidth(vUv * vec2(18.0, 9.0)) * 1.4;
          vec2 lineAxis = 1.0 - smoothstep(vec2(0.0), fw, grid);
          float line = max(lineAxis.x, lineAxis.y);
          col = mix(col, vec3(0.88, 0.62, 0.24), line * 0.45);

          // 晨昏暖光：一侧被阳光照亮
          vec3 sunDir = normalize(vec3(sin(uTime * 0.1), 0.25, cos(uTime * 0.1)));
          float day = dot(n, sunDir) * 0.5 + 0.5;
          col *= 0.72 + 0.35 * day;
          col = mix(col, vec3(1.0, 0.85, 0.55), pow(day, 3.0) * 0.15);

          // 边缘金色轮廓（剪影从浅底中跳出）
          float fres = pow(1.0 - abs(n.z), 2.5);
          col = mix(col, vec3(0.85, 0.55, 0.20), fres * 0.65);

          gl_FragColor = vec4(col, uProgress * 0.96);
        }
      `,
    })
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(2, 96, 64), globeMat)
    this.group.add(sphere)

    // 城市光点：InstancedMesh，随机延迟点亮
    this.citiesUniforms = {
      uTime: { value: 0 },
      uCities: { value: 0 },
    }
    const cityGeo = new THREE.SphereGeometry(0.022, 8, 8)
    const delays = new Float32Array(cityCount)
    const cityMat = new THREE.ShaderMaterial({
      uniforms: this.citiesUniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float aDelay;
        uniform float uCities;
        varying float vLit;
        varying float vDelay;
        void main() {
          vLit = smoothstep(aDelay, aDelay + 0.06, uCities);
          vDelay = aDelay;
          vec3 p = position * (0.6 + 0.4 * vLit);
          vec4 wp = instanceMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * modelViewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying float vLit;
        varying float vDelay;
        void main() {
          if (vLit < 0.01) discard;
          float pulse = 0.75 + 0.45 * sin(uTime * 2.2 + vDelay * 40.0);
          vec3 col = vec3(1.0, 0.72, 0.32) * (1.4 + pulse);
          gl_FragColor = vec4(col, vLit * 0.95);
        }
      `,
    })
    const cities = new THREE.InstancedMesh(cityGeo, cityMat, cityCount)
    const m = new THREE.Matrix4()
    for (let i = 0; i < cityCount; i++) {
      // ponytail: 均匀随机球面布点，未与大陆 fbm 对齐；要更真实可在 shader 同参数采样陆地区
      const u = Math.random()
      const v = Math.random()
      const z = u * 2 - 1
      const th = v * Math.PI * 2
      const r = Math.sqrt(Math.max(0, 1 - z * z))
      m.setPosition(r * Math.cos(th) * 2.01, r * Math.sin(th) * 2.01, z * 2.01)
      cities.setMatrixAt(i, m)
      delays[i] = Math.random()
    }
    cityGeo.setAttribute('aDelay', new THREE.InstancedBufferAttribute(delays, 1))
    this.group.add(cities)
  }

  update(time: number) {
    this.uniforms.uTime.value = time
    this.citiesUniforms.uTime.value = time
    this.group.rotation.y = time * 0.05
  }
}
