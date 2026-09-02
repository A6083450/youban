import { describe, expect, it } from 'vitest'
import { buildFixedItemPageTargets, findHorizontalPageIndex } from './horizontal-pager'

describe('legacy horizontal pager', () => {
  it('matches the old desktop and mobile route-track page counts for a 30-day trip', () => {
    expect(buildFixedItemPageTargets(31, 1200, 130, 4)).toHaveLength(4)
    expect(buildFixedItemPageTargets(31, 342, 130, 4)).toHaveLength(16)
  })

  it('matches the old desktop and mobile highlight page counts', () => {
    expect(buildFixedItemPageTargets(28, 1200, 168, 12)).toHaveLength(5)
    expect(buildFixedItemPageTargets(28, 342, 168, 12)).toHaveLength(28)
  })

  it('selects the nearest measured page after manual scrolling', () => {
    expect(findHorizontalPageIndex([0, 1080, 2160], 1120)).toBe(1)
    expect(findHorizontalPageIndex([0, 1080, 2160], 2050)).toBe(2)
  })
})
