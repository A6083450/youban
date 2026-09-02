import { describe, expect, test } from 'bun:test'

import {
  createAccountPreferenceController,
  type AccountPreferenceValues,
  type AuthPreferences,
} from './account-preferences'

const local: AccountPreferenceValues = { skin: 'google', locale: 'fr-FR' }

function dependencies(overrides: Partial<Parameters<typeof createAccountPreferenceController>[0]> = {}) {
  const applied: AccountPreferenceValues[] = []
  const patches: Array<Partial<AccountPreferenceValues>> = []
  const platformSkins: AccountPreferenceValues['skin'][] = []
  return {
    applied,
    patches,
    platformSkins,
    value: {
      isAuthenticated: () => true,
      readLocal: () => local,
      applyLocal: (preferences: AccountPreferenceValues) => { applied.push(preferences) },
      getRemote: async (): Promise<AuthPreferences> => ({
        skin: 'default',
        locale: 'zh-CN',
        initialized: false,
        updated_at: null,
      }),
      patchRemote: async (patch: Partial<AccountPreferenceValues>): Promise<AuthPreferences> => {
        patches.push(patch)
        return { ...local, initialized: true, updated_at: '2026-08-26T00:00:00.000Z' }
      },
      syncPlatformSkin: (skin: AccountPreferenceValues['skin']) => { platformSkins.push(skin) },
      ...overrides,
    },
  }
}

describe('account preference synchronization', () => {
  test('uploads existing local preferences when the account is uninitialized', async () => {
    const fixture = dependencies()
    const controller = createAccountPreferenceController(fixture.value)

    expect(await controller.sync()).toEqual(local)
    expect(fixture.patches).toEqual([{ skin: 'google', locale: 'fr-FR' }])
    expect(fixture.applied).toEqual([local])
    expect(fixture.platformSkins).toEqual(['google'])
  })

  test('applies initialized server preferences without overwriting them from local cache', async () => {
    const remote: AuthPreferences = {
      skin: 'default',
      locale: 'en-US',
      initialized: true,
      updated_at: '2026-08-26T00:00:00.000Z',
    }
    const fixture = dependencies({ getRemote: async () => remote })
    const controller = createAccountPreferenceController(fixture.value)

    expect(await controller.sync()).toEqual({ skin: 'default', locale: 'en-US' })
    expect(fixture.patches).toEqual([])
    expect(fixture.applied).toEqual([{ skin: 'default', locale: 'en-US' }])
    expect(fixture.platformSkins).toEqual(['default'])
  })

  test('keeps the local cache active when preference sync is offline', async () => {
    const fixture = dependencies({ getRemote: async () => { throw new Error('offline') } })
    const controller = createAccountPreferenceController(fixture.value)

    expect(await controller.sync()).toEqual(local)
    expect(fixture.patches).toEqual([])
    expect(fixture.applied).toEqual([local])
    expect(fixture.platformSkins).toEqual(['google'])
  })

  test('patches only the field changed by each control', async () => {
    const fixture = dependencies()
    const controller = createAccountPreferenceController(fixture.value)

    await controller.setSkin('default')
    await controller.setLocale('en-US')

    expect(fixture.patches).toEqual([{ skin: 'default' }, { locale: 'en-US' }])
    expect(fixture.applied).toEqual([
      { skin: 'default', locale: 'fr-FR' },
      { skin: 'google', locale: 'en-US' },
    ])
    expect(fixture.platformSkins).toEqual(['default'])
  })
})
