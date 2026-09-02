import html2canvas from 'html2canvas'
import type { TripHotel, TripPlan } from './model'
import { buildImagePdf } from './image-pdf'

export type ExportTranslator = (key: string, params?: Record<string, unknown>) => string

export interface WebGuideOptions {
  mapDataUrl?: string
  footerQrDataUrl?: string
  resolveImageUrl?: (value: string) => string
}

export function escapeExportHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function webGuideFileName(prefix: string, city: string, timestamp: number, extension: 'png' | 'pdf'): string {
  return `${prefix}_${city}_${timestamp}.${extension}`
}

function normalizeTime(value: unknown): string | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || '').trim())
  if (!match)
    return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59)
    return null
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function sectionHeading(label: string): string {
  return `<h3 style="margin:0 0 16px;font-size:18px;font-weight:700;color:#3D3229;display:flex;align-items:center;gap:10px;"><span style="flex:none;width:4px;height:18px;background:#C17F59;border-radius:2px;"></span>${escapeExportHtml(label)}</h3>`
}

function uniqueHotels(plan: TripPlan): TripHotel[] {
  const hotels = new Map<string, TripHotel>()
  for (const day of plan.days) {
    if (day.hotel?.name && !hotels.has(day.hotel.name))
      hotels.set(day.hotel.name, day.hotel)
  }
  return [...hotels.values()]
}

