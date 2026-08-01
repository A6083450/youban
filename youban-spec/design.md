# 游伴 Youban — Splash Screen 技术设计文档

版本：v1.0 · 2026-08-01 · 对应需求：[spec.md](./spec.md)

## 1. 技术选型

| 项 | 选型 | 说明 |
|---|---|---|
| 渲染 | Three.js + WebGL2 | 全部视觉由 GLSL ShaderMaterial 程序化生成，零图片资源 |
| 后处理 | EffectComposer + UnrealBloomPass | 柔和暖色泛光 |
| 粒子 | GPU Particle System（自定义 ShaderMaterial + BufferGeometry） | 位置/颜色全部在 vertex shader 内计算 |
| 实例化 | InstancedMesh（城市光点） | 单次 draw call |
| 动画编排 | GSAP（项目已有依赖） | 阶段时间线、uniform 驱动、相机缓动 |
| 集成 | Vue 3 组件 + Vite 动态 `import()` | Three.js 拆为独立 chunk，懒加载，不阻塞首屏 |

新增依赖：`three`（+ `@types/three`）。GSAP 复用现有，不引入其他动画库。

## 2. 模块结构

```
frontend/src/splash/
├── YoubanSplash.vue          # Vue 容器：全屏覆盖层、生命周期、降级逻辑
├── SceneManager.ts           # 渲染循环、resize、性能分档、阶段编排
├── WarmSunPortal.ts          # 阶段一：晨光门户（背景渐变 + 太阳 + 体积光）
├── TravelParticleSystem.ts   # 尘埃粒子 → 地球聚合
├── GlobeShader.ts            # 程序化地球：轮廓、经纬线、大陆噪声纹理
├── CityNodes.ts              # InstancedMesh 城市光点
├── LightTransition.ts        # 阶段三：光幕包裹与消散
├── CameraFlyThrough.ts       # 相机推进与穿越
└── shaders/                  # 共用的 noise / gradient GLSL chunk
```

## 3. 场景合成

单个 `THREE.Scene` + `EffectComposer`：

```
RenderPass → UnrealBloomPass(暖金色调) → OutputPass
```

分档配置（SceneManager 启动时检测 `devicePixelRatio` / `renderer.capabilities` / `navigator.hardwareConcurrency` / 移动端 UA）：

| 档位 | 粒子数 | Bloom 分辨率 | 噪声 octave |
|---|---|---|---|
| High | 15,000 | 1/2 | 4 |
| Medium | 8,000 | 1/4 | 3 |
| Low | 3,000 | off | 2（仅渐变） |

帧率监控：运行中连续 2s 低于阈值自动降一档（只降不升）。

## 4. 各模块设计

### 4.1 WarmSunPortal（阶段一）

- 全屏 `PlaneGeometry` + ShaderMaterial，渲染在正交层：
  - 背景：垂直三色渐变（奶油白 `#FDF8F0` → 浅沙 `#F5E9D5` → 暖米 `#F0DFC4`），叠加 fbm 噪声做纸张质感
  - 太阳：屏幕空间径向渐变光斑，随 `uProgress` 从画面下 1/3 处上升，亮度/半径缓动扩散
  - 体积光：2–3 层低透明度放射状条纹（噪声扰动），随时间缓慢摆动
- 所有参数走 uniform，由 SceneManager 的统一时钟驱动

### 4.2 TravelParticleSystem

- `BufferGeometry`，每粒子属性：`aSeed`(vec3)、`aSize`、`aWarmth`
- vertex shader 内双模式插值：
  ```
  pos = mix(driftPos(seed, t), globePos(seed), uFormation)
  ```
  - `driftPos`：curl noise 流场，缓慢旋转漂浮（阶段一）
  - `globePos`：均匀球面分布 + 轻微脉动（阶段二，`uFormation` 0→1）
- fragment shader：径向衰减圆点，`mix(米白, 金色 #E8B45A, aWarmth)`，加性混合
- 颜色亮度略高于 1.0 喂给 Bloom

### 4.3 GlobeShader（阶段二）

- `SphereGeometry` + ShaderMaterial：
  - 经纬线：`fract` 网格线，抗锯齿用 `fwidth`，发光强度随 `uProgress` 淡入
  - 大陆纹理：球面 3D fbm 噪声阈值化生成抽象大陆形状（**非真实地图**），暖沙色块 + 金色描边
  - 晨昏线：一个方向光项，让"阳光照亮一半地球"，缓慢旋转
- 透明度由 `uProgress` 控制，从粒子云中浮现

### 4.4 CityNodes

- ~40 个伪随机球面点（大陆噪声高值区采样），`InstancedMesh` + 小发光球 shader
- 每个节点以随机延迟点亮（`uTime` 与实例 id 哈希比较），点亮瞬间触发一次 Bloom 脉冲

### 4.5 CameraFlyThrough（阶段三）

- GSAP timeline 驱动相机：`z: 8 → 2.5 → -0.5`（穿过球心）
- ease：`power2.inOut`；穿球时 FOV 从 50 缓扩至 75 制造包裹感
- 同步驱动 `LightTransition.uIntensity`：穿球瞬间全屏暖光升至峰值，再随主界面淡入而消散

### 4.6 LightTransition

- 全屏 shader quad：暖白径向光，`uIntensity` 0→1→0
- 输出色与主界面背景色（`#FDF8F0` 系）一致，保证无缝衔接、无黑场

### 4.7 SceneManager

职责：
1. 初始化 renderer / composer / 各模块，性能分档
2. 阶段编排：一条 GSAP timeline 映射 `progress ∈ [0,1]` 到三个阶段的 uniform 组；外部加载进度可通过 `setLoadProgress(p)` 与时间进度取 max
3. `skip()`：快进到阶段三，0.8s 内完成收尾
4. `destroy()`：dispose 全部 geometry / material / renderTarget，移除 canvas

## 5. Vue 集成

`YoubanSplash.vue`：
- `v-if="showSplash"` 全屏 fixed 覆盖层（`z-index` 最高，`aria-hidden`）
- `onMounted` 内 `await import('./SceneManager')` 懒加载 Three.js chunk；加载期间先显示纯 CSS 暖色渐变兜底（500ms 内有画面）
- 监听应用就绪事件（路由首屏数据加载完成）→ `scene.finish()` → 转场结束 → `showSplash = false`
- 降级路径：
  - `!WebGL2` → CSS 渐变 + Logo 淡入，1s 后进入
  - `prefers-reduced-motion` → 同上静态版
  - `sessionStorage.youban_splashed` → 精简版（跳过阶段一二，直接 1.2s 光幕转场）

## 6. 性能要点

- 所有粒子运动在 GPU，JS 每帧只更新 3–5 个 uniform
- `powerPreference: 'high-performance'`，`antialias: false`（Bloom 已柔化边缘）
- DPR 上限 2，Low 档上限 1.5
- 转场结束后 `renderer.dispose()` 并解除引用，释放 GPU 内存
- Three.js 按需 import 模块（`three` core + `EffectComposer/UnrealBloomPass/RenderPass/OutputPass`），tree-shaking 后增量 ≤ 200KB gzip

## 7. 验收对应

| spec 条目 | 实现 |
|---|---|
| ≤500ms 首画面 | CSS 兜底渐变 + chunk 懒加载并行 |
| 程序化地球 | GlobeShader fbm，无贴图文件 |
| 无黑场转场 | LightTransition 输出色 = 主界面背景色 |
| 点击跳过 | `skip()` 快进 timeline |
| 降级 | 三档分档 + WebGL2/reduced-motion 静态版 |
