import { describe, expect, it } from 'vitest'
import {
  authMemoryPath,
  miniProgramActionPath,
  startWechatWebLogin,
  taskEventsPath,
  taskStatusPath,
  tripAttractionPath,
  tripBudgetItemPath,
  tripItemStatusPath,
  tripPlanConversationPath,
  tripPlanResourcePath,
  tripRetryPath,
} from './v2'

const websiteConfiguration = {
  app_id: 'wx-web-app',
  scope: 'snsapi_login' as const,
  redirect_uri: 'https://youban.me/api/v2/auth/wechat-web/callback',
  state: 'opaque-state-with-at-least-32-bytes',
}

describe('v2 service paths', () => {
  it('encodes task identifiers in HTTP and WebSocket routes', () => {
    expect(authMemoryPath('memory / 1')).toBe('/api/v2/auth/memories/memory%20%2F%201')
    expect(taskStatusPath('task / 1')).toBe('/api/v2/trip/status/task%20%2F%201')
    expect(taskEventsPath('task / 1')).toBe('/api/v2/trip/ws/task%20%2F%201')
    expect(miniProgramActionPath('action / 1')).toBe('/api/v2/miniprogram/actions/action%20%2F%201')
    expect(tripRetryPath('plan / 1')).toBe('/api/v2/trip/plan/plan%20%2F%201/retry')
    expect(tripPlanConversationPath('plan / 1')).toBe('/api/v2/trip/plan/plan%20%2F%201/conversation')
    expect(tripPlanResourcePath('plan / 1')).toBe('/api/v2/trip/plan/plan%20%2F%201')
    expect(tripBudgetItemPath('plan 1', 'item/2')).toBe('/api/v2/trip/plan/plan%201/budget-items/item%2F2')
    expect(tripAttractionPath('plan 1', 'poi/2')).toBe('/api/v2/trip/plan/plan%201/attractions/poi%2F2')
    expect(tripItemStatusPath('plan 1', 'item/2')).toBe('/api/v2/trip/plan/plan%201/items/item%2F2/status')
  })

  it('starts official website login through the credentialed public endpoint', async () => {
    let requestOptions: UniNamespace.RequestOptions | undefined
    vi.mocked(uni.request).mockImplementation((options) => {
      requestOptions = options
      options.success?.({
        data: websiteConfiguration,
        statusCode: 200,
        header: {},
        cookies: [],
        errMsg: 'request:ok',
      })
      return {} as UniApp.RequestTask
    })

    await expect(startWechatWebLogin()).resolves.toEqual(websiteConfiguration)
    expect(requestOptions).toEqual(expect.objectContaining({
      url: '/api/v2/auth/wechat-web/start',
      method: 'POST',
      data: {},
      withCredentials: true,
    }))
  })

  it('logs a website nickname in through the credentialed public endpoint', async () => {
    let requestOptions: UniNamespace.RequestOptions | undefined
    vi.mocked(uni.request).mockImplementation((options) => {
      requestOptions = options
      options.success?.({
        data: {
          success: true,
          user: {
            user_id: 'nickname-user',
            nickname: '旅行者',
            avatar_url: null,
            profile_complete: true,
          },
        },
        statusCode: 200,
        header: {},
        cookies: [],
        errMsg: 'request:ok',
      })
      return {} as UniApp.RequestTask
    })
    const service = await import('./v2') as typeof import('./v2') & {
      loginNickname?: (nickname: string) => Promise<unknown>
    }

    expect(service.loginNickname).toEqual(expect.any(Function))
    await service.loginNickname!('旅行者')
    expect(requestOptions).toEqual(expect.objectContaining({
      url: '/api/v2/auth/nickname',
      method: 'POST',
      data: { nickname: '旅行者' },
      withCredentials: true,
    }))
  })
})
