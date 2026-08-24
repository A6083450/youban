export function planningDeadlineMs(days: number): number | null {
  if (days >= 1 && days <= 7) return 6_000;
  if (days <= 15) return 10_000;
  if (days <= 30) return 15_000;
  return null;
}

export function fastPlanTriggerMs(days: number): number | null {
  const deadline = planningDeadlineMs(days);
  return deadline === null ? null : deadline - 500;
}
