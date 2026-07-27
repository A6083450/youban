# 游玩计划分享功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在结果页新增「分享」入口,生成公开只读分享链接与本地二维码,他人免登录即可查看该游玩计划。

**Architecture:** 前端为主、后端零改动。复用现有公开端点 `GET /api/trip/status/{planId}` 作数据源;新增公开只读路由 `/share/:id`,复用 `Result.vue` 的只读模式渲染;分享弹窗用 `qrcode` 库在前端本地生成二维码。

**Tech Stack:** Vue 3.5 + TypeScript + Vue Router 4 + ant-design-vue 4 + vue-i18n 9 + `qrcode`(新增)。

## Global Constraints

- **无前端单测框架**:项目 `frontend/package.json` 仅有 `dev`/`build`/`preview`,无 vitest/jest。**不为本功能引入测试基建**(YAGNI,spec 已确认)。每个前端任务的验证环节 = 在 `frontend/` 下运行 `npx vue-tsc --noEmit`(类型检查)+ `npx vite build`(构建通过)+ 该任务列出的精确手动步骤。
- **验证命令(前端)**:`cd frontend && npx vue-tsc --noEmit && npx vite build`。
- **提交策略**:本仓库约定「仅在用户明确要求时提交」。计划中的 `Commit` 步骤用于标记任务边界;**执行时是否真正 `git commit` 由用户决定**,未获指示则跳过提交、仅保留改动。
- **新增依赖**:`qrcode`(runtime)+ `@types/qrcode`(dev),仅此。二维码一律前端本地生成,不调用任何外部服务。
- **分享 URL 规则**:`${window.location.origin}/share/${planId}`。
- **只读复用**:只读页复用 `Result.vue`,通过 `readonly` prop 裁剪,**禁止复制展示代码另建页面**。
- **保留展示**:只读态保留导出图片、概览、预算汇总、地图、每日行程、知识图谱、天气。
- **当前行号**:文中 `Result.vue` 行号基于当前版本,编辑后会偏移,请以给出的锚点代码为准。

---

### Task 1: i18n 文案(三语 `result.share.*`)

**Files:**
- Modify: `frontend/src/i18n/locales/zh.json`(`"result": {` 锚点,当前 265 行)
- Modify: `frontend/src/i18n/locales/en.json`
- Modify: `frontend/src/i18n/locales/ja.json`

**Interfaces:**
- Produces: i18n 键 `result.share.button` / `modalTitle` / `linkLabel` / `copy` / `copied` / `copyFailed` / `qrTitle` / `downloadQr` / `qrFailed` / `readonlyBanner` / `readonlyCta`,供 Task 2/4/5 使用。

- [ ] **Step 1: 在 zh.json 的 result 段插入 share 子对象**

用 Edit 定位锚点 `  "result": {`(zh.json 唯一),替换为在其后追加 share 块:

```
  "result": {
    "share": {
      "button": "分享",
      "modalTitle": "分享游玩计划",
      "linkLabel": "分享链接",
      "copy": "复制",
      "copied": "链接已复制",
      "copyFailed": "复制失败，请手动复制",
      "qrTitle": "扫码查看",
      "downloadQr": "下载二维码",
      "qrFailed": "二维码生成失败",
      "readonlyBanner": "这是一份分享的游玩计划",
      "readonlyCta": "我也要规划"
    },
```

- [ ] **Step 2: 在 en.json 的 result 段插入 share 子对象**

锚点 `  "result": {`,同样在其后追加:

```
  "result": {
    "share": {
      "button": "Share",
      "modalTitle": "Share trip plan",
      "linkLabel": "Share link",
      "copy": "Copy",
      "copied": "Link copied",
      "copyFailed": "Copy failed, please copy manually",
      "qrTitle": "Scan to view",
      "downloadQr": "Download QR code",
      "qrFailed": "Failed to generate QR code",
      "readonlyBanner": "This is a shared trip plan",
      "readonlyCta": "Plan my own"
    },
```

- [ ] **Step 3: 在 ja.json 的 result 段插入 share 子对象**

锚点 `  "result": {`,在其后追加:

