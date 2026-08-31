import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/pages/index/index.vue'), 'utf8')

describe('mobile planning header', () => {
  it('reserves safe-area CSS variables and removes the duplicate MP new-plan action', () => {
    expect(source).toMatch(/'--mobile-actions-right'/)
    expect(source).toMatch(/<!-- #ifndef MP-WEIXIN -->\s*<button class="icon-button"[^>]*sidebar\.newPlan[\s\S]*?<!-- #endif -->/)
  })
})
