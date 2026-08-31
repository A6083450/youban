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
})