```
  "result": {
    "share": {
      "button": "共有",
      "modalTitle": "旅行プランを共有",
      "linkLabel": "共有リンク",
      "copy": "コピー",
      "copied": "リンクをコピーしました",
      "copyFailed": "コピーに失敗しました。手動でコピーしてください",
      "qrTitle": "スキャンして表示",
      "downloadQr": "QRコードをダウンロード",
      "qrFailed": "QRコードの生成に失敗しました",
      "readonlyBanner": "これは共有された旅行プランです",
      "readonlyCta": "自分もプランを作る"
    },
```

- [ ] **Step 4: 校验 JSON 合法且键存在**

Run: `cd frontend && node -e "['zh','en','ja'].forEach(l=>{const o=require('./src/i18n/locales/'+l+'.json');if(!o.result.share.button)throw new Error(l+' missing share');console.log(l,'ok')})"`
Expected: 打印 `zh ok` / `en ok` / `ja ok`,无 JSON 解析错误。

- [ ] **Step 5: Commit(按 Global Constraints 决定是否执行)**

```bash
git add frontend/src/i18n/locales/zh.json frontend/src/i18n/locales/en.json frontend/src/i18n/locales/ja.json
git commit -m "feat(share): add i18n copy for plan share feature"
```

---

### Task 2: `qrcode` 依赖 + `SharePlanModal` 组件

**Files:**
- Modify: `frontend/package.json`(新增依赖)
- Create: `frontend/src/components/SharePlanModal.vue`

**Interfaces:**
- Consumes: Task 1 的 `result.share.*` 文案。
- Produces: 组件 `SharePlanModal`,props `{ open: boolean; planId: string }`,emit `update:open`(供 `v-model:open`)。Task 5 挂载它。

- [ ] **Step 1: 安装 qrcode 依赖**

Run: `cd frontend && npm install qrcode@^1.5.4 && npm install -D @types/qrcode@^1.5.5`
Expected: `package.json` 出现 `"qrcode"` 与 `"@types/qrcode"`,`npm install` 成功。

- [ ] **Step 2: 创建 SharePlanModal.vue**

Create `frontend/src/components/SharePlanModal.vue`:

```vue
<template>
  <a-modal
    :open="open"
    :title="t('result.share.modalTitle')"
    :footer="null"
    centered
    :width="360"
    @update:open="(v: boolean) => emit('update:open', v)"
  >
    <div class="share-modal-body">
      <div class="share-link-block">
        <span class="share-link-label">{{ t('result.share.linkLabel') }}</span>
        <div class="share-link-row">
          <input
            class="share-link-input"
            :value="shareUrl"
            readonly
            @focus="(e) => (e.target as HTMLInputElement).select()"
          />
          <a-button type="primary" size="small" @click="copyLink">
            {{ t('result.share.copy') }}
          </a-button>
        </div>
      </div>

      <div class="share-qr-block">
        <div class="share-qr-title">{{ t('result.share.qrTitle') }}</div>
        <img v-if="qrDataUrl" :src="qrDataUrl" alt="QR" class="share-qr-img" />
        <div v-else class="share-qr-fallback">{{ t('result.share.qrFailed') }}</div>
        <a-button v-if="qrDataUrl" size="small" class="share-qr-download" @click="downloadQr">
          {{ t('result.share.downloadQr') }}
        </a-button>
      </div>
    </div>
  </a-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { message } from 'ant-design-vue'
import QRCode from 'qrcode'

const props = defineProps<{ open: boolean; planId: string }>()
const emit = defineEmits<{ (e: 'update:open', value: boolean): void }>()
const { t } = useI18n()

const shareUrl = computed(() => `${window.location.origin}/share/${props.planId}`)
const qrDataUrl = ref('')

const generateQr = async () => {
  if (!props.planId) {
    qrDataUrl.value = ''
    return
  }
  try {
    qrDataUrl.value = await QRCode.toDataURL(shareUrl.value, { width: 320, margin: 1 })
  } catch (error) {
    console.error('生成二维码失败:', error)
    qrDataUrl.value = ''
  }
}

watch(
  () => [props.open, props.planId],
  () => {
    if (props.open) generateQr()
  },
  { immediate: true }
)

const copyLink = async () => {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(shareUrl.value)
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = shareUrl.value
      textarea.style.position = 'fixed'
      textarea.style.left = '-9999px'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    message.success(t('result.share.copied'))
  } catch (error) {
    console.error('复制链接失败:', error)
    message.error(t('result.share.copyFailed'))
  }
}

const downloadQr = () => {
  if (!qrDataUrl.value) return
  const link = document.createElement('a')
  link.download = `tripstar_share_${props.planId}.png`
  link.href = qrDataUrl.value
  link.click()
}
</script>

<style scoped>
.share-modal-body {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 4px 0;
}
.share-link-label {
  display: block;
  font-size: 13px;
  color: rgba(61, 50, 41, 0.7);
  margin-bottom: 8px;
}
.share-link-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.share-link-input {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid rgba(217, 119, 87, 0.35);
  border-radius: 8px;
  font-size: 13px;
  color: #3D3229;
  background: #FAF7F2;
}
.share-qr-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.share-qr-title {
  font-size: 13px;
  color: rgba(61, 50, 41, 0.7);
}
.share-qr-img {
  width: 160px;
  height: 160px;
  border-radius: 8px;
  border: 1px solid rgba(61, 50, 41, 0.1);
}
.share-qr-fallback {
  width: 160px;
  height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: 12px;
  color: rgba(61, 50, 41, 0.5);
  border: 1px dashed rgba(61, 50, 41, 0.2);
  border-radius: 8px;
}
</style>
```

