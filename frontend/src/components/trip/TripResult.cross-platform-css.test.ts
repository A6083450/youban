import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/components/trip/TripResult.vue'), 'utf8')

describe('trip result cross-platform CSS', () => {
  it('keeps container queries inside the H5 compilation guard', () => {
    expect(source).toMatch(/\/\* #ifdef H5 \*\/[\s\S]*container-type: inline-size;[\s\S]*@container \(max-width: 640px\)[\s\S]*\/\* #endif \*\//)
  })

  it('avoids selectors unsupported by WeChat WXSS', () => {
    expect(source).not.toContain(':not(')
  })

  it('restores legacy photo-backed overview presentation', () => {
    expect(source).toContain('attractionPhotos?: Record<string, string>')
    expect(source).toContain('t(\'result.graph.journeyTitle\'')
    expect(source).toContain('const journeyHeroStyle = computed')
    expect(source).toMatch(/class="journey-pin-image"[\s\S]*mode="aspectFill"/)
    expect(source).toContain(':attraction-photos="attractionPhotos"')
  })

  it('shows daily summaries instead of a false empty state when a plan has no attraction POIs', () => {
    expect(source).toContain('v-else-if="plan.days.length" class="overview-day-list"')
    expect(source).toContain('class="overview-day-card"')
    expect(source).toContain('class="overview-day-description"')
    expect(source).toMatch(/v-else class="empty-section"/)
  })

  it('does not expose the internal plan identifier in the customer-facing result', () => {
    expect(source).not.toContain('Plan ID:')
  })

  it('restores both legacy long-trip pagers instead of clipping overflow', () => {
    expect(source).toContain('buildFixedItemPageTargets')
    expect(source).toContain('class="journey-highlights-header"')
    expect(source).toContain('class="journey-highlights-pager"')
    expect(source).toContain(':scroll-x="journeyPageCount > 1"')
    expect(source).toContain(':scroll-x="highlightPageCount > 1"')
    expect(source).toContain(':scroll-left="journeyScrollLeft"')
    expect(source).toContain(':scroll-left="highlightScrollLeft"')
    expect(source).toContain('class="journey-page-tail journey-page-tail-track"')
    expect(source).toContain('class="journey-page-tail journey-page-tail-highlights"')
  })

  it('uses the legacy theme-aware hero and fixed highlight media proportions', () => {
    expect(source).toContain('var(--journey-hero-overlay-start)')
    expect(source).toMatch(/\.journey-hero \{[\s\S]*min-height: 106px;/)
    expect(source).toMatch(/\.journey-track \{[\s\S]*height: 183px;/)
    expect(source).toMatch(/\.journey-highlight-media \{[\s\S]*height: 100px;/)
    expect(source).toMatch(/\.journey-highlight-card \{[\s\S]*align-items: flex-start;[\s\S]*line-height: 1.15;/)
    expect(source).toMatch(/\.journey-highlight-card \{[\s\S]*padding: 0 0 16px;/)
    expect(source).toMatch(/\.journey-highlights-scroll \{[\s\S]*padding-bottom: 8px;/)
    expect(source).toMatch(/\.journey-highlight-card strong,[\s\S]*overflow-wrap: anywhere;[\s\S]*white-space: normal;/)
    expect(source).toMatch(/@media \(max-width: 560px\)[\s\S]*\.journey-title \{[\s\S]*font-size: 18px;/)
    expect(source).toMatch(/@media \(max-width: 560px\)[\s\S]*\.journey-hero \{[\s\S]*min-height: 115px;/)
  })

  it('uses the legacy three-column mobile result navigation', () => {
    expect(source).toMatch(/@media \(max-width: 820px\)[\s\S]*\.section-tabs \{[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/)
    expect(source).toMatch(/@media \(max-width: 820px\)[\s\S]*\.section-tab\.active::before \{[\s\S]*display: none;/)
    expect(source).toMatch(/@media \(max-width: 820px\)[\s\S]*\.result-toolbar \{[\s\S]*gap: 8px;[\s\S]*padding: 8px 14px 0;/)
    expect(source).toMatch(/@media \(max-width: 820px\)[\s\S]*\.result-surface \{[\s\S]*padding: 13px 10px 30px;/)
    expect(source).toMatch(/@media \(max-width: 820px\)[\s\S]*\.toolbar-actions \{[\s\S]*padding-bottom: 4px;/)
    expect(source).toMatch(/@media \(max-width: 820px\)[\s\S]*\.action-button \{[\s\S]*height: 32px;[\s\S]*padding: 0 10px;[\s\S]*font-size: 11px;/)
  })
})
