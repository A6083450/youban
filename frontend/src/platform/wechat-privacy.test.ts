import { describe, expect, it, vi } from 'vitest'
import { createWechatPrivacyAuthorization } from './wechat-privacy'

describe('wechat privacy authorization', () => {
  it('resumes a blocked native component only after the user agrees', () => {
    interface Decision {
      event: 'exposureAuthorization' | 'agree' | 'disagree'
      buttonId?: string
    }
    const listeners: Array<(resolve: (decision: Decision) => void) => void> = []
    const api = {
      onNeedPrivacyAuthorization: vi.fn((listener: (resolve: (decision: Decision) => void) => void) => {
        listeners.push(listener)
      }),
      getPrivacySetting: vi.fn(),
      openPrivacyContract: vi.fn(),
    }
    const authorization = createWechatPrivacyAuthorization(api)
    const resolve = vi.fn()

    authorization.install()
    authorization.install()
    listeners[0]!(resolve)

    expect(api.onNeedPrivacyAuthorization).toHaveBeenCalledTimes(1)
    expect(authorization.visible.value).toBe(true)
    expect(resolve).toHaveBeenCalledWith({ event: 'exposureAuthorization' })

    authorization.agree('youban-privacy-agree')

    expect(authorization.visible.value).toBe(false)
    expect(resolve).toHaveBeenLastCalledWith({
      buttonId: 'youban-privacy-agree',
      event: 'agree',
    })
  })

  it('shows the privacy prompt before a protected native component is tapped', () => {
    const api = {
      onNeedPrivacyAuthorization: vi.fn(),
      getPrivacySetting: vi.fn(({ success }) => success({ needAuthorization: true })),
      openPrivacyContract: vi.fn(),
    }
    const authorization = createWechatPrivacyAuthorization(api)

    authorization.install()

    expect(authorization.visible.value).toBe(true)
  })
})
