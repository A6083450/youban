import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'

const user = { user_id: 'planning-acceptance-user', nickname: 'Planning QA' } as const
const attemptedIntakeThought = '正在梳理你的旅行偏好与行程条件'

const startIntakeVisibilityFixture = async (): Promise<{
  apiUrl: string
  stop(): Promise<void>
}> => {
  const child = spawn('bun', [
    'run',
    resolve(process.cwd(), '../backend-ts/tests/fixtures/intake-visibility-server.ts'),
  ], { stdio: ['ignore', 'pipe', 'pipe'] }) as ChildProcessWithoutNullStreams
  const stderr: string[] = []
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
  const lines = createInterface({ input: child.stdout })
  const launch = await new Promise<{ api_url: string }>((resolveLaunch, reject) => {
    const timeout = setTimeout(() => reject(new Error(`visibility fixture startup timed out: ${stderr.join('')}`)), 10_000)
    child.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`visibility fixture exited with ${code}: ${stderr.join('')}`))
    })
    lines.once('line', (line) => {
      clearTimeout(timeout)
      try {
        resolveLaunch(JSON.parse(line) as { api_url: string })
      } catch (error) {
        reject(error)
      }
    })
  })
  return {
    apiUrl: launch.api_url,
    async stop() {
      if (child.exitCode !== null) return
      const exited = new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()))
      child.kill('SIGTERM')
      await exited
    },
  }
}

const makePlan = (description = '按快速计划游览大理') => ({
  city: '大理',
  cities: ['大理'],
  start_date: '2026-10-01',
  end_date: '2026-10-07',
  traveler_count: 2,
  room_count: 1,
  days: Array.from({ length: 7 }, (_, dayIndex) => ({
    date: `2026-10-${String(dayIndex + 1).padStart(2, '0')}`,
    day_index: dayIndex,
    city: '大理',
    description: dayIndex === 0 ? description : `第 ${dayIndex + 1} 天行程`,
    transportation: '公共交通',
    accommodation: '舒适型酒店',
    hotel: null,
    attractions: [],
    meals: [],
  })),
  weather_info: [],
  overall_suggestions: '出发前确认开放时间与预约信息。',
})

const installUser = async (page: Page): Promise<void> => {
  await page.addInitScript((storedUser) => {
    localStorage.setItem('tripstar.user', JSON.stringify(storedUser))
    localStorage.setItem('tripstar-locale', 'zh-CN')
    sessionStorage.setItem('youban_splashed', '1')
  }, user)
}

const mockPlanApis = async (
  page: Page,
  planId: string,
  status: 'running' | 'completed' | 'failed' | 'skipped',
  serverPlan = makePlan(),
): Promise<void> => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/me') {
      await route.fulfill({ json: { success: true, user } })
      return
    }
    if (path === '/api/trip/history') {
      await route.fulfill({ json: { items: [] } })
      return
    }
    if (path === '/api/conversations') {
      await route.fulfill({ json: { items: [] } })
      return
    }
    if (path === `/api/trip/status/${planId}`) {
      await route.fulfill({
        json: {
          task_id: planId,
          plan_id: planId,
          status: 'completed',
          plan_quality: status === 'completed' ? 'enhanced' : 'fast',
          enhancement_status: status,
          result: { success: true, message: 'ok', plan_id: planId, data: serverPlan },
          execution: {},
        },
      })
      return
    }
    if (path.endsWith('/conversation')) {
      await route.fulfill({ json: { plan_id: planId, messages: [] } })
      return
    }
    if (path === '/api/poi/photo') {
      await route.fulfill({ json: { success: true, data: { photo_url: '' } } })
      return
    }
    await route.fulfill({ json: {} })
  })
}

const openCachedPlan = async (
  page: Page,
  planId: string,
  cachedPlan: ReturnType<typeof makePlan>,
  status: 'running' | 'completed' | 'failed' | 'skipped',
  serverPlan = cachedPlan,
): Promise<void> => {
  await installUser(page)
  await page.addInitScript(({ storedPlanId, storedPlan }) => {
    sessionStorage.setItem('planId', storedPlanId)
    sessionStorage.setItem('tripPlan', JSON.stringify(storedPlan))
  }, { storedPlanId: planId, storedPlan: cachedPlan })
  await mockPlanApis(page, planId, status, serverPlan)
  await page.goto(`/plan/${planId}`)
  await expect(page.locator('.result-container')).toBeVisible()
}

test('persists both administrator thinking switches after reload', async ({ page }) => {
  const settings = {
    vite_amap_web_key: '',
    vite_amap_web_js_key: '',
    google_maps_api_key: '',
    google_maps_proxy: '',
    xhs_cookie: '',
    openai_api_key: '',
    openai_base_url: 'https://example.invalid/v1',
    openai_model: 'fixture-model',
    llm_thinking_enabled: false,
    llm_thinking_visible: false,
  }
  let savedBody: Record<string, unknown> | null = null
  await page.addInitScript(() => {
    sessionStorage.setItem('tripstar.admin.token', 'fixture-admin-session')
    localStorage.setItem('tripstar-locale', 'zh-CN')
    sessionStorage.setItem('tripstar.admin.section', 'settings')
  })
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/admin/settings' && route.request().method() === 'PUT') {
      savedBody = route.request().postDataJSON() as Record<string, unknown>
      Object.assign(settings, savedBody)
      await route.fulfill({ json: { success: true, data: settings } })
      return
    }
    if (path === '/api/admin/settings') {
      await route.fulfill({ json: { success: true, data: settings } })
      return
    }
    await route.fulfill({ json: {} })
  })

  await page.goto('/admin')
  const enabled = page.locator('.ant-form-item').filter({ hasText: '启用模型思考' }).getByRole('switch')
  const visible = page.locator('.ant-form-item').filter({ hasText: '显示模型思考' }).getByRole('switch')
  await expect(enabled).not.toBeChecked()
  await expect(visible).toBeDisabled()
  await enabled.click()
  await visible.click()
  await page.getByRole('button', { name: '保存并应用' }).click()
  await expect.poll(() => savedBody).toEqual(expect.objectContaining({
    llm_thinking_enabled: true,
    llm_thinking_visible: true,
  }))

  await page.reload()
  await expect(enabled).toBeChecked()
  await expect(visible).toBeChecked()
})

