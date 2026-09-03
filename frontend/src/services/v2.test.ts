import { describe, expect, it } from 'vitest'
import {
  approveWebLoginChallenge,
  authMemoryPath,
  createWebLoginChallenge,
  exchangeWebLoginChallenge,
  getWebLoginChallengeStatus,
  miniProgramActionPath,
  scanWebLoginChallenge,
  taskEventsPath,
  taskStatusPath,
  tripAttractionPath,
  tripBudgetItemPath,
  tripItemStatusPath,
  tripPlanConversationPath,
  tripPlanResourcePath,
  tripRetryPath,
} from './v2'

const challenge = {
  challenge_id: 'a'.repeat(32),
  expires_at: '2026-09-02T13:30:00.000Z',
  qr_code_data_url: 'data:image/png;base64,AAAA',
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

  it('uses the browser-bound Web challenge endpoints', async () => {
    const requests: UniNamespace.RequestOptions[] = []
    vi.mocked(uni.request).mockImplementation((options) => {
      requests.push(options)
      options.success?.({
        data: requests.length === 1 ? challenge : { status: 'pending' },
        statusCode: 200,
        header: {},
        cookies: [],
        errMsg: 'request:ok',
      })
      return {} as UniApp.RequestTask
    })

    await expect(createWebLoginChallenge()).resolves.toEqual(challenge)
    await getWebLoginChallengeStatus(challenge.challenge_id)
    await scanWebLoginChallenge(challenge.challenge_id)
    await approveWebLoginChallenge(challenge.challenge_id)
    await exchangeWebLoginChallenge(challenge.challenge_id)

    expect(requests.map(request => [request.url, request.method])).toEqual([
      ['/api/v2/auth/web/challenges', 'POST'],
      [`/api/v2/auth/web/challenges/${challenge.challenge_id}/status`, 'GET'],
      [`/api/v2/auth/web/challenges/${challenge.challenge_id}/scan`, 'POST'],
      [`/api/v2/auth/web/challenges/${challenge.challenge_id}/approve`, 'POST'],
      [`/api/v2/auth/web/challenges/${challenge.challenge_id}/exchange`, 'POST'],
    ])
    expect(requests.every(request => request.withCredentials)).toBe(true)
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
