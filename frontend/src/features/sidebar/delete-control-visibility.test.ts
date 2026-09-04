import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sidebarSources = [
  'src/components/layout/PlanSidebar.vue',
  'src/pages/index/index.vue',
].map(path => readFileSync(resolve(process.cwd(), path), 'utf8'))

describe('sidebar delete controls', () => {
  it('keeps record deletion visible and touch-sized without hover', () => {
    for (const source of sidebarSources) {
      const rowRule = source.match(/\.sidebar-record-row\s*\{([^}]*)\}/)?.[1] || ''
      const deleteRule = source.match(/\.record-delete\s*\{([^}]*)\}/)?.[1] || ''

      expect(rowRule).toMatch(/min-height:\s*44px;/)
      expect(deleteRule).toMatch(/width:\s*44px;/)
      expect(deleteRule).toMatch(/height:\s*44px;/)
      expect(deleteRule).toMatch(/opacity:\s*1;/)
    }
  })
})