export function buildWebGuideHtml(plan: TripPlan, t: ExportTranslator, options: WebGuideOptions = {}): string {
  const resolveImage = options.resolveImageUrl || ((value: string) => value)
  const mealLabels: Record<string, string> = {
    breakfast: t('result.meals.breakfast'),
    lunch: t('result.meals.lunch'),
    dinner: t('result.meals.dinner'),
    snack: t('result.meals.snack'),
  }
  const blueprint = plan.blueprint
  const blueprintStages = (blueprint?.stages || []).map((stage, index) => {
    const firstDay = stage.day_indices[0]
    const lastDay = stage.day_indices.at(-1)
    const dayRange = firstDay === undefined || lastDay === undefined
      ? ''
      : t('result.blueprint.dayRange', { start: firstDay + 1, end: lastDay + 1 })
    const title = stage.title || stage.cities.join(' / ') || `${index + 1}`
    const highlights = stage.highlights.slice(0, 3)
      .map(highlight => `<span style="font-size:12px;color:#3D3229;background:#F5F0E8;padding:4px 8px;border-radius:4px;">${escapeExportHtml(highlight)}</span>`)
      .join('')
    return `<div style="flex:1;min-width:210px;border:1px solid #EBE3D8;border-top:3px solid #D97757;border-radius:6px;background:#FFFFFF;padding:16px;box-sizing:border-box;">
      <div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:8px;font-size:12px;font-weight:700;color:#C4603D;"><span>${String(index + 1).padStart(2, '0')}</span><span>${escapeExportHtml(dayRange)}</span></div>
      <h4 style="margin:0;font-size:17px;font-weight:700;color:#3D3229;line-height:1.4;">${escapeExportHtml(title)}</h4>
      ${stage.cities.length ? `<p style="margin:5px 0 0;font-size:12px;color:#6B5D52;">${escapeExportHtml(stage.cities.join(' / '))}</p>` : ''}
      ${stage.theme ? `<p style="margin:8px 0 0;font-size:13px;font-weight:600;color:#C4603D;">${escapeExportHtml(stage.theme)}</p>` : ''}
      ${stage.rationale ? `<p style="margin:8px 0 0;font-size:13px;color:#6B5D52;line-height:1.6;">${escapeExportHtml(stage.rationale)}</p>` : ''}
      ${highlights ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;">${highlights}</div>` : ''}
      ${stage.transition ? `<p style="margin:12px 0 0;padding-top:10px;border-top:1px solid #EBE3D8;font-size:12px;color:#6B5D52;line-height:1.5;">${escapeExportHtml(stage.transition)}</p>` : ''}
    </div>`
  }).join('')
  let blueprintHtml = ''
  if (blueprintStages) {
    blueprintHtml = `<div style="margin-bottom:30px;">
    <div style="margin-bottom:14px;"><p style="margin:0 0 5px;font-size:12px;font-weight:700;color:#C4603D;">${escapeExportHtml(t('result.blueprint.eyebrow'))}</p>
    <h3 style="margin:0;font-size:21px;font-weight:700;color:#3D3229;">${escapeExportHtml(blueprint?.title || t('result.blueprint.legacyTitle'))}</h3>
    ${blueprint?.summary ? `<p style="margin:8px 0 0;font-size:13px;color:#6B5D52;line-height:1.6;">${escapeExportHtml(blueprint.summary)}</p>` : ''}</div>
    <div style="display:flex;flex-wrap:wrap;gap:12px;">${blueprintStages}</div>
    ${blueprint?.logic ? `<p style="margin:14px 0 0;padding:12px 0;border-top:1px solid #EBE3D8;font-size:13px;color:#6B5D52;line-height:1.6;"><b style="color:#3D3229;">${escapeExportHtml(t('result.blueprint.planningLogic'))}</b> ${escapeExportHtml(blueprint.logic)}</p>` : ''}
    ${blueprint?.pace ? `<p style="margin:0;padding:8px 0;font-size:13px;color:#6B5D52;"><b style="color:#3D3229;">${escapeExportHtml(t('result.blueprint.pace'))}</b> ${escapeExportHtml(blueprint.pace)}</p>` : ''}
  </div>`
  }

  const daysHtml = plan.days.map((day, dayIndex) => {
    const attractions = day.attractions.map((attraction, attractionIndex) => {
      const photoUrl = attraction.image_url ? resolveImage(attraction.image_url) : ''
      const start = normalizeTime(attraction.start_time)
      const end = normalizeTime(attraction.end_time)
      const referenceTime = start ? `${start}${end ? `–${end}` : ''}` : t('result.daily.timePending')
      const image = photoUrl
        ? `<img src="${escapeExportHtml(photoUrl)}" style="width:100%;height:auto;max-height:360px;object-fit:contain;border-radius:10px;margin-bottom:10px;" crossorigin="anonymous" />`
        : `<div style="width:100%;height:110px;background:linear-gradient(135deg,#E8D5C4,#D4B59A);border-radius:10px;margin-bottom:10px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;font-weight:600;text-align:center;padding:0 12px;box-sizing:border-box;">${escapeExportHtml(attraction.name)}</div>`
      const pills = [
        referenceTime,
        t('result.export.durationLine', { duration: attraction.visit_duration || '—' }),
        ...(attraction.ticket_price ? [`¥${attraction.ticket_price}`] : []),
      ].map(value => `<span style="font-size:12px;color:#A66A47;background:#F5EDE4;padding:3px 10px;border-radius:20px;">${escapeExportHtml(value)}</span>`).join('')
      return `<div data-export-attraction-card="true" style="flex:0 0 48%;box-sizing:border-box;background:#FFFFFF;border:1px solid #EBE3D8;border-radius:14px;padding:14px;">${image}
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><span style="flex:none;width:22px;height:22px;border-radius:50%;background:#C17F59;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;">${attractionIndex + 1}</span><h4 style="margin:0;font-size:16px;font-weight:700;color:#3D3229;">${escapeExportHtml(attraction.name)}</h4></div>
        ${attraction.address ? `<p style="margin:0 0 8px;font-size:13px;color:#8B7D6B;line-height:1.5;">${escapeExportHtml(attraction.address)}</p>` : ''}
        <div style="display:flex;flex-wrap:wrap;gap:6px;">${pills}</div>
        ${attraction.description ? `<p style="margin:10px 0 0;font-size:13px;color:#6B5D4E;line-height:1.6;">${escapeExportHtml(attraction.description)}</p>` : ''}
      </div>`
    }).join('')
    const meals = day.meals.map((meal) => {
      const time = normalizeTime(meal.time) || t('result.daily.timePending')
      const type = mealLabels[meal.type || ''] || meal.type || ''
      return `<span style="background:#F5EDE4;color:#5C4B3E;font-size:12px;padding:6px 12px;border-radius:8px;"><b style="color:#A66A47;">${escapeExportHtml(time)} · ${escapeExportHtml(type)}</b> ${escapeExportHtml(meal.name || t('result.export.noMealRecommendation'))}${meal.estimated_cost ? ` · ¥${meal.estimated_cost}` : ''}</span>`
    }).join('')
    const mealsHtml = meals ? `<div data-export-meals="true" style="margin-top:14px;padding-top:12px;border-top:1px dashed #EBE3D8;"><div style="font-size:13px;font-weight:600;color:#A66A47;margin-bottom:8px;">${escapeExportHtml(t('result.export.mealTitle'))}</div><div style="display:flex;flex-wrap:wrap;gap:8px;">${meals}</div></div>` : ''
    const transferTime = normalizeTime(day.transfer_time) || t('result.daily.timePending')
    const transfer = day.is_transfer_day && day.transfer_info
      ? `<div data-export-transfer="true" style="margin-bottom:14px;padding:10px 12px;border-left:3px solid #D97757;background:#F5F0E8;font-size:13px;color:#6B5D52;line-height:1.6;"><b style="color:#3D3229;">${escapeExportHtml(transferTime)} · ${escapeExportHtml(t('result.daily.transfer'))}</b> ${escapeExportHtml(day.transfer_info)}</div>`
      : ''
    return `<div data-export-day="true" style="margin-bottom:26px;"><div data-export-day-heading="true" style="display:flex;align-items:baseline;gap:12px;margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid #EBE3D8;"><span style="font-size:20px;font-weight:700;color:#C17F59;">${escapeExportHtml(t('result.export.dayTitle', { day: dayIndex + 1 }))}</span>${day.date ? `<span style="font-size:13px;color:#8B7D6B;">${escapeExportHtml(day.date)}</span>` : ''}</div>${transfer}<div data-export-attractions="true" style="display:flex;flex-wrap:wrap;gap:14px;">${attractions}</div>${mealsHtml}</div>`
  }).join('')

  let budgetHtml = ''
  if (plan.budget) {
    const budget = plan.budget
    const card = (label: string, amount: number) => `<div style="flex:1;min-width:110px;background:#FFFFFF;border:1px solid #EBE3D8;border-radius:12px;padding:14px;text-align:center;"><div style="font-size:12px;color:#8B7D6B;margin-bottom:6px;">${escapeExportHtml(label)}</div><div style="font-size:19px;font-weight:700;color:#3D3229;">¥${amount}</div></div>`
    budgetHtml = `<div style="margin-bottom:28px;">${sectionHeading(t('result.budget.title'))}<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:12px;">${card(t('result.budget.attraction'), budget.total_attractions || 0)}${card(t('result.budget.hotel'), budget.total_hotels || 0)}${card(t('result.budget.meal'), budget.total_meals || 0)}${card(t('result.budget.transport'), budget.total_transportation || 0)}${budget.total_other ? card(t('result.budget.other'), budget.total_other) : ''}</div><div style="background:linear-gradient(135deg,#C17F59,#A66A47);color:#fff;padding:16px 22px;border-radius:14px;display:flex;justify-content:space-between;align-items:center;"><span style="font-size:15px;">${escapeExportHtml(t('result.budget.total'))}</span><span style="font-size:26px;font-weight:700;">¥${budget.total || 0}</span></div></div>`
  }
  const mapHtml = options.mapDataUrl ? `<div style="margin-bottom:28px;">${sectionHeading(t('result.side.map'))}<img src="${escapeExportHtml(options.mapDataUrl)}" style="width:100%;height:auto;border-radius:14px;border:1px solid #EBE3D8;" /></div>` : ''
  const hotels = uniqueHotels(plan)
  const hotelHtml = hotels.length ? `<div style="margin-bottom:28px;">${sectionHeading(t('result.hotelTitle'))}${hotels.map(hotel => `<div style="background:#FFFFFF;border:1px solid #EBE3D8;border-radius:12px;padding:14px 16px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:12px;"><div style="min-width:0;"><b style="color:#3D3229;font-size:15px;">${escapeExportHtml(hotel.name || t('result.export.hotelFallback'))}</b>${hotel.address ? `<p style="margin:4px 0 0;font-size:12px;color:#8B7D6B;">${escapeExportHtml(hotel.address)}</p>` : ''}</div>${hotel.estimated_cost ? `<span style="flex:none;color:#C17F59;font-weight:700;font-size:16px;white-space:nowrap;">¥${hotel.estimated_cost}<span style="font-size:12px;color:#8B7D6B;font-weight:400;">${escapeExportHtml(t('result.export.perNight'))}</span></span>` : ''}</div>`).join('')}</div>` : ''
  const weatherHtml = plan.weather_info.length ? `<div style="margin-bottom:28px;">${sectionHeading(t('result.export.weatherTitle'))}<div style="display:flex;flex-wrap:wrap;gap:10px;">${plan.weather_info.map(weather => `<div style="flex:1;min-width:150px;background:#FFFFFF;border:1px solid #EBE3D8;border-radius:12px;padding:14px;"><div style="text-align:center;color:#C17F59;font-weight:700;font-size:14px;margin-bottom:12px;">${escapeExportHtml(weather.date)}</div><div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;margin-bottom:8px;"><span style="color:#8B7D6B;">${escapeExportHtml(t('result.export.daytime'))}</span><span style="color:#3D3229;font-weight:600;">${escapeExportHtml(weather.day_weather)} ${weather.day_temp ?? ''}°C</span></div><div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;"><span style="color:#8B7D6B;">${escapeExportHtml(t('result.export.nighttime'))}</span><span style="color:#3D3229;font-weight:600;">${escapeExportHtml(weather.night_weather)} ${weather.night_temp ?? ''}°C</span></div><div style="border-top:1px solid #EBE3D8;margin-top:10px;padding-top:8px;text-align:center;font-size:12px;color:#8B7D6B;">${escapeExportHtml(weather.wind_direction)} ${escapeExportHtml(weather.wind_power)}</div></div>`).join('')}</div></div>` : ''
  const footerImage = options.footerQrDataUrl ? `<img src="${escapeExportHtml(options.footerQrDataUrl)}" style="width:92px;height:92px;background:#fff;border:1px solid #EBE3D8;border-radius:10px;padding:6px;box-sizing:border-box;" />` : ''
  const footer = `<div data-export-final-footer="true" style="text-align:center;padding:28px 16px 8px;margin-top:4px;border-top:1px solid #EBE3D8;">${footerImage}<div style="font-size:14px;color:#C17F59;font-weight:700;letter-spacing:2px;margin-top:12px;">游伴</div><div style="font-size:11px;color:#B8A99A;margin-top:6px;">${escapeExportHtml(t('result.export.footer'))}</div></div>`

  return `<div data-web-guide-root="true" style="width:800px;padding:36px 30px;background:#FAF7F2;font-family:'PingFang SC','Microsoft YaHei','Segoe UI',sans-serif;color:#3D3229;box-sizing:content-box;"><div style="text-align:center;margin-bottom:30px;"><h1 style="margin:0;font-size:30px;font-weight:700;color:#3D3229;letter-spacing:1px;">${escapeExportHtml(t('result.export.title', { city: plan.city }))}</h1><div style="width:44px;height:3px;background:#C17F59;border-radius:2px;margin:14px auto;"></div><p style="margin:0;font-size:14px;color:#8B7D6B;">${escapeExportHtml(t('result.export.subtitle', { start: plan.start_date, end: plan.end_date, days: plan.days.length }))}</p>${plan.overall_suggestions ? `<p style="margin:16px auto 0;max-width:580px;font-size:13px;color:#8B7D6B;line-height:1.7;">${escapeExportHtml(plan.overall_suggestions)}</p>` : ''}</div>${blueprintHtml}${daysHtml}${mapHtml}${hotelHtml}${weatherHtml}${budgetHtml}${footer}</div>`
}

function createOffscreenMount(html: string): HTMLDivElement {
  const mount = document.createElement('div')
  mount.style.cssText = 'position:fixed;left:-10000px;top:0;z-index:-1;pointer-events:none;'
  mount.innerHTML = html
  document.body.appendChild(mount)
  return mount
}

export async function waitForExportImages(root: ParentNode): Promise<void> {
  await Promise.all([...root.querySelectorAll('img')].map(image => new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled)
        return
      settled = true
      image.removeEventListener('load', finish)
      image.removeEventListener('error', finish)
      resolve()
    }
    if (image.complete) {
      finish()
      return
    }
    image.addEventListener('load', finish, { once: true })
    image.addEventListener('error', finish, { once: true })
    if (image.complete)
      finish()
  })))
}

