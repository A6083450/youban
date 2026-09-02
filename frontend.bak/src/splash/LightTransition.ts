import * as THREE from 'three'

// 阶段三：光幕过渡 —— 全屏暖白径向光，包裹屏幕后随主界面消散
// 输出色与主界面背景 (#FDF8F0 系) 一致，保证无黑场衔接
export class LightTransition {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  readonly uniforms: Record<string, THREE.IUniform>

  constructor() {
    this.uniforms = {
      uIntensity: { value: 0 },
    }
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NormalBlending,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uIntensity;
        varying vec2 vUv;
        void main() {
          float d = length(vUv - 0.5) * 1.6;
          // 中心最亮的暖白，向外微带金色
          vec3 warmWhite = vec3(0.996, 0.976, 0.945);
          vec3 gold = vec3(1.0, 0.82, 0.52);
          vec3 col = mix(warmWhite, gold, smoothstep(0.3, 1.0, d) * 0.5);
          float a = uIntensity * smoothstep(1.15, 0.2, d) * 0.92;
          gl_FragColor = vec4(col, a);
        }
      `,
    })
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat))
  }
}
