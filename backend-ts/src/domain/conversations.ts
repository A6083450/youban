import { eq } from "drizzle-orm";
import { conversationsTable } from "./db-schema.ts";
import { YoubanDatabase } from "./database.ts";

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

function normalizeMessages(value: unknown): ConversationMessage[] {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return normalizeMessages((value as Record<string, unknown>).messages);
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ConversationMessage[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const role = record.role === "assistant" ? "assistant" : record.role === "user" ? "user" : null;
    const content = String(record.content ?? "").trim();
    return role && content ? [{ role, content }] : [];
  });
}

export class ConversationRepository {
  private readonly database: YoubanDatabase;

  constructor(path: string) {
    this.database = new YoubanDatabase(path);
  }

  save(planId: string, userId: string, messages: unknown): void {
    const normalized = normalizeMessages(messages);
    const now = new Date().toISOString();
    this.database.orm.insert(conversationsTable).values({
      planId,
      userId,
      payload: JSON.stringify(normalized),
      updatedAt: now,
    }).onConflictDoUpdate({
      target: conversationsTable.planId,
      set: { userId, payload: JSON.stringify(normalized), updatedAt: now },
    }).run();
  }

  get(planId: string): ConversationMessage[] {
    const row = this.database.orm.select({ payload: conversationsTable.payload })
      .from(conversationsTable)
      .where(eq(conversationsTable.planId, planId))
      .get();
    if (!row) return [];
    try {
      return normalizeMessages(JSON.parse(row.payload));
    } catch {
      return [];
    }
  }

  append(planId: string, userId: string, messages: unknown): void {
    this.save(planId, userId, [...this.get(planId), ...normalizeMessages(messages)]);
  }

  delete(planId: string): void {
    this.database.orm.delete(conversationsTable).where(eq(conversationsTable.planId, planId)).run();
  }

  close(): void {
    this.database.close();
  }
}