- [ ] **Step 3: 类型检查 + 构建**

Run: `cd frontend && npx vue-tsc --noEmit && npx vite build`
Expected: 无类型错误,构建成功(此时组件尚未被引用,只验证自身可编译)。

- [ ] **Step 4: Commit(按 Global Constraints 决定是否执行)**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/components/SharePlanModal.vue
git commit -m "feat(share): add SharePlanModal with local QR code generation"
```

---

### Task 3: 公开只读路由(`/share/:id` + 守卫 + `ShareView` + `Result` 的 `readonly` prop)

**Files:**
- Create: `frontend/src/views/ShareView.vue`
- Modify: `frontend/src/main.ts`(import + route + guard)
- Modify: `frontend/src/views/Result.vue:455`(defineProps 增加 `readonly`)

**Interfaces:**
- Consumes: `Result` 组件的 `planId`/`readonly` props。
- Produces: 路由 `Share`(`/share/:id`,props: true);`Result` 支持 `readonly?: boolean`。Task 4 依赖该 prop。

- [ ] **Step 1: 创建 ShareView.vue**

Create `frontend/src/views/ShareView.vue`:

```vue
<template>
  <Result :plan-id="id" :key="id" readonly />
</template>

<script setup lang="ts">
import Result from './Result.vue'

defineProps<{ id: string }>()
</script>
```

- [ ] **Step 2: Result.vue 增加 readonly prop**

在 `frontend/src/views/Result.vue` 定位(约 455 行):

```ts
const props = defineProps<{ planId?: string }>()
```

改为:

```ts
const props = defineProps<{ planId?: string; readonly?: boolean }>()
```

- [ ] **Step 3: main.ts 注册路由与放行守卫**

在 `frontend/src/main.ts` 的 import 区(`import LoginView ...` 之后)加:

```ts
import ShareView from './views/ShareView.vue'
```

在 routes 数组中 `/plan/:id` 那一行之后加:

```ts
    { path: '/share/:id', name: 'Share', component: ShareView, props: true },