export async function renderWebGuidePng(html: string): Promise<Blob> {
  const mount = createOffscreenMount(html)
  try {
    await waitForExportImages(mount)
    const canvas = await html2canvas(mount.firstElementChild as HTMLElement, {
      backgroundColor: '#FAF7F2',
      scale: 2,
      logging: false,
      useCORS: true,
      allowTaint: true,
    })
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('PNG render failed')),
      'image/png',
    ))
  }
  finally {
    mount.remove()
  }
}

async function canvasToJpegBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
    value => value ? resolve(value) : reject(new Error('PDF page render failed')),
    'image/jpeg',
    0.9,
  ))
  return new Uint8Array(await blob.arrayBuffer())
}

const PDF_PAGE_WIDTH = 794
const PDF_PAGE_HEIGHT = 1123
const PDF_PAGE_PADDING_X = 30
const PDF_PAGE_PADDING_TOP = 36
const PDF_PAGE_PADDING_BOTTOM = 56
const PDF_CONTENT_HEIGHT = PDF_PAGE_HEIGHT - PDF_PAGE_PADDING_TOP - PDF_PAGE_PADDING_BOTTOM
const PDF_FIT_SAFETY = 8
const PDF_MIN_READABLE_SCALE = 0.95
const PDF_MIN_FINAL_QR_SCALE = 0.76

