import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../db.js";

type ColumnInfo = { name: string; type: string };

describe("migrate", () => {
  it("brings a fresh DB to schema v5 with all expected columns and tables", () => {
    const s = new Database(":memory:");
    s.pragma("foreign_keys = ON");

    expect(s.pragma("user_version", { simple: true })).toBe(0);
    migrate(s);
    expect(s.pragma("user_version", { simple: true })).toBe(5);

    const convCols = (s.pragma("table_info(conversations)") as ColumnInfo[]).map(
      (c) => c.name,
    );
    expect(convCols).toEqual(
      expect.arrayContaining([
        "id",
        "user_id",
        "title",
        "mode",
        "created_at",
        "updated_at",
        "system_prompt",
        "temperature",
        "max_tokens",
        "org_id",
      ]),
    );

    const msgCols = (s.pragma("table_info(messages)") as ColumnInfo[]).map(
      (c) => c.name,
    );
    expect(msgCols).toEqual(
      expect.arrayContaining([
        "id",
        "conversation_id",
        "role",
        "content",
        "tool_calls_json",
        "tool_call_id",
        "tool_name",
      ]),
    );

    // Multi-tenancy + RAG tables exist
    const tables = (
      s
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as { name: string }[]
    ).map((r) => r.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "organizations",
        "org_members",
        "documents",
        "documents_fts",
      ]),
    );
  });

  it("v3 → v4 is additive (preserves existing conversation rows)", () => {
    const s = new Database(":memory:");
    s.pragma("foreign_keys = ON");

    // Manually build a "v3" snapshot with seed data
    s.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT 'New chat',
        mode TEXT NOT NULL DEFAULT 'chat',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_conv_user_updated ON conversations (user_id, updated_at);
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        reasoning_content TEXT,
        mode TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );
      CREATE TABLE usage_daily (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        chat_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, day)
      );
    `);
    s.pragma("user_version = 3");

    s.prepare(
      "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
    ).run("u1", "a@b.co", "scrypt$salt$hash", 1);
    s.prepare(
      "INSERT INTO conversations (id, user_id, title, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("c1", "u1", "old chat", "reasoner", 1, 2);
    s.prepare(
      "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run("m1", "c1", "user", "hello", 3);

    migrate(s);
    expect(s.pragma("user_version", { simple: true })).toBe(5);

    const conv = s
      .prepare(
        "SELECT id, title, mode, system_prompt, temperature, max_tokens, org_id FROM conversations WHERE id = ?",
      )
      .get("c1") as Record<string, unknown>;
    expect(conv).toEqual({
      id: "c1",
      title: "old chat",
      mode: "reasoner",
      system_prompt: null,
      temperature: null,
      max_tokens: null,
      org_id: null,
    });

    const msg = s
      .prepare(
        "SELECT content, tool_calls_json, tool_call_id, tool_name FROM messages WHERE id = ?",
      )
      .get("m1") as Record<string, unknown>;
    expect(msg).toEqual({
      content: "hello",
      tool_calls_json: null,
      tool_call_id: null,
      tool_name: null,
    });
  });

  it("is idempotent: running migrate twice keeps version at 5 and no errors", () => {
    const s = new Database(":memory:");
    migrate(s);
    migrate(s);
    expect(s.pragma("user_version", { simple: true })).toBe(5);
  });
});
