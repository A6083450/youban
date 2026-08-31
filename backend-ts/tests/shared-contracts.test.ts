import { describe, expect, test } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import * as Contracts from '../../shared/contracts/src/index.ts'
import type { TSchema } from '@sinclair/typebox'
const {
  ApiV2Routes,
  AttractionMutationInputSchema,
  AuthResponseSchema,
  ItemExecutionPatchSchema,
  PoiSearchResponseSchema,
  PublicRuntimeSettingsResponseSchema,
  SubmitTripPlanResponseSchema,
  TripPlanRequestSchema,
  TripTaskEventSchema,
  UserMemoryListSchema,
} = Contracts

describe('shared v2 contracts', () => {
  test('all public route templates use the v2 prefix', () => {
    expect(Object.values(ApiV2Routes).every(route => route.startsWith('/api/v2/'))).toBe(true)
    expect(ApiV2Routes.runtimeSettings).toBe('/api/v2/settings')
  })

  test('website login exposes only official widget configuration', () => {
    const schema = (Contracts as unknown as { WechatWebLoginStartSchema?: TSchema })
      .WechatWebLoginStartSchema

    expect(ApiV2Routes.authWechatWebStart).toBe('/api/v2/auth/wechat-web/start')
    expect(ApiV2Routes.authWechatWebCallback).toBe('/api/v2/auth/wechat-web/callback')
    expect(ApiV2Routes).not.toHaveProperty('authWebChallenges')
    expect(ApiV2Routes).not.toHaveProperty('authWebChallengeStatus')
    expect(ApiV2Routes).not.toHaveProperty('authWebChallengeApprove')
    expect(ApiV2Routes).not.toHaveProperty('authWebChallengeExchange')
    expect(schema).toBeDefined()
    expect(Value.Check(schema!, {
      app_id: 'wx-web-app',
      scope: 'snsapi_login',
      redirect_uri: 'https://youban.me/api/v2/auth/wechat-web/callback',
      state: 'opaque-state-with-at-least-32-bytes',
    })).toBe(true)
    expect(Value.Check(schema!, {
      app_id: 'wx-web-app',
      app_secret: 'must-not-leak',
    })).toBe(false)
  })

  test('public runtime settings expose only client-safe map and display options', () => {
    expect(Value.Check(PublicRuntimeSettingsResponseSchema, {
      success: true,
      data: {
        vite_amap_web_key: 'rest-key',
        vite_amap_web_js_key: 'js-key',
        google_maps_api_key: '',
        google_maps_proxy: '',
        llm_thinking_enabled: true,
        llm_thinking_visible: false,
      },
    })).toBe(true)
    expect(Value.Check(PublicRuntimeSettingsResponseSchema, {
      success: true,
      data: { openai_api_key: 'must-not-leak' },
    })).toBe(false)
  })

  test('auth response requires a complete typed user payload', () => {
    expect(Value.Check(AuthResponseSchema, {
      success: true,
      user: {
        user_id: 'user-1',
        nickname: '旅行者',
        avatar_url: '/api/avatars/avatar.png',
        profile_complete: true,
      },
    })).toBe(true)
    expect(Value.Check(AuthResponseSchema, { success: true, user: { user_id: 'user-1' } })).toBe(false)
  })

  test('trip submission and task events share one validated shape', () => {
    expect(Value.Check(TripPlanRequestSchema, {
      city: '杭州',
      cities: [{ city: '杭州', days: 2 }],
      start_date: '2026-09-01',
      end_date: '2026-09-02',
      travel_days: 2,
      transportation: '高铁',
      accommodation: '舒适型酒店',
      traveler_count: 2,
      room_count: 1,
      budget_basis: 'group_total',
      preferences: ['人文'],
      execution_token: 'confirmed-token',
    })).toBe(true)
    expect(Value.Check(SubmitTripPlanResponseSchema, {
      task_id: 'task-1',
      plan_id: 'plan-1',
      status: 'processing',
      ws_url: '/api/v2/trip/ws/task-1',
      message: '任务已提交',
    })).toBe(true)
    expect(Value.Check(TripTaskEventSchema, {
      task_id: 'task-1',
      plan_id: 'plan-1',
      status: 'processing',
      stage: 'planning',
      progress: 50,
      message: '正在规划',
    })).toBe(true)
  })

  test('itinerary mutation contracts require verified coordinates and bounded execution values', () => {
    expect(Value.Check(PoiSearchResponseSchema, {
      success: true,
      message: '搜索成功',
      data: [{
        id: 'poi-1',
        name: '西湖',
        type: '风景名胜',
        address: '杭州市西湖区',
        location: { longitude: 120.15, latitude: 30.25 },
      }],
    })).toBe(true)
    expect(Value.Check(AttractionMutationInputSchema, {
      day_index: 0,
      poi_id: 'poi-1',
      name: '西湖',
      location: { longitude: 120.15, latitude: 30.25 },
      visit_duration: 120,
      ticket_price: 0,
      start_time: '09:00',
    })).toBe(true)
    expect(Value.Check(AttractionMutationInputSchema, {
      day_index: 0,
      poi_id: 'poi-1',
      name: '西湖',
      visit_duration: 10,
      ticket_price: -1,
      start_time: '9am',
    })).toBe(false)
    expect(Value.Check(ItemExecutionPatchSchema, { status: 'done', actual_cost: 88 })).toBe(true)
    expect(Value.Check(ItemExecutionPatchSchema, { status: 'done', actual_cost: -1 })).toBe(false)
  })

  test('account memories remain typed and user-scoped in v2', () => {
    expect(ApiV2Routes.authMemories).toBe('/api/v2/auth/memories')
    expect(Value.Check(UserMemoryListSchema, {
      success: true,
      items: [{ id: 'memory-1', memory: '喜欢安静的自然景点', created_at: '2026-08-21' }],
    })).toBe(true)
    expect(Value.Check(UserMemoryListSchema, {
      success: true,
      items: [{ id: 'memory-1', memory: '' }],
    })).toBe(false)
  })
})
