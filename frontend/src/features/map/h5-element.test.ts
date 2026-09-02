import { describe, expect, it } from 'vitest'
import { resolveH5Element } from './h5-element'

describe('resolveH5Element', () => {
  it('unwraps the native element exposed by a uni-app view component ref', () => {
    const element = document.createElement('div')

    expect(resolveH5Element({ $el: element })).toBe(element)
  })

  it('keeps a native element ref unchanged', () => {
    const element = document.createElement('div')

    expect(resolveH5Element(element)).toBe(element)
  })

  it('rejects values that do not expose a native element', () => {
    expect(resolveH5Element({})).toBeNull()
  })
})
