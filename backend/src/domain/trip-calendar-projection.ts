interface NativeCalendarEvent {
  title: string;
  startTime: number;
  endTime: number;
  allDay: boolean;
  description: string;
  location: string;
  alarm: boolean;
  alarmOffset: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function seconds(date: string, time: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const timestamp = Date.parse(`${date}T${time}:00+08:00`);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1_000) : null;
}

export function projectNativeCalendarEvents(planValue: unknown): NativeCalendarEvent[] {
  const plan = record(planValue);
  const days = Array.isArray(plan?.days) ? plan.days.map(record).filter(Boolean) as Record<string, unknown>[] : [];
  return days.flatMap((day) => {
    const date = text(day.date);
    const attractions = Array.isArray(day.attractions)
      ? day.attractions.map(record).filter(Boolean) as Record<string, unknown>[]
      : [];
    return attractions.flatMap((attraction, position) => {
      const startTime = seconds(date, text(attraction.start_time) || `${String(9 + position * 2).padStart(2, "0")}:00`);
      if (startTime === null) return [];
      const durationMinutes = Math.max(30, Number(attraction.visit_duration) || 90);
      return [{
        title: text(attraction.name) || `D${Number(day.day_index ?? 0) + 1} 行程`,
        startTime,
        endTime: startTime + durationMinutes * 60,
        allDay: false,
        description: text(attraction.description) || text(day.description),
        location: text(attraction.address) || text(day.city) || text(plan?.city),
        alarm: true,
        alarmOffset: 30 * 60,
      }];
    });
  });
}
