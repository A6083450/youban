import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import en from './product-en.json'
import fr from './product-fr.json'
import zh from './product-zh.json'

const standaloneAi = /(^|[^A-Za-z])(AI|IA)([^A-Za-z]|$)/

describe('product branding', () => {
  it('does not expose AI wording in product copy or app branding', () => {
    const root = resolve(import.meta.dirname, '../..')
    const sources = [
      JSON.stringify({ en, fr, zh }),
      readFileSync(resolve(root, 'env/.env'), 'utf8'),
      readFileSync(resolve(root, 'src/manifest.json'), 'utf8'),
      readFileSync(resolve(root, 'src/components/login/WechatLoginSheet.vue'), 'utf8'),
    ]

    for (const source of sources)
      expect(source).not.toMatch(standaloneAi)
  })
})
