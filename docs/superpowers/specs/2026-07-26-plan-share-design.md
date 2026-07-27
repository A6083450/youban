# 游玩计划分享功能 设计文档

**日期：** 2026-07-26
**主题：** 结果页新增「分享」入口，生成公开只读分享链接与二维码
**状态：** 待实现

---

## 1. 背景与目标

用户完成一份游玩计划后，希望把它分享给他人查看。当前结果页（`Result.vue`）只有「导出图片」一个对外能力，缺少链接分享。

**目标：** 在结果页新增「分享」按钮，点击后弹窗提供：

1. 可复制的分享链接，他人（含未登录的站外用户）打开即可查看该计划；
2. 指向该链接的二维码，可展示与下载。

分享出去的页面为**纯只读展示**：保留行程/预算/地图/天气/知识图谱等展示，隐藏 Agent 对话与所有编辑操作。

---

## 2. 架构总览与安全模型

**核心思路：不新建数据存储。** 后端 `GET /api/trip/status/{task_id}`（`backend/app/api/routes/trip.py`）无鉴权依赖、对任意 `task_id` 公开返回完整计划结果。`planId` 即 `task_id`，是 8 位 uuid。因此「知道 planId 即可查看」这一能力后端已具备，分享功能沿用该现有安全模型——依靠 id 的不可枚举性保护，**本功能不改变、也不削弱**现有可见性（任何知道 planId 的人本就能通过 status 端点取得数据）。

分享功能 = **公开只读路由** + **复用 `Result` 的只读模式** + **分享弹窗（链接 + 二维码）**。前端为主，后端零改动。

---

## 3. 数据流

1. 用户在结果页（编辑态）点击 **分享** → 打开 `SharePlanModal`。
2. 弹窗按 `planId` 算出分享 URL：`${window.location.origin}/share/${planId}`；展示「复制链接」与「二维码（本地生成，编码该 URL）+ 下载」。
3. 访客打开 `/share/{planId}`：
   - 路由守卫放行（免登录）；
   - `ShareView` 渲染 `<Result :plan-id="id" readonly />`；
   - `Result` 的 `loadPlanById` 在访客浏览器无 `sessionStorage` 缓存 → 走 `pollTaskStatus(planId)` → `GET /api/trip/status/{planId}`（公开）→ 拿到并渲染完整计划；
   - 以只读模式渲染。

---

## 4. 组件与文件改动

### 4.1 新增文件

- **`frontend/src/views/ShareView.vue`**（薄壳，类比 `PlanView.vue`）
  ```vue
  <template><Result :plan-id="id" :key="id" readonly /></template>
  <script setup lang="ts">
  import Result from './Result.vue'
  defineProps<{ id: string }>()
  </script>
  ```

- **`frontend/src/components/SharePlanModal.vue`**（独立组件，避免 `Result.vue` 继续膨胀）
  - Props：`open: boolean`、`planId: string`；Emits：`update:open`
  - 计算 `shareUrl = ${window.location.origin}/share/${planId}`
  - 复制链接：优先 `navigator.clipboard.writeText`，非安全上下文/旧浏览器降级 `document.execCommand('copy')`
  - 二维码：`qrcode` 库 `toDataURL(shareUrl)` 生成 `<img>`；提供「下载二维码」（`<a download>` + dataURL）
  - 使用 ant-design-vue 的 `a-modal`，风格与项目一致

### 4.2 修改文件

- **`frontend/src/main.ts`**
  - 路由新增：`{ path: '/share/:id', name: 'Share', component: ShareView, props: true }`
  - 守卫放行：`beforeEach` 中把公开路径判断扩展为 `to.path.startsWith('/admin') || to.path.startsWith('/share')`（未登录访问 `/share/*` 不再重定向到 `/login`）

- **`frontend/src/views/Result.vue`**
  - `defineProps` 增加 `readonly?: boolean`（默认 `false`）
  - 编辑态（`!readonly`）在 `top-switch-actions` 区、「导出图片」旁**新增「分享」按钮**，点击打开 `SharePlanModal`
  - `readonly` 为真时按「第 5 节」隐藏清单裁剪
  - 引入并挂载 `SharePlanModal`（仅编辑态需要触发；只读态不显示分享按钮）

- **`frontend/src/i18n/locales/zh.json` / `en.json` / `ja.json`**
  - 在 `result` 段（与 `exportImage` 同级）新增 `share` 子对象，键包括：`button`（分享）、`modalTitle`、`linkLabel`、`copy`、`copied`、`copyFailed`、`qrTitle`、`downloadQr`、`qrFailed`、`readonlyBanner`（只读横幅文案）、`readonlyCta`（「我也要规划」）

