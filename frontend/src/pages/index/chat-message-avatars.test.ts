import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/pages/index/index.vue'), 'utf8')
const mobileStyles = source.match(/@media \(max-width: 768px\) \{([\s\S]*)<\/style>/)?.[1] || ''

describe('mobile chat identity', () => {
  it('renders floating YouBan and user avatars without duplicate speaker labels', () => {
    expect(source).toMatch(/class="message-avatar-image assistant-logo"[^>]*src="\/static\/brand-logo\.png"/)
    expect(source).toMatch(/class="message-avatar-image"[^>]*:src="userAvatar"/)
    expect(source).toContain('<view class="message-notch" />')
    expect(mobileStyles).toMatch(/\.message-row\s*\{[^}]*margin-bottom:\s*14px;[^}]*padding-top:\s*21px;/)
    expect(mobileStyles).toMatch(/\.message-avatar\s*\{[^}]*display:\s*flex;[^}]*position:\s*absolute;[^}]*width:\s*42px;[^}]*height:\s*42px;/)
    expect(mobileStyles).toMatch(/\.message-avatar\.user\s*\{[^}]*right:\s*0;[^}]*width:\s*38px;[^}]*height:\s*38px;/)
    expect(mobileStyles).toMatch(/\.message-name\s*\{[^}]*display:\s*none;/)
    expect(mobileStyles).toMatch(/\.message-column\.assistant\s*\{[^}]*max-width:\s*calc\(100vw - 74px\);[^}]*margin-left:\s*16px;/)
    expect(mobileStyles).toMatch(/\.message-column\.user\s*\{[^}]*margin-right:\s*18px;/)
    expect(mobileStyles).toMatch(/\.message-notch\s*\{[^}]*top:\s*-4px;[^}]*width:\s*8px;[^}]*height:\s*8px;[^}]*transform:\s*rotate\(45deg\);/)
    expect(mobileStyles).toMatch(/\.message-bubble\.user \.message-notch\s*\{[^}]*top:\s*-3px;[^}]*width:\s*6px;[^}]*height:\s*6px;/)
    expect(source).toMatch(/\.message-avatar\.user\s*\{[^}]*border:\s*1px solid #fff;/)
  })
})
