import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConversationSessionRepository,
  SessionRevisionConflictError,
} from "../src/domain/conversation-sessions.ts";

const tempDirs: string[] = [];

function databasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "youban-conversation-sessions-"));
  tempDirs.push(dir);
  return join(dir, "youban.db");
}

function createRepository(): ConversationSessionRepository {
  return new ConversationSessionRepository(databasePath());
}

function createSession(repository: ConversationSessionRepository, sessionId = "session-1") {
  return repository.create({
    sessionId,
    userId: "user-1",
    firstMessage: "国庆新疆玩一个月帮我计划下",
    snapshot: { version: 1, items: [] },
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("ConversationSessionRepository", () => {
  it("creates a stable client session idempotently without disclosing another owner's row", () => {
    const repository = createRepository();
    try {
      const created = createSession(repository);
      const repeated = createSession(repository);

      expect(created).toEqual(expect.objectContaining({
        sessionId: "session-1",
        userId: "user-1",
        title: "新对话",
        titleStatus: "pending",
        state: "chatting",
        planId: null,
        revision: 0,
        snapshot: { version: 1, items: [] },
      }));
      expect(repeated).toEqual(created);
      expect(repository.getOwned("session-1", "user-2")).toBeUndefined();
      expect(() => repository.create({
        sessionId: "session-1",
        userId: "user-2",
        firstMessage: "另一个人的对话",
        snapshot: { version: 1, items: [] },
      })).toThrow("session is owned by another user");
    } finally {
      repository.close();
    }
  });

  it("increments snapshot revisions and rejects stale owner writes", () => {
    const repository = createRepository();
    try {
      createSession(repository);

      expect(
        repository.replaceSnapshot("session-1", "user-1", 0, { version: 1, items: [{ id: 1 }] }),
      ).toEqual(expect.objectContaining({ revision: 1, snapshot: { version: 1, items: [{ id: 1 }] } }));
      expect(() => repository.replaceSnapshot("session-1", "user-1", 0, { version: 1, items: [] }))
        .toThrow(SessionRevisionConflictError);
      expect(() => repository.replaceSnapshot("session-1", "user-2", 1, { version: 1, items: [] }))
        .toThrow(SessionRevisionConflictError);
    } finally {
      repository.close();
    }
  });

  it("keeps an unchanged snapshot from making a viewed session look recently active", () => {
    const repository = createRepository();
    try {
      createSession(repository);
      const snapshot = { version: 1, items: [{ id: 1, role: "user", text: "带娃去三亚" }] };
      const changed = repository.replaceSnapshot("session-1", "user-1", 0, snapshot);

      const unchanged = repository.replaceSnapshot("session-1", "user-1", changed.revision, snapshot);

      expect(unchanged.revision).toBe(changed.revision);
      expect(unchanged.updatedAt).toBe(changed.updatedAt);
      expect(unchanged.snapshot).toEqual(snapshot);
    } finally {
      repository.close();
    }
  });

  it("updates a pending title once and links the session to its generated plan", () => {
    const repository = createRepository();
    try {
      createSession(repository);

      expect(repository.setTitle("session-1", "user-1", "新疆深度游", "generated"))
        .toEqual(expect.objectContaining({ title: "新疆深度游", titleStatus: "generated" }));
      expect(repository.setTitle("session-1", "user-1", "不应覆盖", "fallback"))
        .toEqual(expect.objectContaining({ title: "新疆深度游", titleStatus: "generated" }));
      expect(repository.linkPlan("session-1", "user-1", "plan-1"))
        .toEqual(expect.objectContaining({ planId: "plan-1", state: "generating" }));
      expect(repository.getByPlanId("plan-1")).toEqual(expect.objectContaining({ sessionId: "session-1" }));
    } finally {
      repository.close();
    }
  });

  it("does not let a late generation failure regress a planned session", () => {
    const repository = createRepository();
    try {
      createSession(repository);
      repository.linkPlan("session-1", "user-1", "plan-1");

      expect(repository.markPlanned("session-1")).toEqual(expect.objectContaining({ state: "planned" }));
      expect(repository.markGenerationFailed("session-1")).toEqual(expect.objectContaining({ state: "planned" }));
    } finally {
      repository.close();
    }
  });

  it("does not mark an unlinked chat session as planned", () => {
    const repository = createRepository();
    try {
      createSession(repository);

      expect(repository.markPlanned("session-1")).toEqual(expect.objectContaining({
        state: "chatting",
        planId: null,
      }));
    } finally {
      repository.close();
    }
  });

  it("excludes a soft-deleted linked session from plan lookup", () => {
    const repository = createRepository();
    try {
      createSession(repository);
      repository.linkPlan("session-1", "user-1", "plan-1");

      expect(repository.getByPlanId("plan-1")).toEqual(expect.objectContaining({ sessionId: "session-1" }));
      expect(repository.softDelete("session-1", "user-1")).toBe(true);
      expect(repository.getByPlanId("plan-1")).toBeUndefined();
    } finally {
      repository.close();
    }
  });

  it("excludes soft-deleted sessions from owner access and removes them permanently on request", () => {
    const repository = createRepository();
    try {
      createSession(repository);

      expect(repository.softDelete("session-1", "user-1")).toBe(true);
      expect(repository.getOwned("session-1", "user-1")).toBeUndefined();
      expect(repository.listOwned("user-1")).toEqual([]);
      expect(repository.hardDelete("session-1")).toBe(true);
      expect(createSession(repository)).toEqual(expect.objectContaining({
        sessionId: "session-1",
        deletedAt: null,
        state: "chatting",
      }));
    } finally {
      repository.close();
    }
  });
});
