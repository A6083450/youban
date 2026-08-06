import type { Location } from '@/types'

/**
 * 高德地图 URI API 的经纬度上限：小数位过多会被截断，统一保留 6 位。
 * 高德坐标系为 GCJ-02，与后端 amap_service 返回的坐标一致，无需转换。
 */
const COORD_PRECISION = 6

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/** 经纬度必须在合法值域内，AI 生成的坐标偶发为 0 或越界 */
export const hasUsableLocation = (location?: Location | null): location is Location =>
  isFiniteNumber(location?.longitude)
  && isFiniteNumber(location?.latitude)
  && Math.abs(location.longitude) <= 180
  && Math.abs(location.latitude) <= 90
  && !(location.longitude === 0 && location.latitude === 0)

const formatCoord = (value: number): string =>
  String(Number(value.toFixed(COORD_PRECISION)))

/**
 * 生成高德地图导航链接。移动端唤起 App，桌面端回退到网页版。
 * 返回 null 表示坐标不可用，调用方应隐藏入口而非给出坏链接。
 */
export const buildAmapNavigationUrl = (
  name: string,
  location?: Location | null,
): string | null => {
  if (!hasUsableLocation(location)) return null

  const longitude = formatCoord(location.longitude)
  const latitude = formatCoord(location.latitude)
  const params = new URLSearchParams({
    to: `${longitude},${latitude},${String(name ?? '').trim() || '目的地'}`,
    mode: 'car',
    policy: '1',
    src: 'youban',
    coordinate: 'gaode',
    callnative: '1',
  })

  return `https://uri.amap.com/navigation?${params.toString()}`
}
