import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@earendil-works/pi-ai/compat";
import { createBuiltinSkillCatalogSnapshot } from "../src/agents/skill-registry.ts";
import { createYoubanAgentSession } from "../src/agents/session-host.ts";
import { createMockPiModel } from "../tests/helpers/mock-pi-model.ts";

const RUN_COUNT = 10;
const EXTERNAL_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"];

function percentile(samples: number[], fraction: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1] ?? 0;
}

const tempRoot = mkdtempSync(join(tmpdir(), "youban-pi-benchmark-"));
const runtimeDir = join(tempRoot, "runtime");
const mockModel = createMockPiModel(runtimeDir);
const parentModel = getModel("openai", "gpt-4o-mini");
if (!parentModel) throw new Error("Built-in OpenAI smoke model is unavailable");

const sessionStartedAt = performance.now();
const host = await createYoubanAgentSession({
  cwd: tempRoot,
  runtimeDir,
  model: parentModel,
  subagentModel: "youban-mock/mock-model",
  skillSnapshot: createBuiltinSkillCatalogSnapshot(),
  tools: ["subagent"],
});
const sessionStartupMs = performance.now() - sessionStartedAt;

try {
  const childSamplesMs: number[] = [];
  for (let index = 0; index < RUN_COUNT; index += 1) {
    const startedAt = performance.now();
    const response = await host.delegate({
      requestId: crypto.randomUUID(),
      ownerRunId: "p0.5-benchmark",
      nodeId: `sample-${index + 1}`,
      agent: "segment-planner",
      task: "Return the fixed benchmark verdict.",
      context: "fresh",
      cwd: tempRoot,
      timeoutMs: 10_000,
      turnBudget: { maxTurns: 1 },
      toolBudget: { hard: 0, block: EXTERNAL_TOOL_NAMES },
      result: {
        kind: "structured",
        schema: {
          type: "object",
          properties: { verdict: { type: "string" } },
          required: ["verdict"],
          additionalProperties: false,
        },
      },
    });
    if (response.status !== "completed") {
      throw new Error(`Benchmark child failed: ${JSON.stringify(response)}`);
    }
    childSamplesMs.push(performance.now() - startedAt);
  }

  const warmSamples = childSamplesMs.slice(1);
  console.log(
    JSON.stringify(
      {
        runtime: { bun: Bun.version, pi: "0.84.2", piSubagents: "0.53.0" },
        runCount: RUN_COUNT,
        sessionStartupMs,
        coldChildMs: childSamplesMs[0],
        childSamplesMs,
        warm: {
          p50Ms: percentile(warmSamples, 0.5),
          p95Ms: percentile(warmSamples, 0.95),
        },
      },
      null,
      2,
    ),
  );
} finally {
  host.dispose();
  mockModel.stop();
  rmSync(tempRoot, { recursive: true, force: true });
}