test('renders no thought summary for a visibility-off intake stream', async ({ page }) => {
  const fixture = await startIntakeVisibilityFixture()
  try {
    await installUser(page)
    let intakeStream = ''
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname
      if (path === '/api/auth/me') {
        await route.fulfill({ json: { success: true, user } })
        return
      }
      if (path === '/api/trip/history' || path === '/api/conversations') {
        await route.fulfill({ json: { items: [] } })
        return
      }
      if (path === '/api/trip/parse/stream') {
        const response = await fetch(`${fixture.apiUrl}${path}`, {
          method: route.request().method(),
          headers: { 'content-type': 'application/json' },
          body: route.request().postData(),
        })
        intakeStream = await response.text()
        await route.fulfill({
          status: response.status,
          contentType: response.headers.get('content-type') ?? 'text/event-stream',
          body: intakeStream,
        })
        return
      }
      await route.fulfill({ json: {} })
    })

    await page.goto('/')
    const composer = page.getByPlaceholder('例如：下周末去西安玩3天，喜欢美食和历史文化…')
    await composer.fill('继续聊旅行')
    await page.getByRole('button', { name: '发送', exact: true }).click()

    await expect(page.getByText('可见回复正常返回。', { exact: true })).toBeVisible()
    expect(intakeStream).not.toContain('"type":"thinking"')
    expect(intakeStream).not.toContain(attemptedIntakeThought)
    await expect(page.getByText(attemptedIntakeThought, { exact: true })).toHaveCount(0)
    const persisted = await fetch(`${fixture.apiUrl}/api/conversations`, {
      headers: { 'x-user-id': user.user_id },
    })
    expect(await persisted.text()).not.toContain(attemptedIntakeThought)
    await expect(page.locator('.stream-wait')).toHaveCount(0)
  } finally {
    await fixture.stop()
  }
})

test('navigates an accepted fast task to its readable plan and shows the working notice', async ({ page }) => {
  const planId = 'fast-navigation-plan'
  const plan = makePlan()
  await installUser(page)
  await page.addInitScript(({ ownerId, activeTaskId }) => {
    localStorage.setItem(`tripstar.active_task.${ownerId}`, JSON.stringify({
      taskId: activeTaskId,
      city: '大理',
      days: 7,
      userText: '大理七天旅行',
      startDate: '2026-10-01',
      endDate: '2026-10-07',
    }))
  }, { ownerId: user.user_id, activeTaskId: planId })
  await mockPlanApis(page, planId, 'running', plan)
  await page.routeWebSocket('**/api/trip/ws/**', (socket) => {
    socket.send(JSON.stringify({
      task_id: planId,
      plan_id: planId,
      status: 'completed',
      stage: 'completed',
      progress: 100,
      plan_quality: 'fast',
      enhancement_status: 'running',
      result: { success: true, message: 'ok', plan_id: planId, data: plan },
    }))
  })

  await page.goto('/')

  await expect(page).toHaveURL(`/plan/${planId}`)
  await expect(page.locator('.plan-enhancement-notice')).toContainText('已先为你生成快速版计划')
  await page.getByRole('menuitem', { name: '详细日程' }).click()
  await expect(page.getByText('按快速计划游览大理', { exact: true })).toBeVisible()
})

for (const terminal of [
  { status: 'completed' as const, text: '计划细节已补充完成。' },
  { status: 'failed' as const, text: '当前计划可以正常使用，部分实时信息暂未补充' },
  { status: 'skipped' as const, text: '已保留你的修改，后台补充内容没有覆盖当前计划。' },
]) {
  test(`shows the ${terminal.status} enhancement notice`, async ({ page }) => {
    const planId = `terminal-${terminal.status}`
    await openCachedPlan(page, planId, makePlan(), terminal.status)

    await expect(page.locator('.plan-enhancement-notice')).toContainText(terminal.text)
  })
}

test('keeps the edited plan when a background enhancement is skipped on conflict', async ({ page }) => {
  const planId = 'edited-conflict-plan'
  const editedPlan = makePlan('用户保留的修改')
  const staleBackgroundPlan = makePlan('后台旧内容')
  await openCachedPlan(page, planId, editedPlan, 'skipped', staleBackgroundPlan)

  await expect(page.locator('.plan-enhancement-notice')).toContainText('已保留你的修改')
  await page.getByRole('menuitem', { name: '详细日程' }).click()
  await expect(page.getByText('用户保留的修改', { exact: true })).toBeVisible()
  await expect(page.getByText('后台旧内容', { exact: true })).toHaveCount(0)
})
