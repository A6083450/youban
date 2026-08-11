# README Screenshot Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the YouBan README to describe the current release and replace the outdated application gallery with ten current, visually verified screenshots.

**Architecture:** Treat the running Vue/FastAPI application as the source of truth, capture a single coherent Chinese-language journey at fixed desktop and mobile viewports, then point a rewritten README gallery at semantic image paths. Do not change application behavior; use existing local data first and existing E2E data contracts only when a transient UI state cannot be reproduced safely from local data.

**Tech Stack:** Vue 3/Vite, FastAPI/Uvicorn, Playwright browser automation, Markdown/HTML, PNG assets, macOS `sips`.

## Global Constraints

- Desktop screenshots use a 1440 x 900 viewport.
- Mobile screenshots use a 390 x 844 viewport.
- Every screenshot uses the Chinese interface and the same representative journey where journey data is visible.
- Do not commit runtime data, downloaded files, temporary capture scripts, browser profiles, or product-code changes.
- Screenshot copy describes visible product behavior in ordinary Chinese and avoids implementation details.
- The final gallery contains six desktop images and four mobile images with semantic filenames.

---

### Task 1: Verify the current application and prepare a coherent capture state

**Files:**
- Read: `README.md`
- Read: `frontend/src/main.ts`
- Read: `frontend/e2e/home-ongoing.spec.ts`
- Read: `frontend/e2e/youban-loader.spec.ts`
- Read: `frontend/e2e/trip-blueprint.spec.ts`
- Read: `frontend/e2e/today-feedback.spec.ts`
- Create temporarily: `/tmp/youban-readme-capture/` (capture staging only; remove after assets are copied and verified)

**Interfaces:**
- Consumes: the current `main` checkout, backend health endpoint, frontend routes, existing browser-visible local trip data, and E2E fixture contracts.
- Produces: one verified frontend URL and a capture checklist whose states can be reached without changing product code.

- [ ] **Step 1: Confirm branch and worktree state**

Run:

```bash
git status --short --branch
git log -3 --oneline --decorate
```

Expected: the active branch contains the approved design commit, and any unrelated user changes are identified before screenshots are written.

- [ ] **Step 2: Identify the real served application before starting anything**

Probe ports without assuming ownership:

```bash
for port in 4173 5173 5174; do
  code=$(curl -L -s -o /tmp/youban-port-$port.html -w '%{http_code}' --max-time 2 "http://127.0.0.1:$port/" || true)
  title=$(rg -o '<title>[^<]+' -m1 "/tmp/youban-port-$port.html" || true)
  printf '%s %s %s\n' "$port" "$code" "$title"
done
curl -fsS --max-time 2 http://127.0.0.1:8000/health
```

Expected: an existing port is accepted only when its page title/content is YouBan and backend health succeeds.

- [ ] **Step 3: Start missing services from their owning directories**

If backend health is unavailable, run from `backend/`:

```bash
./.venv/bin/uvicorn app.api.main:app --reload --host 127.0.0.1 --port 8000
```

If no verified YouBan frontend is running, run from `frontend/` on the first verified-free port:

```bash
npm run dev -- --host 127.0.0.1 --port 4173 --strictPort
```

Expected: `curl -fsS http://127.0.0.1:8000/health` succeeds and the selected frontend root renders the YouBan title rather than another application.

- [ ] **Step 4: Inspect current local user and trip states in the browser**

Open the verified frontend URL, set the locale to Chinese, and check these routes/states in order:

```text
/login
/
/plan/<completed-plan-id>?section=overview
/plan/<completed-plan-id>?section=days
/plan/<active-today-plan-id>?section=today
```

Expected: use one complete local plan when it covers overview, days, today, and sharing. If no such plan exists, prepare only the missing states in the browser session using the request/response shapes already defined in the four listed E2E specs.

- [ ] **Step 5: Create an isolated temporary capture directory**

Run:

```bash
mkdir -p /tmp/youban-readme-capture/pc /tmp/youban-readme-capture/mobile
```

Expected: no capture output is written directly over tracked images before visual review.

---

### Task 2: Capture and visually approve the new application gallery

**Files:**
- Create: `imgs/pc/login.png`
- Create: `imgs/pc/planning-home.png`
- Create: `imgs/pc/requirements-confirmation.png`
- Create: `imgs/pc/generation-progress.png`
- Create: `imgs/pc/trip-overview.png`
- Create: `imgs/pc/daily-itinerary.png`
- Create: `imgs/mobile/planning-home.png`
- Create: `imgs/mobile/planning-progress.png`
- Create: `imgs/mobile/today-trip.png`
- Create: `imgs/mobile/trip-details-share.png`

