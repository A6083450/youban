import type { BudgetLedgerItemDto } from '@youban/contracts'
import { describe, expect, it } from 'vitest'
import { budgetCalculationDescriptor, budgetItemDisplayAmount, selectBudgetItems } from './budget'

function item(value: Partial<BudgetLedgerItemDto>): BudgetLedgerItemDto {
  return {
    id: '1',
    type: 'other',
    day_index: null,
    day_end_index: null,
    name: '保险',
    amount: 600,
    amount_basis: 'group_total',
    traveler_count: 3,
    per_person_amount: 200,
    calculation_summary: '',
    unit_amount: null,
    room_count: null,
    nights: null,
    origin: 'user',
    price_source: 'user',
    price_provider: '',
    linked_item_id: '',
    entity_source: '',
    source_url: '',
    price_checked_at: '',
    note: '',
    user_locked: true,
    deleted: false,
    ...value,
  }
}

describe('budget presentation', () => {
  it('uses the server-projected group or per-person amount', () => {
    expect(budgetItemDisplayAmount(item({}), 'group_total')).toBe(600)
    expect(budgetItemDisplayAmount(item({}), 'per_person')).toBe(200)
  })

  it('filters deleted and typed items before sorting', () => {
    const values = [
      item({ id: 'meal', type: 'meal', amount: 300 }),
      item({ id: 'hotel', type: 'hotel', amount: 1200 }),
      item({ id: 'deleted', type: 'hotel', amount: 2000, deleted: true }),
    ]
    expect(selectBudgetItems(values, 'all', 'amount_desc').map(value => value.id)).toEqual(['hotel', 'meal'])
    expect(selectBudgetItems(values, 'meal', 'day_asc').map(value => value.id)).toEqual(['meal'])
  })

  it('describes server calculation modes without exposing internal enum names', () => {
    expect(budgetCalculationDescriptor(item({
      calculation_summary: 'per_person',
      unit_amount: 180,
      traveler_count: 2,
    }))).toEqual({ kind: 'per_person', unit: 180, travelers: 2 })
    expect(budgetCalculationDescriptor(item({
      calculation_summary: 'room_night',
      unit_amount: 500,
      room_count: 2,
      nights: 3,
    }))).toEqual({ kind: 'room_night', unit: 500, rooms: 2, nights: 3 })
    expect(budgetCalculationDescriptor(item({ calculation_summary: 'shared_total' })))
      .toEqual({ kind: 'shared_total', travelers: 3 })
  })
})
