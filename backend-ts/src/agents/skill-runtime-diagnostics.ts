export const SKILL_RUNTIME_COMPONENTS = [
  "persistent-parent-agent",
  "pi-subagent-runner",
] as const;

export type SkillRuntimeComponent = (typeof SKILL_RUNTIME_COMPONENTS)[number];

export type SkillRuntimeStatus =
  | {
    component: SkillRuntimeComponent;
    generation: number;
    status: "success";
  }
  | {
    component: SkillRuntimeComponent;
    generation: number;
    status: "failure";
    errorCode: string;
  };

const STABLE_ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/;

function assertComponent(component: SkillRuntimeComponent): void {
  if (!SKILL_RUNTIME_COMPONENTS.includes(component)) {
    throw new TypeError("Unknown skill runtime component");
  }
}

function assertGeneration(generation: number): void {
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new TypeError("Skill runtime diagnostic generation must be a non-negative integer");
  }
}

export class SkillRuntimeDiagnostics {
  private readonly latest = new Map<SkillRuntimeComponent, SkillRuntimeStatus>();

  recordFailure(
    component: SkillRuntimeComponent,
    generation: number,
    errorCode: string,
  ): void {
    assertComponent(component);
    assertGeneration(generation);
    if (!STABLE_ERROR_CODE.test(errorCode)) {
      throw new TypeError("Skill runtime diagnostic failure requires a stable error code");
    }
    this.latest.set(component, { component, generation, status: "failure", errorCode });
  }

  recordSuccess(component: SkillRuntimeComponent, generation: number): void {
    assertComponent(component);
    assertGeneration(generation);
    this.latest.set(component, { component, generation, status: "success" });
  }

  snapshot(): SkillRuntimeStatus[] {
    return SKILL_RUNTIME_COMPONENTS.flatMap((component) => {
      const status = this.latest.get(component);
      return status ? [{ ...status }] : [];
    });
  }
}
