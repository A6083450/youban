interface RuntimeMessageContext {
  named: (key: string) => unknown
  list: (index: number) => unknown
  interpolate: (value: unknown) => unknown
  normalize: (values: unknown[]) => unknown
}

interface MessageToken {
  literal?: string
  placeholder?: string
}

const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

function namedValue(context: RuntimeMessageContext, path: string): unknown {
  const [first, ...segments] = path.split('.')
  if (!first || FORBIDDEN_PATH_SEGMENTS.has(first))
    return undefined
  let value = context.named(first)
  for (const segment of segments) {
    if (!segment || FORBIDDEN_PATH_SEGMENTS.has(segment) || typeof value !== 'object' || value === null)
      return undefined
    value = (value as Record<string, unknown>)[segment]
  }
  return value
}

function tokenizeMessage(source: string): MessageToken[] {
  const tokens: MessageToken[] = []
  const placeholderPattern = /\{([^{}]+)\}/g
  let start = 0
  let match = placeholderPattern.exec(source)
  while (match) {
    if (match.index > start)
      tokens.push({ literal: source.slice(start, match.index) })
    tokens.push({ placeholder: match[1] })
    start = match.index + match[0].length
    match = placeholderPattern.exec(source)
  }
  if (start < source.length)
    tokens.push({ literal: source.slice(start) })
  return tokens
}

export function compileRuntimeMessage(source: string) {
  const tokens = tokenizeMessage(source)
  return (context: RuntimeMessageContext): unknown => context.normalize(tokens.map((token) => {
    if (token.literal !== undefined)
      return token.literal
    const key = token.placeholder || ''
    const value = /^\d+$/.test(key)
      ? context.list(Number(key))
      : namedValue(context, key)
    return value === undefined ? `{${key}}` : context.interpolate(value)
  }))
}

export function formatRuntimeMessage(source: string, values?: Record<string, unknown> | unknown[]): string {
  const named = Array.isArray(values) ? {} : values || {}
  const list = Array.isArray(values) ? values : []
  return String(compileRuntimeMessage(source)({
    named: key => named[key],
    list: index => list[index],
    interpolate: value => String(value),
    normalize: parts => parts.join(''),
  }))
}
