import { expect, test } from '@playwright/test'
import type { Page, Route } from '@playwright/test'

const user = {
  user_id: 'composer-loading-user',
  nickname: 'Composer QA',
  avatar_url: '/api/avatars/composer-loading.jpg',
  profile_complete: true,
} as const

const conversationRecord = (sessionId: string) => ({
  record_id: sessionId,
  kind: 'conversation',
  session_id: sessionId,
  plan_id: null,
  task_id: null,
  title: '测试发送状态',
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

test('shows only the spinner while the composer is sending', async ({ page }) => {
  let releaseStream!: () => void
  const streamRelease = new Promise<void>((resolve) => { releaseStream = resolve })

  await page.addInitScript((storedUser) => {
    localStorage.setItem('tripstar.user', JSON.stringify(storedUser))
    localStorage.setItem('tripstar-locale', 'zh-CN')
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
      await streamRelease
      await route.fulfill({
        contentType: 'text/event-stream',
        body: [
          `data: ${JSON.stringify({
            type: 'final',
            payload: {
              success: true,
              action: 'chat',
              reply: '测试完成',
              need_clarify: false,
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
  await composer.fill('测试发送状态')
  const sendButton = page.getByRole('button', { name: '发送', exact: true })
  await sendButton.click()

  await expect(sendButton).toHaveClass(/is-loading/)
  await expect(sendButton.locator('svg')).toHaveCount(1)

  releaseStream()
  await expect(page.getByText('测试完成', { exact: true })).toBeVisible()
})
