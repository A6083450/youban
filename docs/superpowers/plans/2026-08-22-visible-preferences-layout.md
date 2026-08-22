# Visible Preferences Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the crowded language/skin footer with a permanently visible, well-labeled preferences section containing only Chinese/English and the neutral appearance names Warm/Clear.

**Architecture:** Keep locale normalization in a pure i18n module and keep visible preference metadata in one typed configuration module. `App.vue` renders those typed options as two stacked segmented controls, while the existing stores remain responsible for persistence. `UserBadge.vue` stays responsible for account-only actions and uses the existing Ant Design icon library.

**Tech Stack:** Vue 3, TypeScript, vue-i18n, Bun 1.4 tests, Ant Design Vue icons, CSS custom properties, browser-use.

## Global Constraints

- Language and appearance controls must remain visible without opening a menu.
- Visible languages are exactly `中文` (`zh-CN`) and `English` (`en-US`).
- Unsupported persisted locales, including `ja-JP`, fall back to `zh-CN`.
- Appearance labels are `暖光` / `Warm` for internal `default` and `清朗` / `Clear` for internal `google`.
- Preserve the existing skin storage key and internal identifiers.
- Use one full-width segmented control per preference row and minimum 44 px targets.
- Reuse `@ant-design/icons-vue`; do not use emoji as structural icons.
- Browser interaction and visual verification must use `browser-use` only.
- Preserve unrelated worktree files and do not push or deploy.

---

### Task 1: Restrict And Normalize Product Locales

**Files:**
- Create: `frontend/src/i18n/locale.ts`
- Create: `frontend/src/i18n/locale.test.ts`
- Modify: `frontend/src/i18n/messages.ts:1-15`
- Modify: `frontend/src/i18n/index.ts:1-29`

**Interfaces:**
- Consumes: `DEFAULT_LOCALE`, `SUPPORTED_LOCALES`, and `AppLocale` from `frontend/src/i18n/messages.ts`.
- Produces: `normalizeLocale(value: unknown): AppLocale`, used by `resolveInitialLocale()`.

- [ ] **Step 1: Write the failing locale test**

```ts
import { describe, expect, test } from 'bun:test'
import { normalizeLocale } from './locale'

describe('product locale normalization', () => {
  test('keeps only Chinese and English product locales', () => {
    expect(normalizeLocale('zh-CN')).toBe('zh-CN')
    expect(normalizeLocale('en-US')).toBe('en-US')
    expect(normalizeLocale('en-GB')).toBe('en-US')
  })

  test('falls unsupported and persisted Japanese locales back to Chinese', () => {
    expect(normalizeLocale('ja-JP')).toBe('zh-CN')
    expect(normalizeLocale('fr-FR')).toBe('zh-CN')
    expect(normalizeLocale(null)).toBe('zh-CN')
  })
})
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `cd frontend && bun test src/i18n/locale.test.ts`

Expected: FAIL because `./locale` does not exist.

- [ ] **Step 3: Implement locale normalization and remove Japanese from the product message map**

Create `frontend/src/i18n/locale.ts`:

```ts
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type AppLocale } from './messages'

export const normalizeLocale = (value: unknown): AppLocale => {
  if (typeof value !== 'string') return DEFAULT_LOCALE
  if (SUPPORTED_LOCALES.includes(value as AppLocale)) return value as AppLocale

  const language = value.trim().toLowerCase().split('-')[0]
  return SUPPORTED_LOCALES.find((locale) => locale.toLowerCase().startsWith(`${language}-`))
    ?? DEFAULT_LOCALE
}
```

Change `messages.ts` so the runtime product contains only:

```ts
import en from './locales/en.json'
import zh from './locales/zh.json'

export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const
export type AppLocale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: AppLocale = 'zh-CN'
export const messages = { 'zh-CN': zh, 'en-US': en }
```

Import `normalizeLocale` in `index.ts`, remove its private implementation, and keep `resolveInitialLocale()` calling the imported pure function.

- [ ] **Step 4: Verify locale tests and type checking**

Run: `cd frontend && bun test src/i18n/locale.test.ts && bunx vue-tsc --noEmit`

Expected: 2 tests pass and type checking exits 0.

- [ ] **Step 5: Commit the locale boundary**

```bash
git add frontend/src/i18n/locale.ts frontend/src/i18n/locale.test.ts frontend/src/i18n/messages.ts frontend/src/i18n/index.ts
git commit -m "feat(frontend): limit product locales to Chinese and English"
```

### Task 2: Define Visible Preference Options And Copy

**Files:**
- Create: `frontend/src/stores/preference-options.ts`
- Create: `frontend/src/stores/preference-options.test.ts`
- Modify: `frontend/src/i18n/locales/zh.json:101-117`
- Modify: `frontend/src/i18n/locales/en.json:101-117`

**Interfaces:**
- Consumes: `AppLocale` from `@/i18n` and `AppSkin` from `@/stores/skin`.
- Produces: `VISIBLE_LOCALE_OPTIONS` and `VISIBLE_SKIN_OPTIONS` for `App.vue`.

- [ ] **Step 1: Write the failing preference-options test**

```ts
import { describe, expect, test } from 'bun:test'
import { VISIBLE_LOCALE_OPTIONS, VISIBLE_SKIN_OPTIONS } from './preference-options'

