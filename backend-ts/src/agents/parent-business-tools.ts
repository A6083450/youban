import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { SqliteTaskStore } from "../domain/task-store.ts";
import type { UserMemoryService } from "../services/hermes-memory.ts";
import type { ParentAgentScope } from "./persistent-parent-agent.ts";

function result(value: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    details: undefined,
    isError,
  };
}

function ownedTask(tasks: SqliteTaskStore, scope: ParentAgentScope, planId: string) {
  const task = tasks.get(planId);
  if (!scope.userId || !task || task.user_id !== scope.userId) return null;
  return task;
}

export function createParentBusinessTools(
  scope: ParentAgentScope,
  dependencies: { tasks: SqliteTaskStore; memory: UserMemoryService },
): ToolDefinition[] {
  return [
    defineTool({
      name: "get_trip_context",
      label: "获取行程上下文",
      description: "读取当前用户拥有的旅行计划和请求上下文。",
      parameters: Type.Object({ plan_id: Type.String() }),
      async execute(_id, params) {
        const task = ownedTask(dependencies.tasks, scope, params.plan_id);
        return task ? result({ request: task.request_payload, result: task.result }) : result({ error: "plan not found" }, true);
      },
    }),
    defineTool({
      name: "get_plan_slice",
      label: "获取行程切片",
      description: "按天读取当前用户拥有的计划片段，避免把长行程全部放入上下文。",
      parameters: Type.Object({
        plan_id: Type.String(),
        start_day: Type.Integer({ minimum: 0 }),
        end_day: Type.Integer({ minimum: 0 }),
      }),
      async execute(_id, params) {
        const task = ownedTask(dependencies.tasks, scope, params.plan_id);
        const resultValue = task?.result as Record<string, any> | null;
        const days = Array.isArray(resultValue?.data?.days) ? resultValue.data.days : null;
        if (!days) return result({ error: "plan not found" }, true);
        return result({ days: days.slice(params.start_day, params.end_day + 1) });
      },
    }),
    defineTool({
      name: "get_execution_status",
      label: "获取执行状态",
      description: "读取当前用户拥有计划的签到、跳过和实际费用状态。",
      parameters: Type.Object({ plan_id: Type.String() }),
      async execute(_id, params) {
        const task = ownedTask(dependencies.tasks, scope, params.plan_id);
        return task ? result({ execution: task.execution }) : result({ error: "plan not found" }, true);
      },
    }),
    defineTool({
      name: "recall_user_memory",
      label: "回忆用户偏好",
      description: "只检索当前会话用户的长期旅行偏好。",
      parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: 2_000 }) }),
      async execute(_id, params) {
        return result({ memory: await dependencies.memory.recall(scope.userId, params.query) });
      },
    }),
    defineTool({
      name: "save_user_memory",
      label: "保存用户偏好",
      description: "只为当前会话用户保存明确且可复用的旅行偏好。",
      parameters: Type.Object({ content: Type.String({ minLength: 1, maxLength: 4_000 }) }),
      async execute(_id, params) {
        return result({ saved: await dependencies.memory.remember(scope.userId, params.content) });
      },
    }),
  ];
}