interface PdfPageElement {
  page: HTMLDivElement
  content: HTMLDivElement
  flow: HTMLDivElement
  footer: HTMLDivElement
}

interface PdfFlowBlock {
  element: HTMLElement
  continuationHeading?: HTMLElement
  finalQr: boolean
}

function createPdfPage(mount: HTMLElement): PdfPageElement {
  const page = document.createElement('div')
  page.style.cssText = `width:${PDF_PAGE_WIDTH}px;height:${PDF_PAGE_HEIGHT}px;box-sizing:border-box;padding:${PDF_PAGE_PADDING_TOP}px ${PDF_PAGE_PADDING_X}px ${PDF_PAGE_PADDING_BOTTOM}px;position:relative;overflow:hidden;background:#FAF7F2;font-family:'PingFang SC','Microsoft YaHei','Segoe UI',sans-serif;color:#3D3229;`
  const content = document.createElement('div')
  content.style.cssText = `height:${PDF_CONTENT_HEIGHT}px;overflow:hidden;box-sizing:border-box;`
  const flow = document.createElement('div')
  flow.style.cssText = 'width:100%;transform-origin:top left;'
  content.appendChild(flow)
  page.appendChild(content)
  const footer = document.createElement('div')
  footer.style.cssText = 'position:absolute;left:30px;right:30px;bottom:18px;display:flex;align-items:center;justify-content:space-between;border-top:1px solid #EBE3D8;padding-top:8px;font-size:10px;color:#9B8C7D;'
  page.appendChild(footer)
  mount.appendChild(page)
  return { page, content, flow, footer }
}

