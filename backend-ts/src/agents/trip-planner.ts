import type { PlanningCheckpoint, TripPlanningRequest } from "../domain/orchestrator.ts";

export interface PlannerProgress {
  stage:
    | "initializing"
    | "attraction_search"
    | "weather_search"
    | "hotel_search"
    | "planning"
    | "reviewing"
    | "graph_building";
  progress: number;
  message: string;
  details?: Array<{
    type: "thinking" | "searching" | "found" | "planning" | "tool_call" | "info";
    title: string;
    content?: string;
    timestamp?: number;
  }>;
}

export interface PlannerRunContext {
  checkpoint: PlanningCheckpoint;
  signal: AbortSignal;
  onProgress(update: PlannerProgress): void | Promise<void>;
  onCheckpoint(checkpoint: PlanningCheckpoint): void | Promise<void>;
}

export interface TripPlanner {
  plan(request: TripPlanningRequest, context: PlannerRunContext): Promise<Record<string, unknown>>;
  close?(): void | Promise<void>;
}

export class UnavailableTripPlanner implements TripPlanner {
  async plan(): Promise<Record<string, unknown>> {
    throw new Error("旅行规划器尚未初始化");
  }
}