describe('visible preference options', () => {
  test('shows exactly Chinese and English', () => {
    expect(VISIBLE_LOCALE_OPTIONS.map(({ value }) => value)).toEqual(['zh-CN', 'en-US'])
  })

  test('keeps persisted skin ids behind neutral labels', () => {
    expect(VISIBLE_SKIN_OPTIONS).toEqual([
      { value: 'default', labelKey: 'app.skin.warm', swatch: 'warm' },
      { value: 'google', labelKey: 'app.skin.clear', swatch: 'clear' },
    ])
  })
})
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `cd frontend && bun test src/stores/preference-options.test.ts`

Expected: FAIL because `./preference-options` does not exist.

- [ ] **Step 3: Add typed option metadata**

```ts
import type { AppLocale } from '@/i18n'
import type { AppSkin } from './skin'

export const VISIBLE_LOCALE_OPTIONS: ReadonlyArray<{
  value: AppLocale
  labelKey: 'app.language.zh' | 'app.language.en'
}> = [
  { value: 'zh-CN', labelKey: 'app.language.zh' },
  { value: 'en-US', labelKey: 'app.language.en' },
]

export const VISIBLE_SKIN_OPTIONS: ReadonlyArray<{
  value: AppSkin
  labelKey: 'app.skin.warm' | 'app.skin.clear'
  swatch: 'warm' | 'clear'
}> = [
  { value: 'default', labelKey: 'app.skin.warm', swatch: 'warm' },
  { value: 'google', labelKey: 'app.skin.clear', swatch: 'clear' },
]
```

Add these Chinese messages:

```json
"preferences": { "label": "偏好设置" },
"language": { "label": "语言", "zh": "中文", "en": "English" },
"skin": { "label": "外观", "warm": "暖光", "clear": "清朗" }
```

Add these English messages:

```json
"preferences": { "label": "Preferences" },
"language": { "label": "Language", "zh": "中文", "en": "English" },
"skin": { "label": "Appearance", "warm": "Warm", "clear": "Clear" }
```

- [ ] **Step 4: Verify option tests and locale JSON parsing**

Run: `cd frontend && bun test src/stores/preference-options.test.ts && bun -e "JSON.parse(await Bun.file('src/i18n/locales/zh.json').text()); JSON.parse(await Bun.file('src/i18n/locales/en.json').text())"`

Expected: 2 tests pass and the JSON parse command exits 0.

- [ ] **Step 5: Commit typed preference metadata**

```bash
git add frontend/src/stores/preference-options.ts frontend/src/stores/preference-options.test.ts frontend/src/i18n/locales/zh.json frontend/src/i18n/locales/en.json
git commit -m "feat(frontend): name visible preference options"
```

### Task 3: Render The Permanent Sidebar Preferences And Account Icons

**Files:**
- Modify: `frontend/src/App.vue:100-135,151-210,322-645`
- Modify: `frontend/src/components/UserBadge.vue:1-82`

**Interfaces:**
- Consumes: `VISIBLE_LOCALE_OPTIONS`, `VISIBLE_SKIN_OPTIONS`, `setAppLocale(locale: AppLocale)`, and `applySkin(skin: AppSkin)`.
- Produces: two always-visible segmented groups with `.sidebar-preferences`, `.preference-group`, `.preference-segment`, `.preference-option`, and `.preference-swatch` selectors for browser acceptance.

- [ ] **Step 1: Capture the RED browser baseline with browser-use**

Reuse or open the local TypeScript app at `http://127.0.0.1:17862`. Inspect the rendered sidebar DOM and record that the old layout has `.sidebar-footer`, three `.lang-switch-btn` elements, user-visible `Google`/`游伴` appearance labels, and emoji account menu items.

Expected: the baseline does not satisfy the approved selectors or copy.

- [ ] **Step 2: Replace the footer template with two labeled groups**

In `App.vue`, import the typed options and replace the current `sidebar-footer` block with:

```vue
<section class="sidebar-preferences" :aria-label="t('app.preferences.label')">
  <div class="sidebar-preferences__title">{{ t('app.preferences.label') }}</div>
  <div class="preference-group">
    <span class="preference-group__label">{{ t('app.language.label') }}</span>
    <div class="preference-segment" role="group" :aria-label="t('app.language.label')">
      <button
        v-for="option in VISIBLE_LOCALE_OPTIONS"
        :key="option.value"
        type="button"
        class="preference-option"
        :class="{ active: locale === option.value }"
        :aria-pressed="locale === option.value"
        @click="switchLocale(option.value)"
      >
        {{ t(option.labelKey) }}
      </button>
    </div>
  </div>
  <div class="preference-group">
    <span class="preference-group__label">{{ t('app.skin.label') }}</span>
    <div class="preference-segment" role="group" :aria-label="t('app.skin.label')">
      <button
        v-for="option in VISIBLE_SKIN_OPTIONS"
        :key="option.value"
        type="button"
        class="preference-option"
        :class="{ active: skin === option.value }"
        :aria-pressed="skin === option.value"
        @click="applySkin(option.value)"
      >
        <span class="preference-swatch" :class="`preference-swatch--${option.swatch}`" aria-hidden="true"></span>
        {{ t(option.labelKey) }}
      </button>
    </div>
  </div>
</section>
```

