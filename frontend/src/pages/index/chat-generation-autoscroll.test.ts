import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const homeSource = readFileSync(resolve(process.cwd(), 'src/pages/index/index.vue'), 'utf8')
const progressSource = readFileSync(resolve(process.cwd(), 'src/components/YoubanGenerationProgress.vue'), 'utf8')

describe('generation progress auto scroll', () => {
  it('re-triggers the outer chat bottom anchor when an existing progress message changes', () => {
    expect(homeSource).toContain('const chatBottomAnchors = [\'chat-bottom-a\', \'chat-bottom-b\'] as const')
    expect(homeSource).toMatch(/const followLatest = createAlternatingScrollFollower\([\s\S]*scrollTarget,[\s\S]*chatBottomAnchors/)
    expect(homeSource).toMatch(/if \(progressItem && event\.status === 'processing'\) \{[\s\S]*progressItem\.details = [^\n][\s\S]*void followLatest\(\)/)
    expect(homeSource).toContain(':id="chatBottomAnchors[0]"')
    expect(homeSource).toContain(':id="chatBottomAnchors[1]"')
  })

  it('keeps the progress timeline focused on its newest event', () => {
    expect(progressSource).toContain('const timelineTarget = ref(\'\')')
    expect(progressSource).toMatch(/const followTimeline = createAlternatingScrollFollower\([\s\S]*timelineTarget,[\s\S]*timelineBottomAnchors/)
    expect(progressSource).toMatch(/watch\([\s\S]*props\.details\.length[\s\S]*followTimeline/)
    expect(progressSource).toContain(':scroll-into-view="timelineTarget"')
    expect(progressSource).toContain(':id="timelineBottomAnchors[0]"')
    expect(progressSource).toContain(':id="timelineBottomAnchors[1]"')
  })
})