### 4.3 依赖

- 新增：`qrcode`；开发依赖：`@types/qrcode`
- 通过 `frontend/package.json` 安装，纯前端本地生成，不依赖第三方服务、离线可用、不外泄分享链接

---

## 5. `Result.vue` 只读模式（`readonly=true`）裁剪清单

**隐藏：**
- `PlanChatPanel`（Agent 对话面板，模板末尾）——只读态不渲染
- 「分享」按钮本身（避免在分享页内再次弹出分享，产生套娃困惑）
- 预算明细「操作」列：表头 `detailAction` 与每行 `budget-action-wrap`（编辑 `budget-edit-btn` / 删除 `budget-delete-btn`）
- 预算「待恢复」区 `budget-pending-wrap`
- 空状态里「返回创建行程」按钮 → 替换为只读 CTA（跳首页，引导访客自行规划）

**保留：**
- 导出图片（用户确认保留，供访客存图）
- 概览 / 预算汇总（只读展示，不含增删改）/ 地图 / 每日行程 / 知识图谱 / 天气

**只读横幅：**
- `readonly` 态在内容顶部加一条轻量横幅：文案 `share.readonlyBanner` +「我也要规划」CTA（`share.readonlyCta`，点击跳 `/`）

**受影响的编辑函数**：`applyAgentPlan`、`editBudgetItemAmount`、`deleteBudgetItem`、`restoreBudgetItem` 在只读态因入口被隐藏而不会触发，逻辑本身无需删除。

---

## 6. 分享弹窗交互（`SharePlanModal`）

- 打开：结果页点「分享」→ `open=true`
- 链接区：只读输入框/文本展示 `shareUrl` + 「复制」按钮；复制成功 `message.success(share.copied)`，失败提示 `share.copyFailed`
- 二维码区：展示 120–160px 二维码图；「下载二维码」保存为 PNG（文件名含城市/planId）
- 关闭：点遮罩/关闭按钮，`update:open=false`

---

## 7. 边界与错误处理

- **无效 / 未完成 planId**：`pollTaskStatus` 拿不到 `completed` 结果 → 复用 `Result` 现有空状态；只读页 CTA 指向首页。
- **二维码生成失败**：捕获异常，二维码区显示 `share.qrFailed` 占位，链接复制不受影响。
- **剪贴板不可用**（非 HTTPS / 旧浏览器）：降级 `execCommand('copy')`；再失败则提示手动复制。
- **只读页地图**：地图依赖运行时 key（`getBackendRuntimeSettings`）。若该端点非公开，访客地图 tab 可能不显示。**实现阶段验证**：若确不可公开，则只读态降级隐藏地图 tab，不阻塞其余内容。
- **图片加载**：景点图走 `/api/poi/photo`，与地图同样在实现阶段确认对访客可用性；失败回退占位图（现有逻辑已具备）。

---

## 8. 测试与验收

**测试：**
- 前端若无组件测试框架，则以手动验证为主（后端有 pytest，本功能后端零改动，无需新测试）。
- 可测点（若补测试）：分享 URL 构建、二维码 dataURL 生成、`readonly` 下编辑元素不渲染。

**验收标准：**
- [ ] 结果页（编辑态）导出图片旁出现「分享」按钮，点击弹出弹窗。
- [ ] 弹窗内分享链接为 `{origin}/share/{planId}`，可一键复制。
- [ ] 弹窗内二维码由前端本地生成、编码分享链接，可下载为 PNG。
- [ ] 无痕窗口（未登录）打开 `/share/{planId}` 不被重定向到登录页，能看到完整只读计划。
- [ ] 只读页无 Agent 对话面板、无预算增删改、无待恢复区、无「分享」按钮；保留导出图片与各展示区。
- [ ] 只读页顶部有只读横幅 + CTA。
- [ ] `npx vite build` 通过，无 TypeScript 错误。

---

## 9. 待排除范围

- 不实现「短链」/自定义分享码（沿用 planId）。
- 不实现分享权限管理、失效时间、访问统计。
- 不实现「复制为图文/小红书文案」等衍生分享形态。
- 不改动后端（除非第 7 节地图/图片可见性验证后确需最小公开化调整）。

---

## 10. 参考

- 结果页：`frontend/src/views/Result.vue`（`top-switch-actions` 区、`exportAsImage`、`buildExportHTML` 中既有 `qrserver` 二维码用法可参考）
- 路由与守卫：`frontend/src/main.ts`
- 公开数据端点：`backend/app/api/routes/trip.py` `get_task_status`
- API 封装：`frontend/src/services/api.ts` `pollTaskStatus`
