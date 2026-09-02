import { describe, expect, it } from 'vitest'
import { buildAuthHeaders } from './auth'

describe('platform auth headers', () => {
  it('uses the HttpOnly cookie session on H5', () => {
    expect(buildAuthHeaders('h5', 'mini-token')).toEqual({})
  })

  it('uses a bearer token in the WeChat mini program', () => {
    expect(buildAuthHeaders('mp-weixin', 'mini-token')).toEqual({
      Authorization: 'Bearer mini-token',
    })
  })

  it('does not emit an empty bearer header', () => {
    expect(buildAuthHeaders('mp-weixin', '')).toEqual({})
  })
})
