import { readonly, ref } from 'vue'

interface PrivacyDecision {
  event: 'exposureAuthorization' | 'agree' | 'disagree'
  buttonId?: string
}

type PrivacyResolve = (decision: PrivacyDecision) => void

interface WechatPrivacyApi {
  onNeedPrivacyAuthorization: (listener: (resolve: PrivacyResolve) => void) => void
  getPrivacySetting: (options: { success: (result: { needAuthorization: boolean }) => void }) => void
  openPrivacyContract: (options: object) => void
}

export function createWechatPrivacyAuthorization(api: WechatPrivacyApi | null) {
  const visible = ref(false)
  let installed = false
  let pendingResolve: PrivacyResolve | null = null

  function install(): void {
    if (!api || installed)
      return
    installed = true
    api.onNeedPrivacyAuthorization((resolve) => {
      pendingResolve?.({ event: 'disagree' })
      pendingResolve = resolve
      visible.value = true
      resolve({ event: 'exposureAuthorization' })
    })
    api.getPrivacySetting({
      success: ({ needAuthorization }) => {
        if (needAuthorization)
          visible.value = true
      },
    })
  }

  function decide(decision: PrivacyDecision): void {
    const resolve = pendingResolve
    pendingResolve = null
    visible.value = false
    resolve?.(decision)
  }

  return {
    visible: readonly(visible),
    install,
    agree: (buttonId: string) => decide({ buttonId, event: 'agree' }),
    disagree: () => decide({ event: 'disagree' }),
    openContract: () => api?.openPrivacyContract({}),
  }
}

const runtimeApi: WechatPrivacyApi | null = typeof wx === 'undefined'
  ? null
  : {
      onNeedPrivacyAuthorization: listener => (
        wx.onNeedPrivacyAuthorization as unknown as WechatPrivacyApi['onNeedPrivacyAuthorization']
      )(listener),
      getPrivacySetting: options => (
        wx.getPrivacySetting as unknown as WechatPrivacyApi['getPrivacySetting']
      )(options),
      openPrivacyContract: options => wx.openPrivacyContract(options),
    }

export const wechatPrivacyAuthorization = createWechatPrivacyAuthorization(runtimeApi)
