import type { BudgetItemTypeDto, BudgetLedgerItemDto } from '@youban/contracts'

export type BudgetFilter = 'all' | BudgetItemTypeDto
export type BudgetSort = 'amount_desc' | 'amount_asc' | 'day_asc' | 'day_desc'

export type BudgetCalculationDescriptor
  = | { kind: 'room_night', unit: number, rooms: number, nights: number }
    | { kind: 'per_person', unit: number, travelers: number }
    | { kind: 'shared_total', travelers: number }
    | { kind: 'entered_per_person' | 'entered_group_total' }

export function budgetCalculationDescriptor(item: BudgetLedgerItemDto): BudgetCalculationDescriptor {
  if (item.calculation_summary === 'room_night'
    && item.unit_amount !== null && item.room_count && item.nights) {
    return { kind: 'room_night', unit: item.unit_amount, rooms: item.room_count, nights: item.nights }
  }
  if (item.calculation_summary === 'per_person' && item.unit_amount !== null) {
    return { kind: 'per_person', unit: item.unit_amount, travelers: item.traveler_count }
  }
  if (item.calculation_summary === 'shared_total')
    return { kind: 'shared_total', travelers: item.traveler_count }
  return { kind: item.amount_basis === 'per_person' ? 'entered_per_person' : 'entered_group_total' }
}

export function budgetItemDisplayAmount(
  item: BudgetLedgerItemDto,
  basis: 'group_total' | 'per_person',
): number | null {
  return basis === 'per_person' ? item.per_person_amount : item.amount
}

export function selectBudgetItems(
  items: BudgetLedgerItemDto[],
  filter: BudgetFilter,
  sort: BudgetSort,
): BudgetLedgerItemDto[] {
  return items
    .filter(item => !item.deleted && (filter === 'all' || item.type === filter))
    .sort((left, right) => {
      if (sort === 'day_asc' || sort === 'day_desc') {
        const difference = (left.day_index ?? Number.MAX_SAFE_INTEGER) - (right.day_index ?? Number.MAX_SAFE_INTEGER)
        return sort === 'day_asc' ? difference : -difference
      }
      const difference = (left.amount ?? -1) - (right.amount ?? -1)
      return sort === 'amount_asc' ? difference : -difference
    })
}
