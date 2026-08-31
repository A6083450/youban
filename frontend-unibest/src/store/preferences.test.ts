import { describe, expect, it, vi } from 'vitest'
import { createPreferenceController } from './preferences'

describe('account preference synchronization', () => {
  it('applies initialized server preferences', async () => {
    const apply = vi.fn()
    const patch = vi.fn()
    const controller = createPreferenceController({
      authenticated: () => true,
      local: () => ({ skin: 'default', locale: 'zh-CN' }),
      remote: async () => ({ skin: 'google', locale: 'fr-FR', initialized: true, updated_at: 'now' }),
      patch,
      apply,
    })
    await controller.sync()
    expect(apply).toHaveBeenCalledWith({ skin: 'google', locale: 'fr-FR' })
    expect(patch).not.toHaveBeenCalled()
  })

  it('initializes an empty server profile from local preferences', async () => {
    const apply = vi.fn()
    const patch = vi.fn(async () => ({ skin: 'google' as const, locale: 'en-US' as const, initialized: true, updated_at: 'now' }))
    const controller = createPreferenceController({
      authenticated: () => true,
      local: () => ({ skin: 'google', locale: 'en-US' }),
      remote: async () => ({ skin: 'default', locale: 'zh-CN', initialized: false, updated_at: null }),
      patch,
      apply,
    })
    await controller.sync()
    expect(patch).toHaveBeenCalledWith({ skin: 'google', locale: 'en-US' })
    expect(apply).toHaveBeenCalledWith({ skin: 'google', locale: 'en-US' })
  })
})
