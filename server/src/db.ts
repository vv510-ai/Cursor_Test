import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type ConversationMode = "chat" | "reasoner";

export type UserRow = {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: number;
};

export type ConversationRow = {
  id: string;
  userId: string;
  title: string;
  mode: ConversationMode;
  systemPrompt: string | null;
  temperature: number | null;
  maxTokens: number | null;
  orgId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type MessageRow = {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  reasoningContent: string | null;
  mode: string | null;
  toolCallsJson: string | null;
  toolCallId: string | null;
  toolName: string | null;
  createdAt: number;
};

export type OrganizationRow = {
  id: string;
  name: string;
  createdBy: string;
  createdAt: number;
};

export type OrgMemberRow = {
  orgId: string;
  userId: string;
  role: "owner" | "member";
  joinedAt: number;
};

export type DocumentRow = {
  id: string;
  userId: string;
  orgId: string | null;
  title: string;
  content: string;
  byteSize: number;
  createdAt: number;
};

const SCHEMA_VERSION = 5;

let _db: Database.Database | null = null;

/**
 * Stepwise migration. For pre-v3 databases we recreate (dev-only legacy),
 * but v3 → v4 is additive (preserves existing user/conversation/message data).
 *
 * Exported for tests; production code uses `openDatabase()` which calls this.
 */
export function migrate(s: Database.Database) {
  const v = (s.pragma("user_version", { simple: true }) as number) ?? 0;
  if (v >= SCHEMA_VERSION) return;

  if (v < 3) {
    s.exec(`
      DROP TABLE IF EXISTS messages;
      DROP TABLE IF EXISTS usage_daily;
      DROP TABLE IF EXISTS conversations;
      DROP TABLE IF EXISTS users;
    `);

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
      CREATE INDEX idx_msg_conv ON messages (conversation_id, created_at);
      CREATE TABLE usage_daily (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        chat_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, day)
      );
    `);
    s.pragma("user_version = 3");
  }

  // v3 → v4 (additive): per-conversation system prompt + decoding params
  const v3Now = (s.pragma("user_version", { simple: true }) as number) ?? 0;
  if (v3Now < 4) {
    s.exec(`
      ALTER TABLE conversations ADD COLUMN system_prompt TEXT;
      ALTER TABLE conversations ADD COLUMN temperature REAL;
      ALTER TABLE conversations ADD COLUMN max_tokens INTEGER;
    `);
    s.pragma("user_version = 4");
  }

  // v4 → v5 (additive): organizations, documents (with FTS5), tool messages, org_id on conversations
  const v4Now = (s.pragma("user_version", { simple: true }) as number) ?? 0;
  if (v4Now < 5) {
    s.exec(`
      CREATE TABLE organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE org_members (
        org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'member',
        joined_at INTEGER NOT NULL,
        PRIMARY KEY (org_id, user_id)
      );
      CREATE INDEX idx_org_member_user ON org_members(user_id);

      ALTER TABLE conversations ADD COLUMN org_id TEXT REFERENCES organizations(id) ON DELETE SET NULL;
      CREATE INDEX idx_conv_org ON conversations(org_id);

      ALTER TABLE messages ADD COLUMN tool_calls_json TEXT;
      ALTER TABLE messages ADD COLUMN tool_call_id TEXT;
      ALTER TABLE messages ADD COLUMN tool_name TEXT;

      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        org_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_doc_user ON documents(user_id);
      CREATE INDEX idx_doc_org ON documents(org_id);

      CREATE VIRTUAL TABLE documents_fts USING fts5(
        doc_id UNINDEXED,
        title,
        content,
        tokenize='unicode61 remove_diacritics 2'
      );
    `);
    s.pragma("user_version = 5");
  }
}

function openDatabase(): Database.Database {
  if (_db) return _db;
  const file = process.env.SQLITE_PATH ?? "data/chat.sqlite";
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  _db = db;
  return db;
}

export const db = {
  get raw() {
    return openDatabase();
  },

  createUser(input: { id: string; email: string; passwordHash: string }): UserRow {
    const s = openDatabase();
    const now = Date.now();
    s.prepare(
      `INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)`,
    ).run(input.id, input.email, input.passwordHash, now);
    return {
      id: input.id,
      email: input.email,
      passwordHash: input.passwordHash,
      createdAt: now,
    };
  },

  getUserByEmail(email: string): UserRow | undefined {
    const s = openDatabase();
    return s
      .prepare(
        `SELECT id, email, password_hash as passwordHash, created_at as createdAt FROM users WHERE email = ?`,
      )
      .get(email) as UserRow | undefined;
  },

  getUserById(id: string): Pick<UserRow, "id" | "email" | "createdAt"> | undefined {
    const s = openDatabase();
    return s
      .prepare(
        `SELECT id, email, created_at as createdAt FROM users WHERE id = ?`,
      )
      .get(id) as Pick<UserRow, "id" | "email" | "createdAt"> | undefined;
  },

  /**
   * List conversations the user can see:
   * - Personal (own user_id, org_id IS NULL), OR
   * - Org-scoped (any conversation where user is a member of the org)
   * Filtered by `scope`:
   *   "personal"  → only own personal conversations
   *   { orgId }   → only conversations in that org (caller must verify membership first)
   *   undefined   → all visible (personal + every org the user is in)
   */
  listConversations(
    userId: string,
    scope?: "personal" | { orgId: string },
  ): ConversationRow[] {
    const s = openDatabase();
    if (scope === "personal") {
      return s
        .prepare(
          `SELECT id, user_id as userId, title, mode,
                  system_prompt as systemPrompt, temperature, max_tokens as maxTokens,
                  org_id as orgId,
                  created_at as createdAt, updated_at as updatedAt
           FROM conversations
           WHERE user_id = ? AND org_id IS NULL
           ORDER BY updated_at DESC`,
        )
        .all(userId) as ConversationRow[];
    }
    if (scope && typeof scope === "object" && scope.orgId) {
      return s
        .prepare(
          `SELECT id, user_id as userId, title, mode,
                  system_prompt as systemPrompt, temperature, max_tokens as maxTokens,
                  org_id as orgId,
                  created_at as createdAt, updated_at as updatedAt
           FROM conversations
           WHERE org_id = ?
           ORDER BY updated_at DESC`,
        )
        .all(scope.orgId) as ConversationRow[];
    }
    return s
      .prepare(
        `SELECT c.id, c.user_id as userId, c.title, c.mode,
                c.system_prompt as systemPrompt, c.temperature, c.max_tokens as maxTokens,
                c.org_id as orgId,
                c.created_at as createdAt, c.updated_at as updatedAt
         FROM conversations c
         WHERE (c.user_id = ? AND c.org_id IS NULL)
            OR c.org_id IN (SELECT org_id FROM org_members WHERE user_id = ?)
         ORDER BY c.updated_at DESC`,
      )
      .all(userId, userId) as ConversationRow[];
  },

  /**
   * Returns the conversation if the user has access:
   * - their own personal conversation, OR
   * - any conversation in an org they are a member of.
   */
  getConversation(id: string, userId: string): ConversationRow | undefined {
    const s = openDatabase();
    return s
      .prepare(
        `SELECT c.id, c.user_id as userId, c.title, c.mode,
                c.system_prompt as systemPrompt, c.temperature, c.max_tokens as maxTokens,
                c.org_id as orgId,
                c.created_at as createdAt, c.updated_at as updatedAt
         FROM conversations c
         WHERE c.id = ?
           AND (
             (c.user_id = ? AND c.org_id IS NULL)
             OR c.org_id IN (SELECT org_id FROM org_members WHERE user_id = ?)
           )`,
      )
      .get(id, userId, userId) as ConversationRow | undefined;
  },

  createConversation(input: {
    id: string;
    userId: string;
    title?: string;
    mode?: ConversationMode;
    orgId?: string | null;
  }): ConversationRow {
    const s = openDatabase();
    const now = Date.now();
    const title = input.title?.trim() || "New chat";
    const mode = input.mode === "reasoner" ? "reasoner" : "chat";
    const orgId = input.orgId ?? null;
    s.prepare(
      `INSERT INTO conversations (id, user_id, title, mode, org_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(input.id, input.userId, title, mode, orgId, now, now);
    return {
      id: input.id,
      userId: input.userId,
      title,
      mode,
      systemPrompt: null,
      temperature: null,
      maxTokens: null,
      orgId,
      createdAt: now,
      updatedAt: now,
    };
  },

  updateConversation(
    id: string,
    userId: string,
    patch: {
      title?: string;
      mode?: ConversationMode;
      systemPrompt?: string | null;
      temperature?: number | null;
      maxTokens?: number | null;
    },
  ): boolean {
    const s = openDatabase();
    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.title !== undefined) {
      fields.push("title = ?");
      values.push(patch.title);
    }
    if (patch.mode !== undefined) {
      fields.push("mode = ?");
      values.push(patch.mode === "reasoner" ? "reasoner" : "chat");
    }
    if (patch.systemPrompt !== undefined) {
      fields.push("system_prompt = ?");
      values.push(patch.systemPrompt);
    }
    if (patch.temperature !== undefined) {
      fields.push("temperature = ?");
      values.push(patch.temperature);
    }
    if (patch.maxTokens !== undefined) {
      fields.push("max_tokens = ?");
      values.push(patch.maxTokens);
    }
    if (fields.length === 0) return true;
    fields.push("updated_at = ?");
    values.push(Date.now());
    values.push(id, userId);
    const r = s
      .prepare(
        `UPDATE conversations SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`,
      )
      .run(...values);
    return r.changes > 0;
  },

  deleteConversation(id: string, userId: string): boolean {
    const s = openDatabase();
    // Personal conversations: only owner deletes. Org conversations: any member deletes (simple model for v5).
    const r = s
      .prepare(
        `DELETE FROM conversations
         WHERE id = ?
           AND (
             (user_id = ? AND org_id IS NULL)
             OR org_id IN (SELECT org_id FROM org_members WHERE user_id = ?)
           )`,
      )
      .run(id, userId, userId);
    return r.changes > 0;
  },

  listMessages(conversationId: string): MessageRow[] {
    const s = openDatabase();
    return s
      .prepare(
        `SELECT id, conversation_id as conversationId, role, content,
                reasoning_content as reasoningContent, mode,
                tool_calls_json as toolCallsJson,
                tool_call_id as toolCallId,
                tool_name as toolName,
                created_at as createdAt
         FROM messages
         WHERE conversation_id = ?
         ORDER BY created_at ASC`,
      )
      .all(conversationId) as MessageRow[];
  },

  insertMessage(row: {
    id: string;
    conversationId: string;
    role: MessageRow["role"];
    content: string;
    reasoningContent?: string | null;
    mode?: ConversationMode | null;
    toolCallsJson?: string | null;
    toolCallId?: string | null;
    toolName?: string | null;
  }): void {
    const s = openDatabase();
    s.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, reasoning_content, mode,
                             tool_calls_json, tool_call_id, tool_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id,
      row.conversationId,
      row.role,
      row.content,
      row.reasoningContent ?? null,
      row.mode ?? null,
      row.toolCallsJson ?? null,
      row.toolCallId ?? null,
      row.toolName ?? null,
      Date.now(),
    );
  },

  touchConversation(id: string): void {
    const s = openDatabase();
    s.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(
      Date.now(),
      id,
    );
  },

  getDailyUsage(userId: string, day: string): number {
    const s = openDatabase();
    const row = s
      .prepare(
        `SELECT chat_count as c FROM usage_daily WHERE user_id = ? AND day = ?`,
      )
      .get(userId, day) as { c: number } | undefined;
    return row?.c ?? 0;
  },

  incrementDailyChat(userId: string, day: string): number {
    const s = openDatabase();
    s.prepare(
      `INSERT INTO usage_daily (user_id, day, chat_count) VALUES (?, ?, 1)
       ON CONFLICT(user_id, day) DO UPDATE SET chat_count = chat_count + 1`,
    ).run(userId, day);
    const row = s
      .prepare(
        `SELECT chat_count as c FROM usage_daily WHERE user_id = ? AND day = ?`,
      )
      .get(userId, day) as { c: number };
    return row?.c ?? 0;
  },

  totalContextChars(conversationId: string): number {
    const s = openDatabase();
    const row = s
      .prepare(
        `SELECT COALESCE(SUM(LENGTH(content)), 0) as t FROM messages WHERE conversation_id = ?`,
      )
      .get(conversationId) as { t: number };
    return row?.t ?? 0;
  },

  // ---------- Organizations ----------

  createOrg(input: { id: string; name: string; createdBy: string }): OrganizationRow {
    const s = openDatabase();
    const now = Date.now();
    const tx = s.transaction(() => {
      s.prepare(
        `INSERT INTO organizations (id, name, created_by, created_at) VALUES (?, ?, ?, ?)`,
      ).run(input.id, input.name, input.createdBy, now);
      s.prepare(
        `INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)`,
      ).run(input.id, input.createdBy, now);
    });
    tx();
    return {
      id: input.id,
      name: input.name,
      createdBy: input.createdBy,
      createdAt: now,
    };
  },

  listOrgsForUser(
    userId: string,
  ): (OrganizationRow & { role: "owner" | "member" })[] {
    const s = openDatabase();
    return s
      .prepare(
        `SELECT o.id, o.name, o.created_by as createdBy, o.created_at as createdAt, m.role
         FROM organizations o
         JOIN org_members m ON m.org_id = o.id
         WHERE m.user_id = ?
         ORDER BY o.created_at DESC`,
      )
      .all(userId) as (OrganizationRow & { role: "owner" | "member" })[];
  },

  getOrgIfMember(
    orgId: string,
    userId: string,
  ): (OrganizationRow & { role: "owner" | "member" }) | undefined {
    const s = openDatabase();
    return s
      .prepare(
        `SELECT o.id, o.name, o.created_by as createdBy, o.created_at as createdAt, m.role
         FROM organizations o
         JOIN org_members m ON m.org_id = o.id
         WHERE o.id = ? AND m.user_id = ?`,
      )
      .get(orgId, userId) as
      | (OrganizationRow & { role: "owner" | "member" })
      | undefined;
  },

  isOrgOwner(orgId: string, userId: string): boolean {
    const s = openDatabase();
    const row = s
      .prepare(
        `SELECT 1 as ok FROM org_members WHERE org_id = ? AND user_id = ? AND role = 'owner'`,
      )
      .get(orgId, userId) as { ok: number } | undefined;
    return Boolean(row);
  },

  listOrgMembers(orgId: string): { userId: string; email: string; role: string; joinedAt: number }[] {
    const s = openDatabase();
    return s
      .prepare(
        `SELECT u.id as userId, u.email, m.role, m.joined_at as joinedAt
         FROM org_members m
         JOIN users u ON u.id = m.user_id
         WHERE m.org_id = ?
         ORDER BY m.joined_at ASC`,
      )
      .all(orgId) as { userId: string; email: string; role: string; joinedAt: number }[];
  },

  addOrgMember(input: {
    orgId: string;
    userId: string;
    role?: "owner" | "member";
  }): void {
    const s = openDatabase();
    s.prepare(
      `INSERT OR IGNORE INTO org_members (org_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)`,
    ).run(input.orgId, input.userId, input.role ?? "member", Date.now());
  },

  removeOrgMember(orgId: string, userId: string): boolean {
    const s = openDatabase();
    const r = s
      .prepare(`DELETE FROM org_members WHERE org_id = ? AND user_id = ?`)
      .run(orgId, userId);
    return r.changes > 0;
  },

  deleteOrg(orgId: string): boolean {
    const s = openDatabase();
    const r = s.prepare(`DELETE FROM organizations WHERE id = ?`).run(orgId);
    return r.changes > 0;
  },

  // ---------- Documents (RAG-lite via FTS5) ----------

  createDocument(input: {
    id: string;
    userId: string;
    orgId: string | null;
    title: string;
    content: string;
  }): DocumentRow {
    const s = openDatabase();
    const now = Date.now();
    const byteSize = Buffer.byteLength(input.content, "utf8");
    const tx = s.transaction(() => {
      s.prepare(
        `INSERT INTO documents (id, user_id, org_id, title, content, byte_size, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(input.id, input.userId, input.orgId, input.title, input.content, byteSize, now);
      s.prepare(
        `INSERT INTO documents_fts (doc_id, title, content) VALUES (?, ?, ?)`,
      ).run(input.id, input.title, input.content);
    });
    tx();
    return {
      id: input.id,
      userId: input.userId,
      orgId: input.orgId,
      title: input.title,
      content: input.content,
      byteSize,
      createdAt: now,
    };
  },

  listDocuments(
    userId: string,
    scope: { orgId: string | null },
  ): DocumentRow[] {
    const s = openDatabase();
    if (scope.orgId === null) {
      return s
        .prepare(
          `SELECT id, user_id as userId, org_id as orgId, title, content,
                  byte_size as byteSize, created_at as createdAt
           FROM documents
           WHERE user_id = ? AND org_id IS NULL
           ORDER BY created_at DESC`,
        )
        .all(userId) as DocumentRow[];
    }
    // org-scoped: anyone in the org can see them (membership checked by caller)
    return s
      .prepare(
        `SELECT id, user_id as userId, org_id as orgId, title, content,
                byte_size as byteSize, created_at as createdAt
         FROM documents
         WHERE org_id = ?
         ORDER BY created_at DESC`,
      )
      .all(scope.orgId) as DocumentRow[];
  },

  getDocumentForUser(id: string, userId: string): DocumentRow | undefined {
    const s = openDatabase();
    return s
      .prepare(
        `SELECT d.id, d.user_id as userId, d.org_id as orgId, d.title, d.content,
                d.byte_size as byteSize, d.created_at as createdAt
         FROM documents d
         WHERE d.id = ?
           AND (
             (d.user_id = ? AND d.org_id IS NULL)
             OR d.org_id IN (SELECT org_id FROM org_members WHERE user_id = ?)
           )`,
      )
      .get(id, userId, userId) as DocumentRow | undefined;
  },

  deleteDocument(id: string, userId: string): boolean {
    const s = openDatabase();
    const tx = s.transaction(() => {
      const r = s
        .prepare(
          `DELETE FROM documents
           WHERE id = ?
             AND (
               (user_id = ? AND org_id IS NULL)
               OR org_id IN (SELECT org_id FROM org_members WHERE user_id = ?)
             )`,
        )
        .run(id, userId, userId);
      if (r.changes > 0) {
        s.prepare(`DELETE FROM documents_fts WHERE doc_id = ?`).run(id);
      }
      return r.changes > 0;
    });
    return tx() as boolean;
  },

  /**
   * FTS5 search scoped to the user's accessible documents.
   * Returns ranked snippets (title + 3 leading lines of matching content).
   */
  searchDocuments(
    userId: string,
    query: string,
    opts: { orgId: string | null; limit?: number },
  ): { id: string; title: string; snippet: string; rank: number }[] {
    const s = openDatabase();
    const limit = Math.max(1, Math.min(opts.limit ?? 5, 20));
    const q = sanitizeFtsQuery(query);
    if (!q) return [];

    const rows = s
      .prepare(
        `SELECT f.doc_id as id, f.title as title,
                snippet(documents_fts, 2, '<<', '>>', '…', 24) as snippet,
                bm25(documents_fts) as rank
         FROM documents_fts f
         JOIN documents d ON d.id = f.doc_id
         WHERE f.documents_fts MATCH ?
           AND (
             ${
               opts.orgId === null
                 ? "(d.user_id = ? AND d.org_id IS NULL)"
                 : "d.org_id = ? AND d.org_id IN (SELECT org_id FROM org_members WHERE user_id = ?)"
             }
           )
         ORDER BY rank
         LIMIT ?`,
      )
      .all(
        ...(opts.orgId === null
          ? [q, userId, limit]
          : [q, opts.orgId, userId, limit]),
      ) as { id: string; title: string; snippet: string; rank: number }[];
    return rows;
  },
};

/**
 * Make user input safe for FTS5 MATCH:
 * - keep only word chars / spaces / CJK
 * - quote each token to defeat operators (NEAR, OR, etc.)
 * - join with space (implicit AND)
 */
export function sanitizeFtsQuery(raw: string): string {
  const cleaned = raw
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/["']/g, " ")
    .trim();
  const tokens = cleaned
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .slice(0, 16);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `"${t}"`).join(" ");
}
