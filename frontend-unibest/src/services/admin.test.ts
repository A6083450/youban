import { describe, expect, it } from 'vitest'
import { adminRecordPath, adminSkillPath } from './admin'

describe('admin service paths', () => {
  it('encodes identifiers without changing the v2 admin prefix', () => {
    expect(adminRecordPath('task:plan / 1')).toBe('/api/v2/admin/records/task%3Aplan%20%2F%201')
    expect(adminSkillPath('skill / 1')).toBe('/api/v2/admin/skills/skill%20%2F%201')
  })
})
