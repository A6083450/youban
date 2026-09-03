import pageDefinitions from './page-definitions.json'

interface PageDefinition {
  path: string
  type: string
  platforms?: readonly string[]
  style: {
    enablePullDownRefresh?: boolean
    navigationBarTitleText: string
    navigationStyle: string
  }
}

export const PAGE_DEFINITIONS: readonly PageDefinition[] = pageDefinitions

export function pageDefinitionsForPlatform(platform: string | undefined) {
  return PAGE_DEFINITIONS.filter(page => !page.platforms || page.platforms.includes(platform || ''))
}

const PAGE_ORDER = new Map<string, number>(PAGE_DEFINITIONS.map((page, index) => [page.path, index]))

export function sortPageDefinitions<T extends { path: string }>(pages: T[], platform?: string): T[] {
  const pageOrder = platform
    ? new Map(pageDefinitionsForPlatform(platform).map((page, index) => [page.path, index]))
    : PAGE_ORDER
  return [...pages].sort((left, right) => {
    const leftIndex = pageOrder.get(left.path) ?? Number.MAX_SAFE_INTEGER
    const rightIndex = pageOrder.get(right.path) ?? Number.MAX_SAFE_INTEGER
    return leftIndex - rightIndex
  })
}
