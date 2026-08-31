import type { TripPlan } from './model'
import { t } from '@/locale'

function drawWrappedText(
  context: UniNamespace.CanvasContext,
  value: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
): number {
  const characters = [...value]
  let line = ''
  let lines = 0
  for (const character of characters) {
    const next = `${line}${character}`
    if (context.measureText(next).width > maxWidth && line) {
      context.fillText(line, x, y + lines * lineHeight)
      line = character
      lines += 1
      if (lines >= maxLines)
        return y + lines * lineHeight
    }
    else {
      line = next
    }
  }
  if (line && lines < maxLines) {
    context.fillText(line, x, y + lines * lineHeight)
    lines += 1
  }
  return y + lines * lineHeight
}

export function renderTripGuideImage(current: TripPlan, canvasId: string): Promise<string> {
  const context = uni.createCanvasContext(canvasId)
  context.setFillStyle('#faf7f2')
  context.fillRect(0, 0, 750, 1334)
  context.setFillStyle('#d97757')
  context.fillRect(0, 0, 18, 1334)
  context.setFillStyle('#3d3229')
  context.setFontSize(48)
  context.fillText(t('result.export.guideTripTitle', { city: current.city }), 58, 96)
  context.setFontSize(22)
  context.setFillStyle('#6b5d52')
  context.fillText(t('result.export.guideDateRange', {
    start: current.start_date,
    end: current.end_date,
    days: current.days.length,
  }), 60, 140)
  let y = 210
  current.days.slice(0, 8).forEach((day, index) => {
    context.setFillStyle('#c4603d')
    context.setFontSize(20)
    context.fillText(`DAY ${String(index + 1).padStart(2, '0')} · ${day.city || current.city}`, 60, y)
    y += 34
    context.setFillStyle('#3d3229')
    context.setFontSize(25)
    y = drawWrappedText(context, day.description, 60, y, 630, 34, 2) + 8
    context.setFillStyle('#6b5d52')
    context.setFontSize(18)
    const attractionText = day.attractions.map(item => item.name).join(' · ') || t('result.export.guideFreeTime')
    y = drawWrappedText(context, attractionText, 60, y, 630, 28, 2) + 30
  })
  context.setFillStyle('#6b5d52')
  context.setFontSize(18)
  context.fillText(t('app.title'), 60, 1288)
  return new Promise<string>((resolve, reject) => {
    context.draw(false, () => {
      setTimeout(() => {
        uni.canvasToTempFilePath({
          canvasId,
          width: 750,
          height: 1334,
          destWidth: 750,
          destHeight: 1334,
          fileType: 'png',
          quality: 1,
          success: result => resolve(result.tempFilePath),
          fail: reject,
        })
      }, 120)
    })
  })
}

export function saveImageToAlbum(filePath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    uni.saveImageToPhotosAlbum({ filePath, success: () => resolve(), fail: reject })
  })
}
