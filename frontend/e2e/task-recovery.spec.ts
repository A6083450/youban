import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const taskId = 'recovering-plan'
const user = { user_id: 'task-recovery-user', nickname: 'Recovery QA' }

const mockTaskApis = async (page: Page): Promise<void> => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/trip/history') {
      await route.fulfill({
        json: {
          items: [{
            plan_id: taskId,
            task_id: taskId,
            status: 'processing',
            city: '云南',
            start_date: '2026-08-10',
            end_date: '2026-08-14',
            travel_days: 5,
            updated_at: '2026-08-04T21:00:00+08:00',
          }],
        },
      })
      return
    }
    if (path === '/api/auth/me') {
      await route.fulfill({ json: { success: true, user } })
      return
    }
    await route.fulfill({ status: 404, json: { detail: 'not found' } })
  })
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((storedUser) => {
    localStorage.setItem('tripstar.user', JSON.stringify(storedUser))
    localStorage.setItem('tripstar-locale', 'zh-CN')
  }, user)
  await mockTaskApis(page)
})

test('restores a processing plan after the page is reopened', async ({ page }) => {
  await page.goto('/')
  await page.reload()

  const resume = page.getByRole('button', { name: '恢复生成', exact: true })
  await expect(resume).toBeVisible()
  await resume.click()

  await expect(page).toHaveURL(`/plan/${taskId}`)
})

test('shows the recovery action in the mobile plan drawer', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  await page.getByRole('button', { name: '游玩计划' }).click()

  await expect(page.getByRole('button', { name: '恢复生成', exact: true })).toBeVisible()
})

test('returns to the active generation conversation before history refreshes', async ({ page }) => {
  await page.addInitScript(({ ownerId, activeTaskId }) => {
    localStorage.setItem(`tripstar.active_task.${ownerId}`, JSON.stringify({
      taskId: activeTaskId,
      city: '新疆深度游',
      days: 19,
      userText: '规划新疆自然风光行程',
      startDate: '2026-08-05',
      endDate: '2026-08-23',
    }))
  }, { ownerId: user.user_id, activeTaskId: 'active-generation' })
  await page.goto('/plan/unrelated-plan')

  const returnAction = page.getByRole('button', { name: /新疆深度游.*返回生成对话/ })
  await expect(returnAction).toBeVisible()
  await returnAction.click()

  await expect(page).toHaveURL('/')
})

test('restores composer focus after a conversation reply finishes', async ({ page }) => {
  await page.route('**/api/trip/parse/stream', async (route) => {
    const finalPayload = {
      success: true,
      action: 'chat',
      reply: '当然可以，我们继续聊。',
      need_clarify: false,
      clarify_question: '',
      summary: '',
      trip: null,
    }
    await route.fulfill({
      contentType: 'text/event-stream',
      body: [
        'data: {"type":"delta","text":"当然可以"}',
        `data: ${JSON.stringify({ type: 'final', payload: finalPayload })}`,
        'data: [DONE]',
        '',
      ].join('\n\n'),
    })
  })
  await page.goto('/')

  const composer = page.getByPlaceholder('例如：下周末去西安玩3天，喜欢美食和历史文化…')
  await composer.fill('接着聊聊新疆')
  await page.getByRole('button', { name: '发送', exact: true }).click()

  await expect(page.getByText('当然可以，我们继续聊。', { exact: true })).toBeVisible()
  await expect(composer).toBeFocused()
})
