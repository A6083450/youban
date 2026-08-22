import { Type, type Static } from "@sinclair/typebox";

export const DetailErrorSchema = Type.Object({
  detail: Type.String(),
}, { additionalProperties: false });

export const UserInfoSchema = Type.Object({
  user_id: Type.String(),
  nickname: Type.String(),
  created_at: Type.Optional(Type.String()),
  last_login_at: Type.Optional(Type.String()),
}, { additionalProperties: false });

export const LoginBodySchema = Type.Object({
  nickname: Type.String({ maxLength: 50 }),
}, { additionalProperties: false });

export const AuthResponseSchema = Type.Object({
  success: Type.Literal(true),
  user: UserInfoSchema,
}, { additionalProperties: false });

export const TripTaskStatusSchema = Type.Union([
  Type.Literal("processing"),
  Type.Literal("completed"),
  Type.Literal("failed"),
]);

export const TripTaskStageSchema = Type.Union([
  Type.Literal("submitted"),
  Type.Literal("initializing"),
  Type.Literal("attraction_search"),
  Type.Literal("weather_search"),
  Type.Literal("hotel_search"),
  Type.Literal("planning"),
  Type.Literal("reviewing"),
  Type.Literal("graph_building"),
  Type.Literal("completed"),
  Type.Literal("failed"),
]);

export const TripTaskDetailSchema = Type.Object({
  type: Type.Union([
    Type.Literal("thinking"),
    Type.Literal("searching"),
    Type.Literal("found"),
    Type.Literal("planning"),
    Type.Literal("tool_call"),
    Type.Literal("info"),
  ]),
  title: Type.String(),
  content: Type.Optional(Type.String()),
  timestamp: Type.Optional(Type.Number()),
}, { additionalProperties: false });

export const TripCheckpointSummarySchema = Type.Object({
  completed_segments: Type.Number(),
  total_segments: Type.Number(),
  last_successful_stage: Type.String(),
}, { additionalProperties: false });

export const TripTaskEventSchema = Type.Object({
  task_id: Type.String(),
  plan_id: Type.String(),
  status: TripTaskStatusSchema,
  stage: TripTaskStageSchema,
  progress: Type.Number(),
  message: Type.String(),
  details: Type.Optional(Type.Array(TripTaskDetailSchema)),
  error: Type.Optional(Type.String()),
  result: Type.Optional(Type.Unknown()),
  checkpoint_summary: Type.Optional(TripCheckpointSummarySchema),
  request_payload: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
}, { additionalProperties: false });

export const TripHistoryItemSchema = Type.Object({
  plan_id: Type.String(),
  task_id: Type.String(),
  status: TripTaskStatusSchema,
  user_id: Type.String(),
  city: Type.String(),
  cities: Type.Array(Type.Unknown()),
  start_date: Type.String(),
  end_date: Type.String(),
  travel_days: Type.Number(),
  updated_at: Type.String(),
  overall_suggestions: Type.String(),
}, { additionalProperties: false });

export const TripHistoryResponseSchema = Type.Object({
  items: Type.Array(TripHistoryItemSchema),
}, { additionalProperties: false });

export type UserInfoDto = Static<typeof UserInfoSchema>;
export type TripTaskEventDto = Static<typeof TripTaskEventSchema>;
export type TripHistoryItemDto = Static<typeof TripHistoryItemSchema>;
