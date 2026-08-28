import { expect, test } from '@playwright/test'
import type { Page, Route } from '@playwright/test'

const user = {
  user_id: 'markdown-table-user',
  nickname: 'Markdown QA',
  avatar_url: '/api/avatars/markdown-table.jpg',
  profile_complete: true,
} as const

const conversationRecord = (sessionId: string) => ({
  record_id: sessionId,
  kind: 'conversation',
  session_id: sessionId,
  plan_id: null,
  task_id: null,
  title: '方案表格测试',
  title_status: 'generated',
  state: 'chatting',
  revision: 0,
  status: null,
  user_id: user.user_id,
  city: '',
  cities: [],
  start_date: '',
  end_date: '',
  travel_days: 0,
  updated_at: '2026-08-24T08:00:00.000Z',
  overall_suggestions: '',
  user_deleted_at: null,
})

const fulfillJson = (route: Route, json: unknown) => route.fulfill({ json })

const prepareConversation = async (page: Page) => {
  await page.addInitScript((storedUser) => {
    localStorage.setItem('tripstar.user', JSON.stringify(storedUser))
    localStorage.setItem('tripstar-locale', 'zh-CN')
    localStorage.setItem('tripstar.skin', 'google')
    sessionStorage.setItem('youban_splashed', '1')
  }, user)

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === '/api/auth/me') {
      await fulfillJson(route, { success: true, user })
      return
    }
    if (url.pathname === '/api/conversations' && request.method() === 'GET') {
      await fulfillJson(route, { items: [] })
      return
    }
    if (url.pathname === '/api/conversations' && request.method() === 'POST') {
      const input = request.postDataJSON() as { session_id: string }
      await fulfillJson(route, conversationRecord(input.session_id))
      return
    }
    if (url.pathname.startsWith('/api/conversations/') && request.method() === 'PUT') {
      const sessionId = decodeURIComponent(url.pathname.split('/').at(-1) || '')
      await fulfillJson(route, { ...conversationRecord(sessionId), revision: 1 })
      return
    }
    if (url.pathname === '/api/trip/parse/stream') {
      await route.fulfill({
        contentType: 'text/event-stream',
        body: [
          `data: ${JSON.stringify({
            type: 'final',
            payload: {
              success: true,
              action: 'clarify',
              reply: [
                '我把方案放在一起对比：',
                '',
                '| 方案 | 特点 | 建议天数 |',
                '| --- | --- | --- |',
                '| 1. 呀诺达雨林 | 热带雨林探秘 | 2天 |',
                '| 2. 西岛 | 小众海岛慢游 | 2天 |',
              ].join('\n'),
              recommendations: [],
              follow_up_question: '',
              need_clarify: true,
              clarify_question: '',
              summary: '',
              trip: null,
            },
          })}`,
          'data: [DONE]',
          '',
        ].join('\n\n'),
      })
      return
    }
    await fulfillJson(route, {})
  })

  await page.goto('/')
  const composer = page.getByPlaceholder('例如：下周末去西安玩3天，喜欢美食和历史文化…')
  await composer.fill('给我几个自然风光方案')
  await page.getByRole('button', { name: '发送', exact: true }).click()
}

test('renders Markdown choices as a visibly separated table that follows the skin', async ({ page }) => {
  await prepareConversation(page)

  const table = page.locator('.assistant-markdown table')
  const heading = table.locator('th').first()
  const cell = table.locator('td').first()
  await expect(table).toBeVisible()
  await expect(table).toHaveCSS('border-style', 'solid')
  await expect(table).toHaveCSS('border-width', '1px')
  await expect(heading).toHaveCSS('background-color', 'rgba(59, 155, 180, 0.1)')
  await expect(cell).toHaveCSS('padding-top', '10px')

  await page.getByRole('button', { name: /暖光/ }).click()
  await expect(heading).toHaveCSS('background-color', 'rgba(217, 119, 87, 0.1)')
})
