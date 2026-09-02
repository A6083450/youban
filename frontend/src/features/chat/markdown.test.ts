import { describe, expect, it } from 'vitest'
import { renderChatMarkdown } from './markdown'

describe('chat markdown rendering', () => {
  it('renders a GFM comparison table as HTML', () => {
    const markdown = [
      '好的，我把几个方案放在一起对比：',
      '',
      '| 方案 | 特点 | 建议天数 |',
      '| --- | --- | --- |',
      '| 1. 乌兰布统草原 | 经典草原风光，适合摄影和骑马 | 5 |',
      '| 2. 锡林郭勒草原 | 自驾路况好 | 5 |',
      '',
      '回复序号即可。',
    ].join('\n')

    const html = renderChatMarkdown(markdown)

    expect(html).toContain('<table>')
    expect(html).toContain('<th>方案</th>')
    expect(html).toContain('<td>1. 乌兰布统草原</td>')
    expect(html).toContain('<td>经典草原风光，适合摄影和骑马</td>')
    expect(html).not.toContain('| --- |')
  })

  it('escapes raw HTML emitted inside an assistant reply', () => {
    const html = renderChatMarkdown('<script>alert("x")</script>')

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
