import { authHeaders, currentPlatform, expireAuthSession } from '@/platform/auth'
import { getStoredValue, setStoredValue, StorageKeys } from '@/platform/storage'
import { selectRuntimeBaseUrl } from './runtime-base-url'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface ApiRequestOptions {
  method?: HttpMethod
  data?: unknown
  headers?: Record<string, string>
  public?: boolean
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly data: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function wechatRuntime(): {
  envVersion?: 'develop' | 'trial' | 'release'
  hostPlatform?: string
} {
  let envVersion: 'develop' | 'trial' | 'release' | undefined
  let hostPlatform: string | undefined
  try {
    envVersion = uni.getAccountInfoSync().miniProgram.envVersion
  }
  catch {
    envVersion = undefined
  }
  try {
    hostPlatform = String(uni.getSystemInfoSync().platform || '').toLowerCase()
  }
  catch {
    hostPlatform = undefined
  }
  return { envVersion, hostPlatform }
}

export function getApiBaseUrl(): string {
  const platform = currentPlatform()
  const runtime = platform === 'mp-weixin' ? wechatRuntime() : {}
  const selected = selectRuntimeBaseUrl({
    platform,
    storedBaseUrl: getStoredValue<string>(StorageKeys.apiBaseUrl),
    ...runtime,
  }, {
    fallback: import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_SERVER_BASEURL || '',
    trial: import.meta.env.VITE_SERVER_BASEURL__WEIXIN_TRIAL,
    release: import.meta.env.VITE_SERVER_BASEURL__WEIXIN_RELEASE,
  })
  return trimTrailingSlash(selected)
}

export function setApiBaseUrl(value: string): string {
  const normalized = trimTrailingSlash(value)
  setStoredValue(StorageKeys.apiBaseUrl, normalized || null)
  return normalized
}

export function handleUnauthorizedResponse(status: number, isPublic = false): void {
  if (status === 401 && !isPublic)
    expireAuthSession()
}

function errorMessage(data: unknown, fallback: string): string {
  if (typeof data === 'object' && data !== null && 'detail' in data) {
    const detail = (data as { detail?: unknown }).detail
    if (typeof detail === 'string' && detail.trim())
      return detail
  }
  return fallback
}

function adminSessionHeaders(): Record<string, string> {
  try {
    const token = typeof window === 'undefined' ? '' : window.sessionStorage.getItem('youban_admin_token')?.trim()
    return token ? { 'X-Admin-Token': token } : {}
  }
  catch {
    return {}
  }
}

export function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    uni.request({
      url: `${getApiBaseUrl()}${path}`,
      method: (options.method ?? 'GET') as UniNamespace.RequestOptions['method'],
      data: options.data as UniNamespace.RequestOptions['data'],
      withCredentials: true,
      header: {
        'Content-Type': 'application/json',
        ...(!options.public ? authHeaders() : {}),
        ...adminSessionHeaders(),
        ...options.headers,
      },
      success(response) {
        const status = Number(response.statusCode)
        if (status >= 200 && status < 300) {
          resolve(response.data as T)
          return
        }
        handleUnauthorizedResponse(status, Boolean(options.public))
        reject(new ApiError(errorMessage(response.data, `请求失败（${status}）`), status, response.data))
      },
      fail(error) {
        reject(new ApiError(error.errMsg || '网络连接不可用', 0, error))
      },
    })
  })
}
