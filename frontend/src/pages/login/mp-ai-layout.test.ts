import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/pages/login/index.vue'), 'utf8')
const styles = readFileSync(resolve(process.cwd(), 'src/pages/login/login-mini.scss'), 'utf8')
const privacyAuthorization = readFileSync(
  resolve(process.cwd(), 'src/components/WechatPrivacyAuthorization.vue'),
  'utf8',
)

function locale(name: string): Record<string, any> {
  return JSON.parse(readFileSync(resolve(process.cwd(), `src/locale/${name}`), 'utf8'))
}

describe('mini-program AI login layout', () => {
  it('uses the real YouBan logo and identifies the AI travel agent', () => {
    expect(source).toContain('class="mini-brand-logo-frame"')
    expect(source).toContain('class="mini-brand-logo"')
    expect(source).toContain('src="/static/brand-logo.png"')
    expect(existsSync(resolve(process.cwd(), 'src/static/brand-logo.png'))).toBe(true)
    expect(source).toContain('class="mini-brand-row"')
    expect(source).toMatch(/t\('login\.miniAgentLabel'\)/)
    expect(source).toContain('class="mini-agent-callout"')
    expect(source).toMatch(/t\('login\.miniAgentHint'\)/)
    expect(source).not.toContain('class="brand-mark"')
  })

  it('clips the SVG logo inside its visual frame on WeChat', () => {
    expect(styles).toMatch(/\.mini-brand-logo-frame\s*\{[\s\S]*?overflow:\s*hidden/)
    expect(styles).toMatch(/\.mini-brand-logo\s*\{[\s\S]*?width:\s*100%/)
    expect(styles).toMatch(/\.mini-brand-logo\s*\{[\s\S]*?height:\s*100%/)
  })

  it('keeps one explicit avatar authorization action', () => {
    expect(source.match(/open-type="chooseAvatar"/g)).toHaveLength(1)
    expect(source).toContain('class="wechat-login-mark"')
    expect(source).not.toContain('class="avatar-login"')
    expect(source).not.toContain('class="avatar-placeholder"')
  })

  it('mounts one login-scoped WeChat privacy gate before native avatar authorization', () => {
    expect(source).toContain('<WechatPrivacyAuthorization />')
    expect(privacyAuthorization).toContain('id="youban-privacy-agree"')
    expect(privacyAuthorization).toContain('open-type="agreePrivacyAuthorization"')
    expect(privacyAuthorization).toContain('@agreeprivacyauthorization="agree"')
  })

  it('matches the left-aligned conversational layout selected in concept B', () => {
    expect(styles).toMatch(/\.login-main\s*\{[\s\S]*?align-items:\s*flex-start/)
    expect(styles).toMatch(/\.login-main\s*\{[\s\S]*?text-align:\s*left/)
    expect(styles).toMatch(/\.mini-login-button\s*\{[\s\S]*?margin-top:\s*auto/)
    expect(styles).toMatch(/\.mini-agent-callout\s*\{[\s\S]*?border-left:\s*6rpx solid var\(--accent-primary\)/)
  })

  it.each(['product-zh.json', 'product-en.json', 'product-fr.json'])('provides concept B copy in %s', (name) => {
    const messages = locale(name).login
    expect(messages.miniAgentLabel).toBeTruthy()
    expect(messages.miniAgentHint).toBeTruthy()
    expect(messages.miniTitle).toBeTruthy()
    expect(messages.miniDescription).toBeTruthy()
    expect(messages.miniButton).toBeTruthy()
  })
})