function fitPdfFlow(target: PdfPageElement): number {
  target.flow.style.transform = 'none'
  target.flow.style.width = '100%'
  const naturalHeight = Math.max(target.flow.scrollHeight, target.flow.getBoundingClientRect().height)
  const scale = naturalHeight > 0 ? Math.min(1, (PDF_CONTENT_HEIGHT - PDF_FIT_SAFETY) / naturalHeight) : 1
  if (scale < 1)
    target.flow.style.transform = `scale(${scale})`
  return scale
}

export function shouldStartNewPdfPage(candidateScale: number, currentBlockCount: number, finalQr: boolean): boolean {
  if (currentBlockCount <= 1)
    return false
  return candidateScale < (finalQr ? PDF_MIN_FINAL_QR_SCALE : PDF_MIN_READABLE_SCALE)
}

function continuationHeading(heading: HTMLElement, t: ExportTranslator): HTMLElement {
  const continuation = heading.cloneNode(true) as HTMLElement
  continuation.style.marginBottom = '12px'
  const marker = document.createElement('span')
  marker.textContent = t('result.export.continued')
  marker.style.cssText = 'margin-left:auto;font-size:11px;font-weight:600;color:#8B7D6B;'
  continuation.appendChild(marker)
  return continuation
}

function buildPdfBlocks(source: HTMLElement, t: ExportTranslator): PdfFlowBlock[] {
  const blocks: PdfFlowBlock[] = []
  for (const sourceBlock of [...source.children]) {
    if (sourceBlock.getAttribute('data-export-day') !== 'true') {
      blocks.push({
        element: sourceBlock.cloneNode(true) as HTMLElement,
        finalQr: sourceBlock.getAttribute('data-export-final-footer') === 'true',
      })
      continue
    }
    const heading = sourceBlock.querySelector<HTMLElement>('[data-export-day-heading="true"]')
    const transfer = sourceBlock.querySelector<HTMLElement>('[data-export-transfer="true"]')
    const attractions = sourceBlock.querySelector<HTMLElement>('[data-export-attractions="true"]')
    const cards = attractions ? [...attractions.querySelectorAll<HTMLElement>('[data-export-attraction-card="true"]')] : []
    const meals = sourceBlock.querySelector<HTMLElement>('[data-export-meals="true"]')
    if (!heading) {
      blocks.push({ element: sourceBlock.cloneNode(true) as HTMLElement, finalQr: false })
      continue
    }
    const rowCount = Math.max(1, Math.ceil(cards.length / 2))
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const fragment = document.createElement('div')
      fragment.style.marginBottom = '18px'
      if (rowIndex === 0) {
        fragment.appendChild(heading.cloneNode(true))
        if (transfer)
          fragment.appendChild(transfer.cloneNode(true))
      }
      if (attractions && cards.length) {
        const row = attractions.cloneNode(false) as HTMLElement
        cards.slice(rowIndex * 2, rowIndex * 2 + 2).forEach(card => row.appendChild(card.cloneNode(true)))
        fragment.appendChild(row)
      }
      blocks.push({
        element: fragment,
        continuationHeading: rowIndex ? continuationHeading(heading, t) : undefined,
        finalQr: false,
      })
    }
    if (meals) {
      const fragment = document.createElement('div')
      fragment.style.marginBottom = '18px'
      fragment.appendChild(meals.cloneNode(true))
      blocks.push({
        element: fragment,
        continuationHeading: continuationHeading(heading, t),
        finalQr: false,
      })
    }
  }
  return blocks
}

