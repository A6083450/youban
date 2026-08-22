import type { TrustedPoi } from "../services/amap-research-sources.ts";

export interface AttractionMutationInput {
  day_index: number;
  poi_id: string;
  name: string;
  address?: string;
  location: { longitude: number; latitude: number };
  visit_duration: number;
  description?: string;
  ticket_price: number;
  start_time: string;
  reservation_required?: boolean;
  reservation_tips?: string;
}

export class ItineraryMutationError extends Error {
  constructor(readonly status: 404 | 409 | 422, message: string) {
    super(message);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function planData(result: unknown): Record<string, unknown> | null {
  return record(record(result)?.data);
}

function planDays(result: unknown): Record<string, unknown>[] {
  const days = planData(result)?.days;
  return Array.isArray(days)
    ? days.map(record).filter((day): day is Record<string, unknown> => day !== null)
    : [];
}

function attractions(day: Record<string, unknown>): Record<string, unknown>[] {
  if (!Array.isArray(day.attractions)) day.attractions = [];
  const current = day.attractions as unknown[];
  const normalized = current.filter((item): item is Record<string, unknown> => record(item) !== null);
  if (normalized.length !== current.length) day.attractions = normalized;
  return day.attractions as Record<string, unknown>[];
}

function findDay(result: unknown, dayIndex: number): Record<string, unknown> | null {
  return planDays(result).find((day, position) => Number(day.day_index ?? position) === dayIndex) ?? null;
}

function findAttraction(result: unknown, attractionId: string): {
  day: Record<string, unknown>;
  position: number;
  item: Record<string, unknown>;
} | null {
  for (const day of planDays(result)) {
    const entries = attractions(day);
    const position = entries.findIndex((item) => String(item.id ?? "") === attractionId);
    if (position >= 0) return { day, position, item: entries[position]! };
  }
  return null;
}

function endTime(startTime: string, duration: number): string {
  const match = /^(\d{2}):(\d{2})$/.exec(startTime);
  if (!match) throw new ItineraryMutationError(422, "开始时间必须是 HH:MM");
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new ItineraryMutationError(422, "开始时间必须是 HH:MM");
  const end = hours * 60 + minutes + duration;
  if (end >= 24 * 60) throw new ItineraryMutationError(422, "景点游览时间不能跨越午夜");
  return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
}

function ensureUnique(day: Record<string, unknown>, poiId: string, ignoredId = ""): void {
  if (attractions(day).some((item) => String(item.id ?? "") !== ignoredId
    && String(item.poi_id ?? "") === poiId)) {
    throw new ItineraryMutationError(409, "该景点已经在所选日期中");
  }
}

function syncBlueprint(result: unknown): void {
  const plan = planData(result);
  const blueprint = record(plan?.blueprint);
  if (!blueprint || !Array.isArray(blueprint.stages)) return;
  const days = planDays(result);
  for (const rawStage of blueprint.stages) {
    const stage = record(rawStage);
    if (!stage) continue;
    const dayIndices = Array.isArray(stage.day_indices) ? stage.day_indices.map(Number) : [];
    const available: string[] = [];
    for (const dayIndex of dayIndices) {
      const day = days.find((entry, position) => Number(entry.day_index ?? position) === dayIndex);
      if (!day) continue;
      for (const item of attractions(day)) {
        const name = String(item.name ?? "").trim();
        if (name && !available.includes(name)) available.push(name);
      }
    }
    const previous = Array.isArray(stage.highlights)
      ? stage.highlights.map(String).map((name) => name.trim()).filter((name) => available.includes(name))
      : [];
    stage.highlights = [...new Set([...previous, ...available])].slice(0, 3);
  }
}

function attractionValue(
  input: AttractionMutationInput,
  poi: TrustedPoi,
  id: string,
  existing?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(existing ?? {}),
    id,
    poi_id: poi.poi_id,
    name: poi.name,
    address: poi.address || input.address || "",
    location: { ...poi.location },
    visit_duration: input.visit_duration,
    description: input.description ?? "",
    category: poi.type || String(existing?.category ?? "景点"),
    ticket_price: input.ticket_price,
    reservation_required: input.reservation_required ?? false,
    reservation_tips: input.reservation_tips ?? "",
    start_time: input.start_time,
    end_time: endTime(input.start_time, input.visit_duration),
    time_recommendation_basis: null,
    crowd_recommendation_basis: null,
  };
}

function sortDay(day: Record<string, unknown>): void {
  attractions(day).sort((left, right) => String(left.start_time ?? "99:99").localeCompare(String(right.start_time ?? "99:99"))
    || String(left.name ?? "").localeCompare(String(right.name ?? "")));
}

export function createAttraction(
  result: unknown,
  input: AttractionMutationInput,
  poi: TrustedPoi,
): Record<string, unknown> {
  const day = findDay(result, input.day_index);
  if (!day) throw new ItineraryMutationError(422, "所选日期不在当前行程中");
  ensureUnique(day, poi.poi_id);
  const id = `itm_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const value = attractionValue(input, poi, id);
  attractions(day).push(value);
  sortDay(day);
  syncBlueprint(result);
  return value;
}

export function updateAttraction(
  result: unknown,
  attractionId: string,
  input: AttractionMutationInput,
  poi: TrustedPoi,
): Record<string, unknown> {
  const found = findAttraction(result, attractionId);
  if (!found) throw new ItineraryMutationError(404, "行程景点不存在");
  const targetDay = findDay(result, input.day_index);
  if (!targetDay) throw new ItineraryMutationError(422, "所选日期不在当前行程中");
  ensureUnique(targetDay, poi.poi_id, attractionId);
  const value = attractionValue(input, poi, attractionId, found.item);
  attractions(found.day).splice(found.position, 1);
  attractions(targetDay).push(value);
  sortDay(found.day);
  if (targetDay !== found.day) sortDay(targetDay);
  syncBlueprint(result);
  return value;
}

export function deleteAttraction(result: unknown, attractionId: string): void {
  const found = findAttraction(result, attractionId);
  if (!found) throw new ItineraryMutationError(404, "行程景点不存在");
  attractions(found.day).splice(found.position, 1);
  syncBlueprint(result);
}

export function cityForDay(result: unknown, dayIndex: number): string {
  const plan = planData(result);
  const day = findDay(result, dayIndex);
  if (!day) throw new ItineraryMutationError(422, "所选日期不在当前行程中");
  return String(day.city || plan?.city || "").trim();
}
