export function h5HashLaunchUrl(hash: string): string {
  const route = String(hash || '').replace(/^#/, '')
  return /^\/pages\/[\w/-]+(?:\?[^#]*)?$/.test(route) ? route : ''
}

export function normalizedPagePath(route: string | undefined): string {
  const path = String(route || '').split(/[?#]/, 1)[0]
  if (!path)
    return ''
  return path.startsWith('/') ? path : `/${path}`
}

export interface StagedH5LaunchRoute {
  bootstrapHash: string
  launchUrl: string
}

export function stageH5LaunchRoute(hash: string): StagedH5LaunchRoute | undefined {
  const launchUrl = h5HashLaunchUrl(hash)
  if (!launchUrl || normalizedPagePath(launchUrl) === '/pages/index/index')
    return undefined
  return { bootstrapHash: '#/pages/index/index', launchUrl }
}

export function h5LaunchUrl(hash: string, stagedLaunchUrl = ''): string {
  return stagedLaunchUrl || h5HashLaunchUrl(hash)
}

type PageReader = () => readonly unknown[]
type PagePause = () => Promise<void>

export async function waitForInitialPage(
  readPages: PageReader = () => getCurrentPages(),
  pause: PagePause = () => new Promise(resolve => setTimeout(resolve, 16)),
  attempts = 120,
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (readPages().length > 0)
      return true
    await pause()
  }
  return readPages().length > 0
}

export function needsH5LaunchRecovery(hash: string, currentRoute: string | undefined): boolean {
  const launchUrl = h5HashLaunchUrl(hash)
  if (!launchUrl)
    return false
  return normalizedPagePath(currentRoute) !== normalizedPagePath(launchUrl)
}
