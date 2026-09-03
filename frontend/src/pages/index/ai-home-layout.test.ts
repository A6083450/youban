import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/pages/index/index.vue'), 'utf8')

function locale(name: string): Record<string, any> {
  return JSON.parse(readFileSync(resolve(process.cwd(), `src/locale/${name}`), 'utf8'))
}

describe('ai planning home', () => {
  it('presents the empty state as an AI travel agent', () => {
    expect(source).toContain('class="ai-agent-intro"')
    expect(source).toMatch(/t\('chatHome\.agentLabel'\)/)
    expect(source).toMatch(/t\('chatHome\.agentTitle'\)/)
    expect(source).toMatch(/t\('chatHome\.agentDescription'\)/)
  })

  it('uses one recommendation instead of a recommendation list', () => {
    expect(source).toContain('pickSuggestionBatch(suggestions.value, 1)')
    expect(source).toContain('visibleSuggestions[0]')
    expect(source).not.toMatch(/v-for="suggestion in visibleSuggestions"/)
    expect(source).toMatch(/t\('chatHome\.inspiration'\)/)
  })

  it('uses a dedicated wide home input with vertically centered copy', () => {
    expect(source).toMatch(/'home-composer': !hasMessages/)
    expect(source).toContain('class="home-prompt-input"')
    expect(source).toMatch(/t\('composer\.homePlaceholder'\)/)
    expect(source).toMatch(/\.composer\.home-composer\s*\{[\s\S]*?height:\s*88px/)
    expect(source).toMatch(/\.home-prompt-input\s*\{[\s\S]*?height:\s*100%/)
    expect(source).toMatch(/\.home-prompt-input\s*\{[\s\S]*?line-height:\s*88px/)
  })

  it('keeps the recommendation refresh as an icon-only action', () => {
    expect(source).toMatch(/class="suggestion-refresh"[\s\S]*?:aria-label="t\('chatHome\.refreshSuggestions'\)"/)
    expect(source).toMatch(/class="suggestion-refresh"[\s\S]*?<wd-icon name="refresh"/)
    expect(source).not.toContain('↻ {{ t(\'chatHome.refreshSuggestions\') }}')
  })

  it('requires login only when the user sends a prompt', () => {
    expect(source).toMatch(/async function sendMessage[\s\S]*if \(!auth\.ready\) \{[\s\S]*pendingLoginPrompt\.value = text[\s\S]*loginSheetOpen\.value = true[\s\S]*return/)
    expect(source).toMatch(/async function handleLoginSuccess[\s\S]*sendMessage\(text\)/)
    expect(source).toContain('<WechatLoginSheet')
    expect(source).toContain('@authenticated="handleLoginSuccess"')
    expect(source).toMatch(/onLoad[\s\S]*if \(auth\.ready\) \{[\s\S]*loadRecords/)
  })

  it.each(['product-zh.json', 'product-en.json', 'product-fr.json'])('provides concise agent copy in %s', (name) => {
    const messages = locale(name)
    expect(messages.chatHome.agentLabel).toBeTruthy()
    expect(messages.chatHome.agentTitle).toBeTruthy()
    expect(messages.chatHome.agentDescription).toBeTruthy()
    expect(messages.chatHome.inspiration).toBeTruthy()
    expect(messages.composer.homePlaceholder).toBeTruthy()
  })
})
