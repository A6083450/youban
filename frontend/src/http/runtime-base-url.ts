import type { AppPlatform } from '@/platform/auth'

type WechatEnvVersion = 'develop' | 'trial' | 'release'

export interface ApiBaseUrlConfiguration {
  fallback: string
  develop?: string
  trial?: string
  release?: string
}

export function selectRuntimeBaseUrl(
  platform: AppPlatform,
  envVersion: WechatEnvVersion | undefined,
  configuration: ApiBaseUrlConfiguration,
): string {
  if (platform !== 'mp-weixin' || !envVersion)
    return configuration.fallback
  return configuration[envVersion] || configuration.fallback
}
