export function readAmapCanvasDataUrl(container: HTMLElement): string {
  const canvas = container.querySelector<HTMLCanvasElement>('canvas.amap-layer, canvas')
  if (!canvas)
    return ''
  try {
    return canvas.toDataURL('image/png')
  }
  catch {
    return ''
  }
}

export function amapExportDimensions(width: number, height: number, scale = 1): {
  width: number
  height: number
  scale: number
} {
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    scale,
  }
}

interface AmapStaticMarker {
  longitude: number
  latitude: number
  color: string
  label: string
}

interface AmapStaticPath {
  color: string
  points: Array<[number, number]>
}

interface AmapStaticMapOptions {
  key: string
  width: number
  height: number
  markers: AmapStaticMarker[]
  paths: AmapStaticPath[]
}

function staticColor(value: string): string {
  return `0x${value.replace(/^#/, '').toUpperCase()}`
}

function staticCoordinate(longitude: number, latitude: number): string {
  return `${longitude.toFixed(6)},${latitude.toFixed(6)}`
}

export function buildAmapStaticMapUrl(options: AmapStaticMapOptions): string {
  const parameters = new URLSearchParams({
    key: options.key,
    size: `${Math.min(1024, Math.max(1, Math.round(options.width)))}*${Math.min(1024, Math.max(1, Math.round(options.height)))}`,
    scale: '1',
  })
  const markers = options.markers.slice(0, 10).map(marker =>
    `mid,${staticColor(marker.color)},${marker.label.slice(0, 1)}:${staticCoordinate(marker.longitude, marker.latitude)}`,
  )
  if (markers.length)
    parameters.set('markers', markers.join('|'))
  const paths = options.paths.slice(0, 4)
    .filter(path => path.points.length > 1)
    .map(path => `5,${staticColor(path.color)},0.85,,:${path.points.map(point => staticCoordinate(point[0], point[1])).join(';')}`)
  if (paths.length)
    parameters.set('paths', paths.join('|'))
  return `https://restapi.amap.com/v3/staticmap?${parameters}`
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('AMap static map response could not be decoded'))
    reader.onerror = () => reject(reader.error || new Error('AMap static map response could not be decoded'))
    reader.readAsDataURL(blob)
  })
}

export async function loadAmapStaticMapDataUrl(
  url: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 12_000,
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher(url, { signal: controller.signal })
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('image/'))
      throw new Error('AMap static map request failed')
    return await blobToDataUrl(await response.blob())
  }
  finally {
    clearTimeout(timer)
  }
}

interface AmapCanvasWaitOptions {
  attempts?: number
  intervalMs?: number
}

function hasRenderedMapDetail(dataUrl: string, canvas: HTMLCanvasElement): boolean {
  const encodedLength = dataUrl.length - dataUrl.indexOf(',') - 1
  return encodedLength >= Math.max(4096, canvas.width * canvas.height * 0.08)
}

export async function waitForAmapCanvasDataUrl(
  container: HTMLElement,
  options: AmapCanvasWaitOptions = {},
): Promise<string> {
  const canvas = container.querySelector<HTMLCanvasElement>('canvas.amap-layer, canvas')
  if (!canvas)
    return ''
  const attempts = Math.max(1, options.attempts ?? 60)
  const intervalMs = Math.max(0, options.intervalMs ?? 250)
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const latest = readAmapCanvasDataUrl(container)
    if (latest && hasRenderedMapDetail(latest, canvas))
      return latest
    if (attempt < attempts - 1)
      await new Promise<void>(resolve => setTimeout(resolve, intervalMs))
  }
  return ''
}

export function loadAmapDataUrl(
  dataUrl: string,
  createImage: () => HTMLImageElement = () => new Image(),
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = createImage()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('AMap canvas snapshot could not be decoded'))
    image.src = dataUrl
  })
}

export function waitForAmapOverlayWindow(rendering: Promise<unknown>, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      if (settled)
        return
      settled = true
      if (timer)
        clearTimeout(timer)
      resolve()
    }
    timer = setTimeout(finish, Math.max(0, timeoutMs))
    void rendering.then(finish, finish)
  })
}

export function waitForAmapVisibilityFrame(
  schedule: (callback: FrameRequestCallback) => number = requestAnimationFrame,
): Promise<void> {
  return new Promise((resolve) => {
    schedule(() => schedule(() => resolve()))
  })
}

interface AmapExportPin {
  x: number
  y: number
  color: string
  label?: string
  hotel?: boolean
}

export function drawAmapExportPin(
  context: CanvasRenderingContext2D,
  marker: AmapExportPin,
  scale = 1,
): void {
  context.save()
  context.translate(marker.x * scale, marker.y * scale)
  context.scale(scale, scale)
  context.beginPath()
  context.moveTo(0, 0)
  context.bezierCurveTo(-5, -8, -16, -17, -16, -28)
  context.bezierCurveTo(-16, -37, -9, -44, 0, -44)
  context.bezierCurveTo(9, -44, 16, -37, 16, -28)
  context.bezierCurveTo(16, -17, 5, -8, 0, 0)
  context.closePath()
  context.fillStyle = marker.hotel ? '#FFFDF9' : marker.color
  context.strokeStyle = marker.hotel ? marker.color : '#FFFFFF'
  context.lineWidth = 2.4
  context.shadowColor = 'rgba(61, 50, 41, 0.28)'
  context.shadowBlur = 6
  context.shadowOffsetY = 3
  context.fill()
  context.stroke()
  context.shadowColor = 'transparent'
  context.fillStyle = marker.hotel ? marker.color : '#FFFFFF'
  context.font = '700 14px PingFang SC, Microsoft YaHei, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(marker.hotel ? 'H' : (marker.label || ''), 0, -27)
  context.restore()
}
