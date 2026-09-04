export function formatResultDate(
  date: Date,
  locale: string,
  options: Intl.DateTimeFormatOptions,
  fallback: string,
): string {
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function')
      return new Intl.DateTimeFormat(locale, options).format(date)
  }
  catch {}
  return fallback
}

export function formatResultNumber(value: number, locale: string, maximumFractionDigits: number): string {
  const number = Number(value)
  if (!Number.isFinite(number))
    return '0'
  try {
    return number.toLocaleString(locale, { maximumFractionDigits })
  }
  catch {
    return maximumFractionDigits > 0
      ? String(Number(number.toFixed(maximumFractionDigits)))
      : String(Math.round(number))
  }
}
