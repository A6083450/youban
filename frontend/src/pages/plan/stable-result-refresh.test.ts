import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/pages/plan/index.vue'), 'utf8')

describe('plan result polling stability', () => {
  it('updates the visible plan only when the backend presentation version changes', () => {
    expect(source).toContain('let displayedPlanVersion = \'\'')
    expect(source).toContain('type CompletedTripTaskStatus = Extract<TripTaskStatusResponseDto, { status: \'completed\' }>')
    expect(source).toContain('function planPresentationVersion(status: CompletedTripTaskStatus): string')
    expect(source).toMatch(/const nextPlanVersion = planPresentationVersion\(status\)[\s\S]*if \(nextPlanVersion !== displayedPlanVersion\) \{[\s\S]*plan\.value = result[\s\S]*refreshPlanPhotos\(result\)[\s\S]*displayedPlanVersion = nextPlanVersion/)
    expect(source).toMatch(/function reload\(\): void \{[\s\S]*displayedPlanVersion = ''/)
  })

  it('preserves matching loaded photos across fast-result polling and enhancement', () => {
    expect(source).toContain('function refreshPlanPhotos(current: TripPlan): void')
    expect(source).not.toContain('refreshPlanPhotos(result, true)')
    expect(source).not.toMatch(/function refreshPlanPhotos\([^)]*clear/)
    expect(source).toContain('Object.fromEntries(Object.entries(attractionPhotos.value).filter(([name]) => targetNames.has(name)))')
  })
})