**Interfaces:**
- Consumes: the verified URL and stable capture states from Task 1.
- Produces: ten reviewed PNG images at the exact semantic paths consumed by Task 3.

- [ ] **Step 1: Capture six desktop states at 1440 x 900**

Use Playwright with a new page configured as:

```javascript
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.emulateMedia({ reducedMotion: 'reduce' })
```

Capture viewport screenshots, with animations disabled, after the named content is visible:

```text
login.png                     /login, nickname login form visible
planning-home.png             /, trip prompt and current-trip entry visible
requirements-confirmation.png conversation shows the user's request and AI confirmation
generation-progress.png       branded generation progress and percentage visible
trip-overview.png             行程总览 selected; 旅行蓝图 and representative route content visible
daily-itinerary.png           详细日程 selected; 导航前往 and 加入日历 visible
```

Write candidates under `/tmp/youban-readme-capture/pc/` first.

- [ ] **Step 2: Capture four mobile states at 390 x 844**

Create a fresh mobile page:

```javascript
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
await page.emulateMedia({ reducedMotion: 'reduce' })
```

Capture these stable viewports under `/tmp/youban-readme-capture/mobile/`:

```text
planning-home.png             trip prompt and mobile navigation visible
planning-progress.png         current generation state visible without keyboard/notification overlays
today-trip.png                今日行程 selected with progress and itinerary items visible
trip-details-share.png        plan detail visible with the 分享 entry in the mobile UI
```

- [ ] **Step 3: Validate pixels and dimensions before copying candidates**

Run:

```bash
find /tmp/youban-readme-capture -name '*.png' -print0 | xargs -0 file
find /tmp/youban-readme-capture -name '*.png' -print0 | xargs -0 sips -g pixelWidth -g pixelHeight
```

Expected: six desktop files report 1440 x 900 and four mobile files report 390 x 844. No file is zero bytes or an unexpected format.

- [ ] **Step 4: Review every candidate image**

Inspect all ten images at readable size. Reject and recapture any image with blank maps/media, clipped controls, overlapping text, loading skeletons, transient toasts, debug UI, inconsistent trip data, or an accidental non-Chinese locale.

Expected: every image clearly matches its filename and README caption; overview and daily-itinerary images show real content rather than placeholder blocks.

- [ ] **Step 5: Install only approved images at their semantic paths**

Copy the reviewed files to the exact paths listed in this task, then run:

```bash
git status --short -- imgs/pc imgs/mobile
```

Expected: exactly ten new semantic PNG assets appear before old screenshots are removed.

- [ ] **Step 6: Commit the approved screenshot set**

```bash
git add imgs/pc/login.png imgs/pc/planning-home.png imgs/pc/requirements-confirmation.png \
  imgs/pc/generation-progress.png imgs/pc/trip-overview.png imgs/pc/daily-itinerary.png \
  imgs/mobile/planning-home.png imgs/mobile/planning-progress.png \
  imgs/mobile/today-trip.png imgs/mobile/trip-details-share.png
git commit -m "docs: refresh application screenshots"
```

---

### Task 3: Rewrite the README update summary and application gallery

**Files:**
- Modify: `README.md`
- Delete: `imgs/pc/1.png`
- Delete: `imgs/pc/2.png`
- Delete: `imgs/pc/3.png`
- Delete: `imgs/pc/4.png`
- Delete: `imgs/pc/5.png`
- Delete: `imgs/pc/6.png`
- Delete: `imgs/pc/7.png`
- Delete: `imgs/pc/8.png`
- Delete: `imgs/pc/export_旅行计划_西安_1785133474988.png`
- Delete: `imgs/phome/1.png`
- Delete: `imgs/phome/2.png`
- Delete: `imgs/phome/3.png`
- Delete: `imgs/phome/4.png`
- Delete: `imgs/phome/5.png`

**Interfaces:**
- Consumes: the ten semantic PNG paths produced by Task 2.
- Produces: a README whose update notes and gallery describe the current visible product and reference no obsolete image.

- [ ] **Step 1: Update “本次更新” to the current release**

Replace stale bullets with concise visible-product notes covering:

