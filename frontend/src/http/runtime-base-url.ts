import type { AppPlatform } from '@/platform/auth'

type WechatEnvVersion = 'develop' | 'trial' | 'release'

export interface ApiBaseUrlConfiguration {
  fallback: string
  trial?: string
  release?: string
}

export interface RuntimeBaseUrlContext {
  platform: AppPlatform
  envVersion?: WechatEnvVersion
  hostPlatform?: string
  storedBaseUrl?: string | null
}

function explicitOverride(context: RuntimeBaseUrlContext): string {
  const stored = context.storedBaseUrl?.trim() || ''
  if (!stored)
    return ''
  if (context.platform !== 'mp-weixin' || context.hostPlatform === 'devtools')
    return stored
  return ''
}

export function selectRuntimeBaseUrl(
  context: RuntimeBaseUrlContext,
  configuration: ApiBaseUrlConfiguration,
): string {
  const override = explicitOverride(context)
  if (override)
    return override
  if (context.platform !== 'mp-weixin')
    return configuration.fallback
  if (context.envVersion === 'trial')
    return configuration.trial || configuration.fallback
  if (context.envVersion === 'release')
    return configuration.release || configuration.fallback
  return configuration.fallback
}
