import { describe, expect, it } from "bun:test";
import { SkillRuntimeDiagnostics } from "../src/agents/skill-runtime-diagnostics.ts";

describe("SkillRuntimeDiagnostics", () => {
  it("keeps only the latest bounded status for each runtime component", () => {
    const diagnostics = new SkillRuntimeDiagnostics();
    diagnostics.recordFailure("persistent-parent-agent", 2, "parent_host_rotation_failed");
    diagnostics.recordFailure("pi-subagent-runner", 3, "structured_host_rotation_failed");
    diagnostics.recordSuccess("persistent-parent-agent", 4);

    expect(diagnostics.snapshot()).toEqual([
      { component: "persistent-parent-agent", generation: 4, status: "success" },
      {
        component: "pi-subagent-runner",
        generation: 3,
        status: "failure",
        errorCode: "structured_host_rotation_failed",
      },
    ]);

    for (let generation = 5; generation < 105; generation += 1) {
      diagnostics.recordSuccess("persistent-parent-agent", generation);
    }
    expect(diagnostics.snapshot()).toHaveLength(2);
    expect(diagnostics.snapshot()[0]).toEqual({
      component: "persistent-parent-agent",
      generation: 104,
      status: "success",
    });
  });

  it("rejects unstable error codes before sensitive text can enter a snapshot", () => {
    const diagnostics = new SkillRuntimeDiagnostics();
    diagnostics.recordFailure("persistent-parent-agent", 8, "parent_host_rotation_failed");

    expect(() => diagnostics.recordFailure(
      "persistent-parent-agent",
      9,
      "/private/runtime prompt=secret credential=token",
    )).toThrow("stable error code");
    const serialized = JSON.stringify(diagnostics.snapshot());
    expect(serialized).toContain("parent_host_rotation_failed");
    expect(serialized).not.toContain("/private/runtime");
    expect(serialized).not.toContain("prompt=secret");
    expect(serialized).not.toContain("credential=token");
  });

  it("rejects unknown runtime components instead of retaining an unbounded key", () => {
    const diagnostics = new SkillRuntimeDiagnostics();

    expect(() => diagnostics.recordSuccess("unknown-component" as never, 1))
      .toThrow("runtime component");
    expect(diagnostics.snapshot()).toEqual([]);
  });
});
