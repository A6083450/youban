import { describe, expect, test } from 'bun:test'
import {
  buildHorizontalPageTargets,
  findHorizontalPageIndex,
  shouldSnapHorizontalPointerEnd,
  type HorizontalPageItem,
} from './useHorizontalPager'

const item = (offsetLeft: number, offsetWidth: number): HorizontalPageItem => ({
  offsetLeft,
  offsetWidth,
})

describe('horizontal pager geometry', () => {
  test('starts each page at the first item that was not fully visible', () => {
    const items = [
      item(0, 140),
      item(152, 140),
      item(304, 140),
      item(456, 140),
      item(608, 140),
    ]

    expect(buildHorizontalPageTargets(items, 320, 428)).toEqual([0, 304, 428])
  })

  test('uses the exact maximum scroll position for the final page', () => {
    const items = [
      item(0, 148),
      item(160, 148),
      item(320, 148),
      item(480, 148),
      item(640, 148),
    ]

    expect(buildHorizontalPageTargets(items, 375, 413)).toEqual([0, 320, 413])
  })

  test('does not turn trailing alignment space into an empty page', () => {
    const items = [
      item(0, 168),
      item(180, 168),
      item(360, 168),
      item(540, 168),
      item(720, 168),
      item(900, 168),
      item(1080, 168),
      item(1260, 168),
      item(1440, 168),
      item(1620, 168),
    ]

    expect(buildHorizontalPageTargets(items, 1198, 1632)).toEqual([0, 1080])
  })

  test('returns one stationary page when the row fits', () => {
    expect(buildHorizontalPageTargets([item(0, 140), item(152, 140)], 375, 0)).toEqual([0])
  })

  test('selects the nearest page after touch or pointer scrolling', () => {
    const targets = [0, 320, 640, 890]

    expect(findHorizontalPageIndex(targets, 0)).toBe(0)
    expect(findHorizontalPageIndex(targets, 470)).toBe(1)
    expect(findHorizontalPageIndex(targets, 520)).toBe(2)
    expect(findHorizontalPageIndex(targets, 890)).toBe(3)
  })

  test('snaps every completed drag but never a cancellation', () => {
    expect(shouldSnapHorizontalPointerEnd(true, 'mouse', 'pointerup')).toBe(true)
    expect(shouldSnapHorizontalPointerEnd(true, 'touch', 'pointerup')).toBe(true)
    expect(shouldSnapHorizontalPointerEnd(true, 'pen', 'pointerup')).toBe(true)
    expect(shouldSnapHorizontalPointerEnd(false, 'touch', 'pointerup')).toBe(false)
    expect(shouldSnapHorizontalPointerEnd(true, 'touch', 'pointercancel')).toBe(false)
  })
})
