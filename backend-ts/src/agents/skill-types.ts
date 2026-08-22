export const SKILL_AGENT_IDS = [
  "parent-assistant",
  "destination-researcher",
  "segment-planner",
  "summary",
  "itinerary-reviewer",
  "plan-editor",
] as const;
export type SkillAgentId = (typeof SKILL_AGENT_IDS)[number];
export type SkillKind = "builtin" | "custom";
export type SkillSource = "builtin" | "upload" | "git";
export type SkillVersionState = "candidate" | "active" | "superseded" | "archived";

export interface SkillPrompt {
  id: string;
  name: string;
  content: string;
  versionId: string;
}

export interface SkillCatalogSnapshot {
  generation: number;
  assignments: Readonly<Record<SkillAgentId, readonly SkillPrompt[]>>;
}

export interface SkillConfigurationInput {
  enabled: boolean;
  agentIds: readonly SkillAgentId[];
}

export interface CandidateWrite {
  content: string;
  description: string;
  sha256: string;
  packageRelativePath: string;
  sourceCommit?: string;
}

export interface ReconciledBuiltinSkill extends CandidateWrite {
  name: string;
  defaultAgentIds: readonly SkillAgentId[];
}

export interface SkillVersion {
  id: string;
  skillId: string;
  versionNumber: number;
  state: SkillVersionState;
  content: string;
  name: string;
  description: string;
  sha256: string;
  packageRelativePath: string;
  sourceCommit?: string;
  createdAt: string;
  activatedAt?: string;
}

export interface SkillAssignment {
  skillId: string;
  agentId: SkillAgentId;
}

export interface SkillAuditEvent {
  id: string;
  operation: string;
  skillId: string;
  versionId?: string;
  sanitizedSource?: string;
  result: "success" | "failure";
  errorCode?: string;
  createdAt: string;
}

export interface ManagedSkill {
  id: string;
  name: string;
  description: string;
  kind: SkillKind;
  source: SkillSource;
  enabled: boolean;
  agentIds: readonly SkillAgentId[];
  activeVersion?: SkillVersion;
  candidateVersion?: SkillVersion;
  versions: readonly SkillVersion[];
  repositoryUrl?: string;
  sourceRef?: string;
  sourceSubdirectory?: string;
  generation: number;
  archivedAt?: string;
}

export type ManagedSkillSummary = Omit<
  ManagedSkill,
  "activeVersion" | "candidateVersion" | "versions"
> & {
  activeVersionId?: string;
  candidateVersionId?: string;
};
export type ManagedSkillDetail = ManagedSkill;

export interface NewSkillAuditEvent {
  operation: string;
  skillId: string;
  versionId?: string;
  sanitizedSource?: string;
  result: "success" | "failure";
  errorCode?: string;
}
