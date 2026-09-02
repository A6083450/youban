import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('base file generation', () => {
  it('repairs an invalid route union before the first platform build', () => {
    const root = process.cwd()
    const outputPath = resolve(root, 'src/types/uni-pages.d.ts')
    const original = readFileSync(outputPath, 'utf8')
    try {
      writeFileSync(outputPath, 'type _LocationUrl =\n  ;\n')
      execFileSync(process.execPath, ['scripts/create-base-files.js'], { cwd: root })
      const output = readFileSync(outputPath, 'utf8')
      expect(output).toContain('type _LocationUrl =')
      expect(output).toContain('"/pages/index/index" |')
      expect(output).toContain('"/pages/share/index" |')
      expect(output).toContain('"/pages/admin/index";')
      expect(output).not.toContain('type _LocationUrl =\n  ;')
    }
    finally {
      writeFileSync(outputPath, original)
    }
  })
})
