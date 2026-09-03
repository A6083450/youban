import { describe, expect, it } from 'vitest'
import { rewriteMarkedForWeixin } from './build/marked-weixin-compat'

const MARKED_UNICODE_RULES = String.raw`
unicodeAlphaNumeric:/[\p{L}\p{N}]/u,
punctuation:/[\p{P}\p{S}]/u,
punctSpace:/[\s\p{P}\p{S}]/u,
notPunctSpace:/[^\s\p{P}\p{S}]/u,
punctuationNoTilde:/(?!~)[\p{P}\p{S}]/u,
punctSpaceNoTilde:/(?!~)[\s\p{P}\p{S}]/u,
notPunctSpaceOrTilde:/(?:[^\s\p{P}\p{S}]|~)/u
`

describe('marked 微信真机兼容转换', () => {
  it('移除微信真机不支持的 Unicode 属性正则', () => {
    const result = rewriteMarkedForWeixin(MARKED_UNICODE_RULES)

    expect(result).not.toContain(String.raw`\p{`)
    expect(result).toContain(String.raw`\u3400-\u9FFF`)
  })
})