```text
规划首页：进行中旅程可以直接回到今日行程。
今日行程：按实际执行进度打卡、跳过并查看当天回响。
行程总览：旅行蓝图、路线脉络和代表体验集中展示。
出行衔接：每日地点支持一键导航，完整行程可导出为日历文件。
生成体验：使用当前品牌化加载状态，并保留任务恢复与失败重试能力。
```

Do not claim a feature that cannot be reached in the captured running application.

- [ ] **Step 2: Replace “应用展示” with the approved ten-image structure**

Use these headings and paths exactly:

```text
PC 端
1. 开始使用 - 昵称登录，无需密码                    imgs/pc/login.png
2. 规划首页 - 描述旅程，继续进行中的行程              imgs/pc/planning-home.png
3. 对话确认 - 游伴理解需求并与你确认                  imgs/pc/requirements-confirmation.png
4. 生成行程 - 清晰展示当前规划进度                    imgs/pc/generation-progress.png
5. 行程总览 - 从旅行蓝图把握整段旅程                  imgs/pc/trip-overview.png
6. 详细日程 - 查看安排、发起导航并加入日历            imgs/pc/daily-itinerary.png

移动端
1. 随时开始规划                                      imgs/mobile/planning-home.png
2. 查看规划进度                                      imgs/mobile/planning-progress.png
3. 跟随今日行程                                      imgs/mobile/today-trip.png
4. 查看并分享完整计划                                imgs/mobile/trip-details-share.png
```

Keep desktop images centered at width 800. Render the four mobile images in one centered block at width 200 each, allowing normal wrapping on narrow README renderers.

- [ ] **Step 3: Update the feature list where the current release adds visible capability**

Under trip management, add ordinary Chinese bullets for one-click navigation, calendar export, and today's execution feedback. Avoid duplicating the gallery captions or adding internal names.

- [ ] **Step 4: Check every README-local path before deleting old assets**

Run:

```bash
rg -o 'src="[^"]+"' README.md | sed -E 's/^src="|"$//'
```

For each non-HTTP path, verify `test -f "$path"`. Expected: all ten new gallery images and the existing logo path exist; no numeric screenshot path remains.

- [ ] **Step 5: Remove the obsolete tracked application screenshots**

Delete only the fourteen files listed in this task, then run:

```bash
git status --short -- README.md imgs/pc imgs/phome imgs/mobile
```

Expected: README is modified, ten semantic assets exist, and the fourteen obsolete assets are marked deleted.

- [ ] **Step 6: Commit the README and cleanup**

```bash
git add README.md imgs/pc imgs/phome imgs/mobile
git commit -m "docs: update README for current YouBan experience"
```

---

### Task 4: Verify the complete documentation update

**Files:**
- Verify: `README.md`
- Verify: `imgs/pc/*.png`
- Verify: `imgs/mobile/*.png`

**Interfaces:**
- Consumes: the committed screenshot and README changes from Tasks 2 and 3.
- Produces: evidence that the current build, image files, README references, and browser presentation agree.

- [ ] **Step 1: Run focused navigation and calendar tests**

From `frontend/`:

```bash
node --test src/utils/tripNavigation.test.mjs src/utils/tripCalendar.test.mjs
```

Expected: all focused tests pass.

- [ ] **Step 2: Build the current frontend**

From `frontend/`:

```bash
npm run build
```

Expected: `vue-tsc && vite build` exits 0. Record existing non-blocking warnings separately rather than hiding them.

- [ ] **Step 3: Revalidate all committed image dimensions and README references**

Run:

```bash
find imgs/pc imgs/mobile -name '*.png' -print0 | xargs -0 sips -g pixelWidth -g pixelHeight
for path in $(rg -o 'src="[^"]+"' README.md | sed -E 's/^src="|"$//' | rg -v '^https?://'); do
  test -f "$path" || { echo "missing: $path"; exit 1; }
done
```

Expected: six 1440 x 900 PC images, four 390 x 844 mobile images, and no missing local README image.

- [ ] **Step 4: Perform final browser and Markdown checks**

Open the README preview and the captured application routes. Confirm that captions match images, mobile images wrap coherently, no screenshot is blank or clipped, and all claimed actions are visible in the current UI.

- [ ] **Step 5: Check repository integrity and remove temporary capture output**

Run:

```bash
git diff --check HEAD~2..HEAD
git status --short --branch
```

Move `/tmp/youban-readme-capture` to Trash after all tracked images and their hashes have been verified. Expected: no unrelated changes, no temporary files in the repository, and the branch contains only the approved documentation commits after the design commit.