Remove local `localeOptions` and `skinOptions`; type `switchLocale(value: AppLocale)` and call `setAppLocale(value)` directly so there is no cast.

- [ ] **Step 3: Implement the approved layout styling**

Replace `.sidebar-footer`, `.lang-switch*`, and `.skin-switch*` rules with semantic-token styles that:

- stack the two groups;
- use a two-column grid for each segmented control;
- give each option `min-height: 44px`;
- use warm orange/cream and clear blue/white swatches;
- use `var(--surface-*)`, `var(--text-*)`, `var(--accent-*)`, and `var(--border-subtle)`;
- preserve stable dimensions for hover, active, and focus states;
- keep `.sidebar-user` below the preferences section.

- [ ] **Step 4: Replace account emoji with Ant Design icons**

In `UserBadge.vue`, import `DatabaseOutlined` and `SwapOutlined`, then render them with text spans:

```vue
<a-menu-item key="memories" @click="memoryOpen = true">
  <DatabaseOutlined aria-hidden="true" />
  <span>{{ t('user.myMemories') }}</span>
</a-menu-item>
<a-menu-item key="logout" @click="handleLogout">
  <SwapOutlined aria-hidden="true" />
  <span>{{ t('user.switchUser') }}</span>
</a-menu-item>
```

Update the badge styles to use semantic tokens and a 44 px minimum button height without changing logout or memory behavior.

- [ ] **Step 5: Run focused tests, full frontend tests, and build**

Run: `cd frontend && bun test src/i18n/locale.test.ts src/stores/preference-options.test.ts src/stores/skin.test.ts && bun run test:unit && bun run build`

Expected: focused tests pass, the full frontend suite passes with zero failures, and the production build exits 0. Existing asset-resolution or chunk-size warnings must be reported separately rather than called clean output.

- [ ] **Step 6: Commit the visible UI**

```bash
git add frontend/src/App.vue frontend/src/components/UserBadge.vue
git commit -m "feat(frontend): expose language and appearance controls"
```

### Task 4: Browser Acceptance And Integration Gate

**Files:**
- Modify only if a verified defect is found: files from Tasks 1-3.

**Interfaces:**
- Consumes: rendered selectors and persisted values from Tasks 1-3.
- Produces: fresh desktop/mobile acceptance evidence and final repository verification.

- [ ] **Step 1: Start or verify the task-owned application**

Verify `http://127.0.0.1:17862/health`. If the existing process does not serve the current branch, start a task-owned Bun server on a free port and record that URL. Do not terminate user-owned processes.

- [ ] **Step 2: Verify desktop behavior with browser-use**

At 1440 px width, verify from the rendered DOM:

- `.sidebar-preferences` is visible without a click;
- there are exactly two language buttons labeled `中文` and `English`;
- there are exactly two appearance buttons labeled `暖光` and `清朗`;
- neither `Google` nor a skin label equal to `游伴` appears in the appearance group;
- clicking `English` changes the document language to `en-US` and shows `Warm`/`Clear`;
- clicking `Clear` sets `document.documentElement.dataset.skin` to `google`;
- reload preserves both values.

- [ ] **Step 3: Verify mobile drawer layout with browser-use**

At 375 x 844 and 320 x 700, open the existing mobile drawer and verify:

- the two groups fit without horizontal overflow;
- every preference button has at least a 44 px rendered height;
- share tool, preferences, and account row remain reachable;
- closing the drawer returns focus and does not alter selected preferences.

- [ ] **Step 4: Verify keyboard order and account actions**

Use keyboard navigation in browser-use to confirm focus proceeds from share entry through language, appearance, and account controls. Open the account menu and verify vector icons accompany memory management and switching-user actions; execute neither destructive nor session-changing action.

- [ ] **Step 5: Run the final integration gate**

Run:

```bash
cd frontend
bun run test:unit
bun run build
cd ../backend-ts
bun test
bun run typecheck
bun run audit:python-tests
cd ..
git diff --check HEAD~3..HEAD
git status --short --branch
```

Expected: frontend tests, build, 156+ backend tests, backend type checking, and Python disposition audit all exit 0. The worktree is clean and only the intended commits are present.

- [ ] **Step 6: Record verification outcome**

Report exact test counts, build warnings, browser viewports, persisted DOM values, commit ids, and any remaining real-model/deployment gates from the backend rewrite. Do not claim the real 30-day model SLA or dual-machine deployment is complete unless separately executed with credentials and authorization.