async function paginatePdf(source: HTMLElement, mount: HTMLElement, t: ExportTranslator): Promise<HTMLDivElement[]> {
  const pages: PdfPageElement[] = []
  let current = createPdfPage(mount)
  pages.push(current)
  for (const block of buildPdfBlocks(source, t)) {
    current.flow.style.transform = 'none'
    current.flow.style.width = '100%'
    current.flow.appendChild(block.element)
    await waitForExportImages(block.element)
    const candidateHeight = Math.max(current.flow.scrollHeight, current.flow.getBoundingClientRect().height)
    const candidateScale = candidateHeight > 0 ? Math.min(1, (PDF_CONTENT_HEIGHT - PDF_FIT_SAFETY) / candidateHeight) : 1
    if (shouldStartNewPdfPage(candidateScale, current.flow.childElementCount, block.finalQr)) {
      current.flow.removeChild(block.element)
      fitPdfFlow(current)
      current = createPdfPage(mount)
      pages.push(current)
      if (block.continuationHeading)
        current.flow.appendChild(block.continuationHeading)
      current.flow.appendChild(block.element)
    }
    fitPdfFlow(current)
  }
  pages.forEach((page, index) => {
    page.footer.innerHTML = `<span>${escapeExportHtml(t('result.export.pdfFooter'))}</span><span>${escapeExportHtml(t('result.export.pageNumber', { current: index + 1, total: pages.length }))}</span>`
  })
  await waitForExportImages(mount)
  return pages.map(item => item.page)
}

export async function renderWebGuidePdf(html: string, t: ExportTranslator): Promise<Uint8Array> {
  const sourceMount = createOffscreenMount(html)
  const pageMount = createOffscreenMount('')
  try {
    const source = sourceMount.firstElementChild
    if (!(source instanceof HTMLElement))
      throw new Error('PDF source is unavailable')
    source.style.width = `${PDF_PAGE_WIDTH - PDF_PAGE_PADDING_X * 2}px`
    source.style.padding = '0'
    source.style.background = 'transparent'
    source.querySelectorAll<HTMLElement>('[data-export-day="true"]').forEach((day) => {
      day.style.marginBottom = '18px'
      day.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
        image.style.maxHeight = '170px'
      })
    })
    await waitForExportImages(source)
    pageMount.style.width = `${PDF_PAGE_WIDTH}px`
    const pageElements = await paginatePdf(source, pageMount, t)
    const pages = []
    for (const page of pageElements) {
      const canvas = await html2canvas(page, {
        backgroundColor: '#FAF7F2',
        scale: 1.5,
        logging: false,
        useCORS: true,
        allowTaint: false,
      })
      pages.push({ jpegBytes: await canvasToJpegBytes(canvas), width: canvas.width, height: canvas.height })
    }
    return buildImagePdf(pages)
  }
  finally {
    sourceMount.remove()
    pageMount.remove()
  }
}

export function downloadWebGuide(data: Blob | Uint8Array, filename: string, type = 'application/octet-stream'): void {
  const blob = data instanceof Blob ? data : new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.download = filename
  link.href = url
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  window.setTimeout(() => {
    link.remove()
    URL.revokeObjectURL(url)
  }, 1000)
}