```

将守卫中的 admin 判断:

```ts
router.beforeEach((to) => {
  const isAdmin = to.path.startsWith('/admin')
  if (!currentUser.value && to.path !== '/login' && !isAdmin) {
    return { path: '/login' }
  }
```

改为(把 `/share` 一并放行):

```ts
router.beforeEach((to) => {
  const isPublic = to.path.startsWith('/admin') || to.path.startsWith('/share')
  if (!currentUser.value && to.path !== '/login' && !isPublic) {
    return { path: '/login' }
  }
```

- [ ] **Step 4: 类型检查 + 构建**

Run: `cd frontend && npx vue-tsc --noEmit && npx vite build`
Expected: 无类型错误,构建成功。

- [ ] **Step 5: 手动验证——免登录可达 + 公开数据加载**

1. 启动后端(`backend/.venv`)与前端 `npm run dev`。
2. 登录并生成一份计划,记下结果页 URL 里的 `planId`(即 `/plan/{planId}`)。
3. 打开**无痕窗口**(未登录),访问 `http://localhost:5173/share/{planId}`。
Expected: **不被重定向到 `/login`**;页面成功加载并显示该计划内容(此步尚未裁剪,展示为完整页面即可,证明路由/守卫/公开端点数据加载均打通)。

- [ ] **Step 6: Commit(按 Global Constraints 决定是否执行)**

```bash
git add frontend/src/views/ShareView.vue frontend/src/main.ts frontend/src/views/Result.vue
git commit -m "feat(share): add public read-only /share/:id route and readonly prop"
```

---

### Task 4: `Result.vue` 只读裁剪 + 只读横幅

**Files:**
- Modify: `frontend/src/views/Result.vue`(模板:横幅、PlanChatPanel、预算操作列/待恢复区;`<style scoped>`:横幅样式 + 只读预算网格)

**Interfaces:**
- Consumes: Task 3 的 `readonly` prop;Task 1 的 `result.share.readonlyBanner` / `readonlyCta`。
- Produces: 只读态隐藏编辑元素、显示横幅的 `Result` 页。

- [ ] **Step 1: 内容顶部加入只读横幅**

在 `frontend/src/views/Result.vue` 模板中定位:

```html
      <div v-if="tripPlan" class="content-wrapper">
        <div class="top-switch-nav">
```

在 `<div v-if="tripPlan" class="content-wrapper">` 之后、`<div class="top-switch-nav">` 之前插入横幅:

```html
      <div v-if="tripPlan" class="content-wrapper">
        <div v-if="readonly" class="share-readonly-banner">
          <span class="share-readonly-text">{{ t('result.share.readonlyBanner') }}</span>
          <a-button type="primary" size="small" class="share-readonly-cta" @click="goBack">
            {{ t('result.share.readonlyCta') }}
          </a-button>
        </div>
        <div class="top-switch-nav">
```

(`goBack` 已存在,`router.push('/')`;访客未登录点击会被守卫引导至登录页,正好转化。)

- [ ] **Step 2: 只读态隐藏 Agent 对话面板**

定位模板末尾:

```html
    <PlanChatPanel
      :trip-plan="tripPlan"
      @apply-plan="applyAgentPlan"
      @restore-plan="applyAgentPlan"
    />
```

在开标签加 `v-if="!readonly"`:

```html
    <PlanChatPanel
      v-if="!readonly"
      :trip-plan="tripPlan"
      @apply-plan="applyAgentPlan"
      @restore-plan="applyAgentPlan"
    />
```

- [ ] **Step 3: 只读态隐藏预算「操作」列表头**

定位预算明细表头(约 106-112 行):

```html
                  <div class="budget-detail-row budget-detail-header">
                    <span>{{ t('result.budget.detailType') }}</span>
                    <span>{{ t('result.budget.detailDay') }}</span>
                    <span>{{ t('result.budget.detailName') }}</span>
                    <span>{{ t('result.budget.detailAmount') }}</span>
                    <span>{{ t('result.budget.detailAction') }}</span>
                  </div>
```

给最后一个 span(操作列)加 `v-if="!readonly"`,并给该表头行动态类:

```html
                  <div class="budget-detail-row budget-detail-header" :class="{ 'is-readonly': readonly }">
                    <span>{{ t('result.budget.detailType') }}</span>
                    <span>{{ t('result.budget.detailDay') }}</span>
                    <span>{{ t('result.budget.detailName') }}</span>
                    <span>{{ t('result.budget.detailAmount') }}</span>
                    <span v-if="!readonly">{{ t('result.budget.detailAction') }}</span>
                  </div>
```

- [ ] **Step 4: 只读态隐藏预算行内「操作」按钮并调整网格**

定位预算数据行(约 113-146 行),给行容器加动态类,并把整个操作单元格 `v-if` 掉:

```html
                  <div
                    v-for="item in filteredBudgetItems"
                    :key="item.id"
                    class="budget-detail-row"
                    :class="{ 'is-readonly': readonly }"
                  >
                    <span class="budget-detail-type">{{ getBudgetTypeLabel(item.type) }}</span>
                    <span class="budget-detail-day">
                      {{ item.dayNumber ? t('common.dayNumber', { day: item.dayNumber }) : '--' }}
                    </span>
                    <span class="budget-detail-name">{{ item.name }}</span>
                    <span class="budget-detail-amount">¥{{ formatBudgetAmount(item.amount) }}</span>
                    <span v-if="!readonly" class="budget-action-wrap">
```

(仅在 `class="budget-detail-row"` 行后补 `:class` 绑定、在 `<span class="budget-action-wrap">` 前补 `v-if="!readonly"`;该 span 内部的编辑/删除按钮保持不变。)

- [ ] **Step 5: 只读态隐藏预算「待恢复」区**

定位(约 183 行):

```html
              <div class="budget-pending-wrap">
```

改为:

```html
              <div v-if="!readonly" class="budget-pending-wrap">
```

- [ ] **Step 6: 加入只读态 CSS(横幅 + 预算网格覆盖)**

定位 `<style scoped>` 中的 `.budget-detail-row` 定义(约 3559 行):

```css
.budget-detail-row {
  display: grid;
  grid-template-columns: 112px 96px minmax(0, 1fr) 120px 86px;
```

在该规则块之后新增只读覆盖(去掉第 5 列),并追加横幅样式:

```css
.budget-detail-row.is-readonly {
  grid-template-columns: 112px 96px minmax(0, 1fr) 120px;
}

.share-readonly-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  margin-bottom: 12px;
  background: rgba(217, 119, 87, 0.1);
  border: 1px solid rgba(217, 119, 87, 0.3);
  border-radius: 12px;
}
.share-readonly-text {
  font-size: 14px;
  font-weight: 600;
  color: #C4603D;
}
```

- [ ] **Step 7: 类型检查 + 构建**

Run: `cd frontend && npx vue-tsc --noEmit && npx vite build`
Expected: 无类型错误,构建成功。

- [ ] **Step 8: 手动验证——只读效果**

无痕窗口打开 `http://localhost:5173/share/{planId}`:
Expected:
- 顶部出现「这是一份分享的游玩计划」横幅 +「我也要规划」按钮。
- **无** Agent 对话浮层(`PlanChatPanel`)。
- 预算 tab 明细表**无**「操作」列(无编辑/删除按钮),列宽对齐正常;**无**「待恢复」区。
- 概览/地图/每日行程/知识图谱/天气/导出图片正常展示。

对照:登录态 `/plan/{planId}` 仍有对话面板、预算编辑/删除、待恢复区(未受影响)。

- [ ] **Step 9: Commit(按 Global Constraints 决定是否执行)**

```bash
git add frontend/src/views/Result.vue
git commit -m "feat(share): read-only mode trims editing UI and adds banner"
```

---

### Task 5: `Result.vue` 分享入口(按钮 + 挂载弹窗)

**Files:**
- Modify: `frontend/src/views/Result.vue`(top-switch-actions 加分享按钮;import + 挂载 `SharePlanModal`;新增 `shareModalOpen` ref)

**Interfaces:**
- Consumes: Task 2 的 `SharePlanModal`;Task 1 的 `result.share.button`;Task 3 建立的 `/share/:id`(弹窗链接指向它)。
- Produces: 编辑态可打开分享弹窗的结果页。

- [ ] **Step 1: 引入 SharePlanModal 并新增打开状态**

在 `frontend/src/views/Result.vue` 的 import 区(`import PlanChatPanel ...` 之后)加:

```ts
import SharePlanModal from '@/components/SharePlanModal.vue'
```

在 `const activeSection = ref('overview')` 附近的响应式声明区加:

```ts
const shareModalOpen = ref(false)
```

- [ ] **Step 2: top-switch-actions 加「分享」按钮**

定位导出图片按钮所在的 `a-space`(约 32-37 行):

```html
            <a-space :size="4" wrap>
              <a-button type="default" @click="exportAsImage" class="action-btn">
                <svg class="action-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                {{ t('result.exportImage') }}
              </a-button>
            </a-space>
```

在导出图片按钮之前插入「分享」按钮(仅非只读态显示):

```html
            <a-space :size="4" wrap>
              <a-button v-if="!readonly" type="default" @click="shareModalOpen = true" class="action-btn">
                <svg class="action-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                {{ t('result.share.button') }}
              </a-button>
              <a-button type="default" @click="exportAsImage" class="action-btn">
                <svg class="action-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                {{ t('result.exportImage') }}
              </a-button>
            </a-space>
```

- [ ] **Step 3: 挂载 SharePlanModal**

定位模板末尾 `PlanChatPanel`(Task 4 已加 `v-if="!readonly"`)之后、`</div>`(result-container 收尾)之前,挂载弹窗:

```html
    <SharePlanModal
      v-if="!readonly && planId"
      v-model:open="shareModalOpen"
      :plan-id="planId"
    />
```

(`planId` 是 `ref<string>`,模板中直接使用其值;`v-if` 确保只读态与无 planId 时不挂载。)

- [ ] **Step 4: 类型检查 + 构建**

Run: `cd frontend && npx vue-tsc --noEmit && npx vite build`
Expected: 无类型错误,构建成功。

- [ ] **Step 5: 手动验证——分享流程端到端**

1. 登录态打开结果页 `/plan/{planId}`。
Expected: 导出图片左侧出现「分享」按钮。
2. 点击「分享」→ 弹出弹窗。
Expected: 显示分享链接 `{origin}/share/{planId}`;显示二维码图。
3. 点「复制」。
Expected: 提示「链接已复制」;粘贴得到正确 URL。
4. 点「下载二维码」。
Expected: 下载 `tripstar_share_{planId}.png`。
5. 手机/另一设备扫码 或 无痕打开该链接。
Expected: 免登录进入只读分享页,内容正确。
6. 打开只读页 `/share/{planId}`。
Expected: **无**「分享」按钮(只读态隐藏),弹窗不挂载。

- [ ] **Step 6: Commit(按 Global Constraints 决定是否执行)**

```bash
git add frontend/src/views/Result.vue
git commit -m "feat(share): add share button and modal entry on result page"
```

---

## 计划自查(对照 spec)

**1. Spec 覆盖**
- 分享按钮/弹窗(spec §3、§6)→ Task 5 ✅
- 分享链接 + 复制(spec §6)→ Task 2(逻辑)+ Task 5(入口)✅
- 本地二维码 + 下载(spec §4.3、§6)→ Task 2 ✅
- 公开路由 `/share/:id` + 守卫放行(spec §4.2)→ Task 3 ✅
- `ShareView` 薄壳(spec §4.1)→ Task 3 ✅
- `Result` 只读裁剪清单(spec §5)→ Task 4(PlanChatPanel/预算操作列/待恢复区)+ Task 5(分享按钮 `!readonly`)✅
- 只读横幅 + CTA(spec §5)→ Task 4 ✅
- i18n 三语(spec §4.2)→ Task 1 ✅
- 依赖 qrcode(spec §4.3)→ Task 2 ✅
- 后端零改动(spec §4 后端)→ 无任务,符合 ✅
- 边界:无效 planId 复用空状态、二维码失败占位、剪贴板降级(spec §7)→ Task 2(二维码/剪贴板)+ 现有空状态 ✅

**2. 占位符扫描**:无 TBD/TODO;所有代码步骤含完整代码;命令含预期输出。✅

**3. 类型一致性**:`SharePlanModal` props `{ open, planId }` 与 Task 5 挂载 `v-model:open` + `:plan-id` 一致;`Result` `readonly` prop 在 Task 3 定义、Task 4/5 使用,命名一致;`shareModalOpen` 定义与使用一致。✅

**已知取舍(spec §7)**:只读页地图/景点图依赖运行时配置端点,若对访客不可用,地图 tab 可能空白但不阻塞主体——Task 3 Step 5 手动验证时留意,若确不可用,后续单独最小处理(不在本计划范围)。

---

## 参考
- 设计文档:`docs/superpowers/specs/2026-07-26-plan-share-design.md`
- 结果页:`frontend/src/views/Result.vue`
- 路由:`frontend/src/main.ts`
- 公开端点:`backend/app/api/routes/trip.py` `get_task_status`
