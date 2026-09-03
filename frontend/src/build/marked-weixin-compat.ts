import type { Plugin } from 'vite'

const ALPHANUMERIC = String.raw`0-9A-Za-z\u00C0-\u02AF\u0370-\u052F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF`
const PUNCTUATION = String.raw`\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E\u2000-\u206F\u2190-\u2BFF\u3000-\u303F\uD800-\uDFFF\uFE10-\uFE6F\uFF01-\uFF65`

const REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  [String.raw`/[\p{L}\p{N}]/u`, `/[${ALPHANUMERIC}]/`],
  [String.raw`/[\p{P}\p{S}]/u`, `/[${PUNCTUATION}]/`],
  [String.raw`/[\s\p{P}\p{S}]/u`, `/[\\s${PUNCTUATION}]/`],
  [String.raw`/[^\s\p{P}\p{S}]/u`, `/[^\\s${PUNCTUATION}]/`],
  [String.raw`/(?!~)[\p{P}\p{S}]/u`, `/(?!~)[${PUNCTUATION}]/`],
  [String.raw`/(?!~)[\s\p{P}\p{S}]/u`, `/(?!~)[\\s${PUNCTUATION}]/`],
  [String.raw`/(?:[^\s\p{P}\p{S}]|~)/u`, `/(?:[^\\s${PUNCTUATION}]|~)/`],
]

export function rewriteMarkedForWeixin(code: string): string {
  const rewritten = REPLACEMENTS.reduce(
    (result, [source, replacement]) => result.replaceAll(source, replacement),
    code,
  )

  if (rewritten.includes(String.raw`\p{`)) {
    throw new Error('marked 中仍存在微信真机不支持的 Unicode 属性正则')
  }

  return rewritten
}

export function markedWeixinCompatPlugin(): Plugin {
  return {
    name: 'marked-weixin-compat',
    enforce: 'pre',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').includes('/marked/lib/marked.esm.js'))
        return null

      return rewriteMarkedForWeixin(code)
    },
  }
}
