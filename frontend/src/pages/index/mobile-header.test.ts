import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/pages/index/index.vue'), 'utf8')

describe('mobile planning header', () => {
  it('reserves safe-area CSS variables and removes the duplicate MP new-plan action', () => {
    expect(source).toMatch(/'--mobile-actions-right'/)
    expect(source).toMatch(/<!-- #ifndef MP-WEIXIN -->\s*<button class="icon-button"[^>]*sidebar\.newPlan[\s\S]*?<!-- #endif -->/)
  })

  it('exposes a stable switch-user action in the account menu', () => {
    expect(source).toMatch(/class="mobile-switch-user-action"[^>]*@click="logout"/)
  })

  it('keeps the mobile avatar trigger background transparent', () => {
    expect(source).toMatch(/\.mobile-account-trigger\s*\{[^}]*background:\s*transparent;/)
  })

  it('separates the H5 account footer from the compact Mini Program preferences', () => {
    const sidebarTools = source.match(/<view class="sidebar-tools">([\s\S]*?)<\/aside>/)?.[1] || ''
    expect(sidebarTools).toMatch(/<!-- #ifdef MP-WEIXIN -->[\s\S]*class="sidebar-preferences compact"[\s\S]*i-carbon-language[\s\S]*i-carbon-sun[\s\S]*<!-- #endif -->/)
    expect(sidebarTools).toMatch(/<!-- #ifdef H5 -->[\s\S]*class="sidebar-user"[\s\S]*account\.logout[\s\S]*<!-- #endif -->/)
  })
})
