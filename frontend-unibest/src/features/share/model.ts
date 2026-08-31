export function buildPlanShareUrl(origin: string, basePath: string, shareCode: string): string {
  const normalizedOrigin = origin.replace(/\/$/, '')
  const normalizedBase = `/${basePath}`.replace(/\/{2,}/g, '/').replace(/\/$/, '')
  return `${normalizedOrigin}${normalizedBase}/#/pages/share/index?code=${encodeURIComponent(shareCode)}`
}

export function shareQrFileName(shareCode: string): string {
  return `tripstar_share_${shareCode}.png`
}

export function shareActionLabel(label: string): string {
  return /^[\u3400-\u9FFF]{2}$/.test(label) ? `${label[0]} ${label[1]}` : label
}
