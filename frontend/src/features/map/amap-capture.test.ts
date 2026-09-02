import { describe, expect, it, vi } from 'vitest'
import {
  amapExportDimensions,
  buildAmapStaticMapUrl,
  drawAmapExportPin,
  loadAmapDataUrl,
  loadAmapStaticMapDataUrl,
  readAmapCanvasDataUrl,
  waitForAmapCanvasDataUrl,
  waitForAmapOverlayWindow,
  waitForAmapVisibilityFrame,
} from './amap-capture'

describe('readAmapCanvasDataUrl', () => {
  it('builds an auto-fit AMap static fallback with markers and day paths', () => {
    const url = new URL(buildAmapStaticMapUrl({
      key: 'test-key',
      width: 936,
      height: 713,
      markers: [
        { longitude: 121.49, latitude: 31.24, color: '#D97757', label: '1' },
        { longitude: 120.15, latitude: 30.27, color: '#57A773', label: '2' },
      ],
      paths: [{
        color: '#D97757',
        points: [[121.49, 31.24], [120.15, 30.27]],
      }],
    }))

    expect(`${url.origin}${url.pathname}`).toBe('https://restapi.amap.com/v3/staticmap')
    expect(url.searchParams.get('key')).toBe('test-key')
    expect(url.searchParams.get('size')).toBe('936*713')
    expect(url.searchParams.get('markers')).toContain('mid,0xD97757,1:121.490000,31.240000')
    expect(url.searchParams.get('paths')).toBe('5,0xD97757,0.85,,:121.490000,31.240000;120.150000,30.270000')
    expect(url.searchParams.has('location')).toBe(false)
    expect(url.searchParams.has('zoom')).toBe(false)
  })

  it('loads an AMap static image as a data URL for the export renderer', async () => {
    const fetcher = vi.fn(async () => new Response(
      new Blob(['map-image'], { type: 'image/png' }),
      { headers: { 'content-type': 'image/png' } },
    )) as unknown as typeof fetch

    const dataUrl = await loadAmapStaticMapDataUrl('https://example.test/static-map', fetcher)

    expect(dataUrl).toMatch(/^data:image\/png;base64,/)
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('keeps export snapshots at the native AMap canvas resolution', () => {
    expect(amapExportDimensions(936, 713)).toEqual({ width: 936, height: 713, scale: 1 })
  })

  it('uses the rendered AMap canvas as the stable export source', () => {
    const container = document.createElement('div')
    const canvas = document.createElement('canvas')
    canvas.className = 'amap-layer'
    canvas.toDataURL = vi.fn(() => 'data:image/png;base64,map-frame')
    container.appendChild(canvas)

    expect(readAmapCanvasDataUrl(container)).toBe('data:image/png;base64,map-frame')
  })

  it('returns an empty value when the map canvas cannot be read', () => {
    expect(readAmapCanvasDataUrl(document.createElement('div'))).toBe('')
  })

  it('waits past blank WebGL frames until AMap has rendered map detail', async () => {
    vi.useFakeTimers()
    try {
      const container = document.createElement('div')
      const canvas = document.createElement('canvas')
      canvas.className = 'amap-layer'
      const blankFrame = `data:image/png;base64,${'x'.repeat(100)}`
      const renderedFrame = `data:image/png;base64,${'x'.repeat(5000)}`
      canvas.toDataURL = vi.fn()
        .mockReturnValueOnce(blankFrame)
        .mockReturnValueOnce(blankFrame)
        .mockReturnValue(renderedFrame)
      container.appendChild(canvas)

      const pending = waitForAmapCanvasDataUrl(container, { attempts: 3, intervalMs: 10 })
      await vi.advanceTimersByTimeAsync(20)

      expect(await pending).toBe(renderedFrame)
      expect(canvas.toDataURL).toHaveBeenCalledTimes(3)
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('keeps waiting beyond five seconds for a slow first AMap frame', async () => {
    vi.useFakeTimers()
    try {
      const container = document.createElement('div')
      const canvas = document.createElement('canvas')
      canvas.className = 'amap-layer'
      const blankFrame = `data:image/png;base64,${'x'.repeat(100)}`
      const renderedFrame = `data:image/png;base64,${'x'.repeat(5000)}`
      canvas.toDataURL = vi.fn()
      for (let attempt = 0; attempt < 20; attempt += 1)
        vi.mocked(canvas.toDataURL).mockReturnValueOnce(blankFrame)
      vi.mocked(canvas.toDataURL).mockReturnValue(renderedFrame)
      container.appendChild(canvas)

      const pending = waitForAmapCanvasDataUrl(container)
      await vi.advanceTimersByTimeAsync(5000)

      expect(await pending).toBe(renderedFrame)
      expect(canvas.toDataURL).toHaveBeenCalledTimes(21)
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('rejects a low-detail frame when the render deadline expires', async () => {
    vi.useFakeTimers()
    try {
      const container = document.createElement('div')
      const canvas = document.createElement('canvas')
      canvas.className = 'amap-layer'
      canvas.toDataURL = vi.fn(() => `data:image/png;base64,${'x'.repeat(100)}`)
      container.appendChild(canvas)

      const pending = waitForAmapCanvasDataUrl(container, { attempts: 2, intervalMs: 10 })
      await vi.advanceTimersByTimeAsync(10)

      expect(await pending).toBe('')
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('decodes the captured data URL into an immutable image before composition', async () => {
    const image = {} as HTMLImageElement
    Object.defineProperty(image, 'src', {
      get: () => '',
      set() {
        image.onload?.(new Event('load'))
      },
    })

    await expect(loadAmapDataUrl('data:image/png;base64,frame', () => image)).resolves.toBe(image)
  })

  it('stops waiting for slow route overlays at the export deadline', async () => {
    vi.useFakeTimers()
    try {
      const neverFinishes = new Promise<void>(() => {})
      const pending = waitForAmapOverlayWindow(neverFinishes, 50)

      await vi.advanceTimersByTimeAsync(50)

      await expect(pending).resolves.toBeUndefined()
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('draws a numbered export pin at the projected map coordinate', () => {
    const context = {
      beginPath: vi.fn(),
      bezierCurveTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      fillText: vi.fn(),
      moveTo: vi.fn(),
      restore: vi.fn(),
      save: vi.fn(),
      scale: vi.fn(),
      stroke: vi.fn(),
      translate: vi.fn(),
    } as unknown as CanvasRenderingContext2D

    drawAmapExportPin(context, { x: 100, y: 120, color: '#D97757', label: '2' }, 1.5)

    expect(context.translate).toHaveBeenCalledWith(150, 180)
    expect(context.fillText).toHaveBeenCalledWith('2', 0, -27)
    expect(context.restore).toHaveBeenCalledOnce()
  })

  it('waits for two paint frames after the map section becomes active', async () => {
    const callbacks: FrameRequestCallback[] = []
    const pending = waitForAmapVisibilityFrame((callback) => {
      callbacks.push(callback)
      return callbacks.length
    })

    expect(callbacks).toHaveLength(1)
    callbacks.shift()?.(0)
    expect(callbacks).toHaveLength(1)
    callbacks.shift()?.(16)

    await expect(pending).resolves.toBeUndefined()
  })
})
