import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, "..", ".env") });
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { stream } from "hono/streaming";
import { HTTPException } from "hono/http-exception";
import { sign, verify } from "hono/jwt";
import { db, type ConversationMode, type MessageRow } from "./db.js";
import { consumeUpstreamSse } from "./sseAccum.js";
import {
  dailyChatLimit,
  getJwtSecret,
  jwtExpiresSeconds,
  maxContextChars,
  DEEPSEEK_MODEL,
  rateLimitChatPerMinute,
} from "./config.js";
import {
  buildChatCompletionPayload,
  type UpstreamMessage,
} from "./deepseekUpstream.js";
import { hashPassword, verifyPassword } from "./password.js";
import { externalModerate, moderate } from "./moderation.js";
import { getTool, listToolSchemas } from "./tools.js";

type Variables = {
  requestId: string;
  userId?: string;
};

const app = new Hono<{ Variables: Variables }>();

const DEFAULT_BASE = "https://api.deepseek.com/v1";
const MAX_BODY_BYTES = 512 * 1024;

const chatRateBuckets = new Map<string, number[]>();

function getBaseUrl(): string {
  return (process.env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, "");
}

function getApiKey(): string | undefined {
  const k = process.env.DEEPSEEK_API_KEY?.trim();
  return k && k.length > 0 ? k : undefined;
}

/**
 * Convert stored messages to upstream wire format.
 * - assistant tool_call rows: encode `tool_calls` array, content may be empty
 * - tool result rows: encode `tool_call_id` + `name`, content is the tool output JSON
 * - regular rows: just role + content
 *   (We do NOT forward stored `reasoning_content` per the DeepSeek docs.)
 */
function toUpstreamMessages(rows: MessageRow[]): UpstreamMessage[] {
  const out: UpstreamMessage[] = [];
  for (const r of rows) {
    if (r.role === "assistant" && r.toolCallsJson) {
      let parsed: UpstreamMessage["tool_calls"] = undefined;
      try {
        parsed = JSON.parse(r.toolCallsJson) as UpstreamMessage["tool_calls"];
      } catch {
        parsed = undefined;
      }
      out.push({
        role: "assistant",
        content: r.content || null,
        tool_calls: parsed,
      });
    } else if (r.role === "tool" && r.toolCallId) {
      out.push({
        role: "tool",
        content: r.content,
        tool_call_id: r.toolCallId,
        name: r.toolName ?? undefined,
      });
    } else {
      out.push({ role: r.role, content: r.content });
    }
  }
  return out;
}

function jsonErr(c: { json: (b: unknown, s: number) => Response; get: (k: "requestId") => string }, status: number, code: string, message: string) {
  const requestId = c.get("requestId");
  return c.json({ error: { code, message, requestId } }, status);
}

function logInfo(obj: Record<string, unknown>) {
  console.log(JSON.stringify({ level: "info", ts: new Date().toISOString(), ...obj }));
}

function logWarn(obj: Record<string, unknown>) {
  console.warn(JSON.stringify({ level: "warn", ts: new Date().toISOString(), ...obj }));
}

function rateLimitAllow(key: string, maxPerMinute: number): boolean {
  const now = Date.now();
  const windowMs = 60_000;
  const arr = (chatRateBuckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= maxPerMinute) {
    chatRateBuckets.set(key, arr);
    return false;
  }
  arr.push(now);
  chatRateBuckets.set(key, arr);
  return true;
}

function validEmail(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use("*", async (c, next) => {
  const rid = c.req.header("X-Request-Id")?.trim() || randomUUID();
  c.set("requestId", rid);
  c.header("X-Request-Id", rid);
  await next();
});

app.use(
  "/*",
  cors({
    origin: (origin) => {
      if (!origin) return allowedOrigins[0];
      return allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
    },
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Request-Id", "X-Session-Id"],
    exposeHeaders: ["Content-Type", "X-Request-Id"],
    maxAge: 86400,
  }),
);

async function requireBearer(c: {
  req: { header: (n: string) => string | undefined };
  set: (k: "userId", v: string) => void;
  get: (k: "requestId") => string;
  json: (b: unknown, s: number) => Response;
}, next: () => Promise<void>) {
  const auth = c.req.header("Authorization");
  const m = auth?.match(/^Bearer\s+(.+)$/i);
  if (!m?.[1]) {
    return jsonErr(c, 401, "UNAUTHORIZED", "Missing or invalid Authorization header");
  }
  try {
    const secret = getJwtSecret();
    const payload = await verify(m[1], secret, "HS256");
    const sub = payload.sub;
    if (typeof sub !== "string" || !sub) {
      return jsonErr(c, 401, "UNAUTHORIZED", "Invalid token payload");
    }
    c.set("userId", sub);
  } catch {
    return jsonErr(c, 401, "UNAUTHORIZED", "Invalid or expired token");
  }
  await next();
}

function healthPayload() {
  return {
    status: "ok" as const,
    service: "chat-deepseek-server",
    uptimeSeconds: Math.floor(process.uptime()),
    config: {
      deepseekBaseUrlConfigured: Boolean(process.env.DEEPSEEK_BASE_URL),
      deepseekApiKeyPresent: Boolean(getApiKey()),
      sqlitePath: process.env.SQLITE_PATH ?? "data/chat.sqlite",
      defaultModel: DEEPSEEK_MODEL,
    },
  };
}

app.get("/health", (c) => c.json(healthPayload()));
app.get("/api/health", (c) => c.json(healthPayload()));

app.get("/ready", async (c) => {
  const key = getApiKey();
  if (!key) {
    return c.json(
      {
        ready: false,
        reason: "missing_api_key",
        message: "Set DEEPSEEK_API_KEY in .env for upstream checks and chat.",
      },
      503,
    );
  }

  const base = getBaseUrl();
  const probeUrl = `${base}/models`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(probeUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return c.json(
        {
          ready: false,
          reason: "upstream_error",
          status: res.status,
          message: "DeepSeek /models returned a non-success status.",
        },
        503,
      );
    }

    return c.json({
      ready: true,
      upstream: "deepseek",
      probedUrl: probeUrl,
    });
  } catch (e) {
    clearTimeout(timeout);
    const msg = e instanceof Error ? e.message : "unknown_error";
    return c.json(
      {
        ready: false,
        reason: "upstream_unreachable",
        message: msg,
      },
      503,
    );
  }
});

// --- Auth (public) ---

app.post("/api/auth/register", async (c) => {
  const raw = await c.req.text();
  if (raw.length > 16384) return jsonErr(c, 413, "PAYLOAD_TOO_LARGE", "Body too large");
  let body: { email?: string; password?: string };
  try {
    body = JSON.parse(raw) as { email?: string; password?: string };
  } catch {
    return jsonErr(c, 400, "BAD_JSON", "Invalid JSON");
  }
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !validEmail(email)) {
    return jsonErr(c, 400, "INVALID_EMAIL", "Valid email required");
  }
  if (isAnonymousEmail(email)) {
    return jsonErr(c, 400, "INVALID_EMAIL", "This email domain is reserved");
  }
  if (password.length < 8) {
    return jsonErr(c, 400, "WEAK_PASSWORD", "Password must be at least 8 characters");
  }
  if (db.getUserByEmail(email)) {
    return jsonErr(c, 409, "EMAIL_IN_USE", "Email already registered");
  }

  const id = randomUUID();
  const passwordHash = hashPassword(password);
  db.createUser({ id, email, passwordHash });

  const exp = Math.floor(Date.now() / 1000) + jwtExpiresSeconds();
  const token = await sign({ sub: id, email, exp }, getJwtSecret(), "HS256");
  logInfo({ event: "auth_register", requestId: c.get("requestId"), userId: id });
  return c.json({ token, user: { id, email } }, 201);
});

const ANON_EMAIL_DOMAIN = "anon.local";

function isAnonymousEmail(email: string): boolean {
  return email.endsWith(`@${ANON_EMAIL_DOMAIN}`);
}

/**
 * Zero-friction entry: caller gets a JWT for a fresh anonymous user.
 * The user is real (lives in the users table), so all per-user invariants
 * (rate limit / daily quota / conversation isolation) still apply.
 *
 * The browser keeps the JWT in localStorage; clearing it abandons the data.
 */
app.post("/api/auth/anonymous", async (c) => {
  const id = randomUUID();
  const email = `anon-${id}@${ANON_EMAIL_DOMAIN}`;
  // Random unguessable password — anonymous accounts can never be logged into via /login
  const passwordHash = hashPassword(randomUUID() + randomUUID());
  db.createUser({ id, email, passwordHash });

  const exp = Math.floor(Date.now() / 1000) + jwtExpiresSeconds();
  const token = await sign({ sub: id, email, exp }, getJwtSecret(), "HS256");
  logInfo({ event: "auth_anonymous", requestId: c.get("requestId"), userId: id });
  return c.json(
    { token, user: { id, email, isAnonymous: true } },
    201,
  );
});

app.post("/api/auth/login", async (c) => {
  const raw = await c.req.text();
  if (raw.length > 16384) return jsonErr(c, 413, "PAYLOAD_TOO_LARGE", "Body too large");
  let body: { email?: string; password?: string };
  try {
    body = JSON.parse(raw) as { email?: string; password?: string };
  } catch {
    return jsonErr(c, 400, "BAD_JSON", "Invalid JSON");
  }
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !password) {
    return jsonErr(c, 400, "INVALID_CREDENTIALS", "Email and password required");
  }
  const user = db.getUserByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    logWarn({ event: "auth_login_failed", requestId: c.get("requestId"), email });
    return jsonErr(c, 401, "INVALID_CREDENTIALS", "Invalid email or password");
  }

  const exp = Math.floor(Date.now() / 1000) + jwtExpiresSeconds();
  const token = await sign(
    { sub: user.id, email: user.email, exp },
    getJwtSecret(),
    "HS256",
  );
  logInfo({ event: "auth_login", requestId: c.get("requestId"), userId: user.id });
  return c.json({ token, user: { id: user.id, email: user.email } });
});

app.get("/api/auth/me", requireBearer, (c) => {
  const uid = c.get("userId")!;
  const u = db.getUserById(uid);
  if (!u) return jsonErr(c, 404, "USER_NOT_FOUND", "User not found");
  return c.json({
    user: {
      id: u.id,
      email: u.email,
      createdAt: u.createdAt,
      isAnonymous: isAnonymousEmail(u.email),
    },
  });
});

// --- Protected API ---

type ChatRole = "system" | "user" | "assistant";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

type ChatRequestBody = {
  messages: ChatMessage[];
  model?: string;
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
};

app.post("/api/chat", requireBearer, async (c) => {
  const key = getApiKey();
  if (!key) {
    return jsonErr(c, 503, "UPSTREAM_NOT_CONFIGURED", "Server missing DEEPSEEK_API_KEY in .env");
  }

  const uid = c.get("userId")!;
  const rlKey = `chat:${uid}`;
  if (!rateLimitAllow(rlKey, rateLimitChatPerMinute())) {
    return jsonErr(c, 429, "RATE_LIMIT", "Too many chat requests; try again shortly");
  }

  const raw = await c.req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return jsonErr(c, 413, "PAYLOAD_TOO_LARGE", "Request body too large");
  }

  let body: ChatRequestBody;
  try {
    body = JSON.parse(raw) as ChatRequestBody;
  } catch {
    return jsonErr(c, 400, "BAD_JSON", "Invalid JSON body");
  }

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return jsonErr(c, 400, "VALIDATION_ERROR", "messages must be a non-empty array");
  }

  const totalChars = body.messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);
  if (totalChars > maxContextChars()) {
    return jsonErr(c, 400, "CONTEXT_TOO_LARGE", "messages exceed MAX_CONTEXT_CHARS");
  }

  const upstreamPayload: Record<string, unknown> = {
    model: DEEPSEEK_MODEL,
    messages: body.messages,
    stream: body.stream !== false,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
  };

  const base = getBaseUrl();
  const url = `${base}/chat/completions`;

  const upstream = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(upstreamPayload),
    signal: c.req.raw.signal,
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    logWarn({
      event: "upstream_error",
      requestId: c.get("requestId"),
      status: upstream.status,
    });
    return c.json(
      {
        error: {
          code: "UPSTREAM_ERROR",
          message: "DeepSeek request failed",
          requestId: c.get("requestId"),
          detail: errText.slice(0, 4000),
          status: upstream.status,
        },
      },
      502,
    );
  }

  if (!upstream.body) {
    return jsonErr(c, 502, "UPSTREAM_EMPTY", "Empty upstream body");
  }

  if (body.stream === false) {
    const text = await upstream.text();
    return c.body(text, 200, {
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
    });
  }

  c.header("Content-Type", "text/event-stream; charset=utf-8");
  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");

  return stream(c, async (s) => {
    const reader = upstream.body!.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) await s.write(value);
      }
    } finally {
      reader.releaseLock();
    }
  });
});

function serializeConversation(r: {
  id: string;
  title: string;
  mode: ConversationMode;
  systemPrompt: string | null;
  temperature: number | null;
  maxTokens: number | null;
  orgId: string | null;
  createdAt: number;
  updatedAt: number;
}) {
  return {
    id: r.id,
    title: r.title,
    mode: r.mode,
    systemPrompt: r.systemPrompt,
    temperature: r.temperature,
    maxTokens: r.maxTokens,
    orgId: r.orgId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

app.get("/api/conversations", requireBearer, (c) => {
  const uid = c.get("userId")!;
  const scopeQ = c.req.query("scope");
  const orgIdQ = c.req.query("orgId");

  let rows;
  if (scopeQ === "personal") {
    rows = db.listConversations(uid, "personal");
  } else if (orgIdQ) {
    if (!db.getOrgIfMember(orgIdQ, uid)) {
      return jsonErr(c, 403, "FORBIDDEN", "Not a member of that org");
    }
    rows = db.listConversations(uid, { orgId: orgIdQ });
  } else {
    rows = db.listConversations(uid);
  }
  return c.json({
    conversations: rows.map(serializeConversation),
  });
});

app.post("/api/conversations", requireBearer, async (c) => {
  const uid = c.get("userId")!;
  const raw = await c.req.text();
  if (raw.length > 8192) return jsonErr(c, 413, "PAYLOAD_TOO_LARGE", "Body too large");
  let body: {
    title?: string;
    mode?: ConversationMode;
    orgId?: string | null;
  };
  try {
    body = raw ? (JSON.parse(raw) as typeof body) : {};
  } catch {
    return jsonErr(c, 400, "BAD_JSON", "Invalid JSON");
  }
  let orgId: string | null = null;
  if (body.orgId) {
    if (!db.getOrgIfMember(body.orgId, uid)) {
      return jsonErr(c, 403, "FORBIDDEN", "Not a member of that org");
    }
    orgId = body.orgId;
  }
  const id = randomUUID();
  const row = db.createConversation({
    id,
    userId: uid,
    title: body.title,
    mode: body.mode,
    orgId,
  });
  return c.json({ conversation: serializeConversation(row) }, 201);
});

app.get("/api/conversations/:id", requireBearer, (c) => {
  const uid = c.get("userId")!;
  const id = c.req.param("id");
  const conv = db.getConversation(id, uid);
  if (!conv) return jsonErr(c, 404, "NOT_FOUND", "Conversation not found");
  const messages = db.listMessages(id);
  return c.json({
    conversation: serializeConversation(conv),
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      reasoningContent: m.reasoningContent,
      mode: m.mode,
      toolCallsJson: m.toolCallsJson,
      toolCallId: m.toolCallId,
      toolName: m.toolName,
      createdAt: m.createdAt,
    })),
  });
});

const MAX_SYSTEM_PROMPT_CHARS = 8000;

app.patch("/api/conversations/:id", requireBearer, async (c) => {
  const uid = c.get("userId")!;
  const id = c.req.param("id");
  const raw = await c.req.text();
  let body: {
    title?: string;
    mode?: ConversationMode;
    systemPrompt?: string | null;
    temperature?: number | null;
    maxTokens?: number | null;
  };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return jsonErr(c, 400, "BAD_JSON", "Invalid JSON");
  }

  const patch: Parameters<typeof db.updateConversation>[2] = {};

  if (body.title !== undefined) {
    const t = body.title.trim();
    if (!t) return jsonErr(c, 400, "VALIDATION_ERROR", "Title cannot be empty");
    if (t.length > 200)
      return jsonErr(c, 400, "VALIDATION_ERROR", "Title too long (max 200)");
    patch.title = t;
  }

  if (body.mode !== undefined) {
    if (body.mode !== "chat" && body.mode !== "reasoner") {
      return jsonErr(c, 400, "VALIDATION_ERROR", "Invalid mode");
    }
    patch.mode = body.mode;
  }

  if (body.systemPrompt !== undefined) {
    if (body.systemPrompt === null) {
      patch.systemPrompt = null;
    } else if (typeof body.systemPrompt !== "string") {
      return jsonErr(c, 400, "VALIDATION_ERROR", "systemPrompt must be string or null");
    } else {
      const sp = body.systemPrompt;
      if (sp.length > MAX_SYSTEM_PROMPT_CHARS) {
        return jsonErr(
          c,
          400,
          "VALIDATION_ERROR",
          `systemPrompt too long (max ${MAX_SYSTEM_PROMPT_CHARS})`,
        );
      }
      patch.systemPrompt = sp.trim() === "" ? null : sp;
    }
  }

  if (body.temperature !== undefined) {
    if (body.temperature === null) {
      patch.temperature = null;
    } else {
      const t = Number(body.temperature);
      if (!Number.isFinite(t) || t < 0 || t > 2) {
        return jsonErr(c, 400, "VALIDATION_ERROR", "temperature must be a number in [0, 2]");
      }
      patch.temperature = t;
    }
  }

  if (body.maxTokens !== undefined) {
    if (body.maxTokens === null) {
      patch.maxTokens = null;
    } else {
      const n = Number(body.maxTokens);
      if (!Number.isFinite(n) || n < 1 || n > 32000 || !Number.isInteger(n)) {
        return jsonErr(
          c,
          400,
          "VALIDATION_ERROR",
          "maxTokens must be an integer in [1, 32000]",
        );
      }
      patch.maxTokens = n;
    }
  }

  const ok = db.updateConversation(id, uid, patch);
  if (!ok) return jsonErr(c, 404, "NOT_FOUND", "Conversation not found");
  const conv = db.getConversation(id, uid)!;
  return c.json({ conversation: serializeConversation(conv) });
});

app.delete("/api/conversations/:id", requireBearer, (c) => {
  const uid = c.get("userId")!;
  const id = c.req.param("id");
  const ok = db.deleteConversation(id, uid);
  if (!ok) return jsonErr(c, 404, "NOT_FOUND", "Conversation not found");
  return c.json({ ok: true });
});

const MAX_TOOL_ITERATIONS = 4;
const RAG_INJECTION_LIMIT = 3;

app.post("/api/conversations/:id/chat", requireBearer, async (c) => {
  const key = getApiKey();
  if (!key) {
    return jsonErr(c, 503, "UPSTREAM_NOT_CONFIGURED", "Server missing DEEPSEEK_API_KEY in .env");
  }

  const uid = c.get("userId")!;
  const convId = c.req.param("id");
  const conv = db.getConversation(convId, uid);
  if (!conv) return jsonErr(c, 404, "NOT_FOUND", "Conversation not found");

  if (!rateLimitAllow(`chat:${uid}`, rateLimitChatPerMinute())) {
    return jsonErr(c, 429, "RATE_LIMIT", "Too many chat requests; try again shortly");
  }

  const day = new Date().toISOString().slice(0, 10);
  const used = db.getDailyUsage(uid, day);
  if (used >= dailyChatLimit()) {
    return jsonErr(
      c,
      429,
      "DAILY_QUOTA",
      `Daily chat limit (${dailyChatLimit()}) reached`,
    );
  }

  const raw = await c.req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return jsonErr(c, 413, "PAYLOAD_TOO_LARGE", "Request body too large");
  }
  let body: { content?: string; useDocs?: boolean; useTools?: boolean };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return jsonErr(c, 400, "BAD_JSON", "Invalid JSON body");
  }
  const content = body.content?.trim();
  if (!content) return jsonErr(c, 400, "VALIDATION_ERROR", "content is required");

  // ---------- Moderation (pre-flight) ----------
  const localMod = moderate(content, "user");
  if (!localMod.ok) {
    logWarn({
      event: "moderation_blocked",
      requestId: c.get("requestId"),
      userId: uid,
      reason: localMod.reason,
    });
    return jsonErr(c, 400, "CONTENT_BLOCKED", localMod.reason);
  }
  const extMod = await externalModerate(content, "user", c.req.raw.signal);
  if (!extMod.ok) {
    logWarn({
      event: "moderation_external_blocked",
      requestId: c.get("requestId"),
      userId: uid,
      reason: extMod.reason,
    });
    return jsonErr(c, 400, "CONTENT_BLOCKED", extMod.reason);
  }

  const userMsgId = randomUUID();
  db.insertMessage({
    id: userMsgId,
    conversationId: convId,
    role: "user",
    content,
    mode: conv.mode,
  });

  if (conv.title === "New chat") {
    const short = content.length > 56 ? `${content.slice(0, 53)}…` : content;
    db.updateConversation(convId, uid, { title: short });
  }

  // ---------- Optional document RAG-lite injection ----------
  let docContext: string | null = null;
  if (body.useDocs) {
    const hits = db.searchDocuments(uid, content, {
      orgId: conv.orgId,
      limit: RAG_INJECTION_LIMIT,
    });
    if (hits.length > 0) {
      const lines = ["You have access to excerpts from the user's documents:"];
      for (const h of hits) {
        lines.push(`- [${h.title}] ${h.snippet}`);
      }
      lines.push(
        "Use these excerpts when relevant; cite the bracketed title. If none are relevant, ignore them.",
      );
      docContext = lines.join("\n");
    }
  }

  const historyRows = db.listMessages(convId);
  const baseMessages: UpstreamMessage[] = toUpstreamMessages(historyRows);
  if (docContext) {
    baseMessages.unshift({ role: "system", content: docContext });
  }

  const ctxChars = db.totalContextChars(convId);
  if (ctxChars > maxContextChars()) {
    return jsonErr(
      c,
      400,
      "CONTEXT_TOO_LARGE",
      `Conversation context exceeds MAX_CONTEXT_CHARS (${maxContextChars()})`,
    );
  }

  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/chat/completions`;

  db.incrementDailyChat(uid, day);

  c.header("Content-Type", "text/event-stream; charset=utf-8");
  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");

  return stream(c, async (s) => {
    /**
     * Tool loop:
     * - At each iteration, send accumulated `messages` upstream with tools enabled.
     * - Forward content/reasoning deltas to the client unchanged (OpenAI-style).
     * - Accumulate tool_calls. If finish_reason === "tool_calls", execute them
     *   server-side and append assistant + tool result messages, then loop.
     * - Otherwise, persist the final assistant message and exit.
     */
    let messages = [...baseMessages];
    const useTools = body.useTools !== false; // default on

    const writeChunk = async (obj: unknown) => {
      await s.write(`data: ${JSON.stringify(obj)}\n\n`);
    };

    let lastReasoning = "";
    let finalContent = "";
    let finalReasoning = "";

    try {
      for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
        const payload = buildChatCompletionPayload(messages, conv.mode, {
          systemPrompt: conv.systemPrompt,
          temperature: conv.temperature,
          maxTokens: conv.maxTokens,
          tools: useTools ? listToolSchemas() : undefined,
        });

        logInfo({
          event: "deepseek_chat_iter",
          requestId: c.get("requestId"),
          userId: uid,
          conversationId: convId,
          iteration: iter,
          model: DEEPSEEK_MODEL,
          mode: conv.mode,
        });

        const upstream = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify(payload),
          signal: c.req.raw.signal,
        });

        if (!upstream.ok) {
          const errText = await upstream.text();
          logWarn({
            event: "upstream_error",
            requestId: c.get("requestId"),
            status: upstream.status,
          });
          await writeChunk({
            error: {
              code: "UPSTREAM_ERROR",
              message: "DeepSeek request failed",
              detail: errText.slice(0, 2000),
              status: upstream.status,
            },
          });
          return;
        }
        if (!upstream.body) {
          await writeChunk({ error: { code: "UPSTREAM_EMPTY", message: "Empty upstream body" } });
          return;
        }

        const acc = await consumeUpstreamSse(upstream.body.getReader(), {
          onContentDelta: async (delta) => {
            await writeChunk({ choices: [{ delta: { content: delta } }] });
          },
          onReasoningDelta: async (delta) => {
            await writeChunk({ choices: [{ delta: { reasoning_content: delta } }] });
          },
        });

        if (acc.reasoning.length > 0) {
          lastReasoning = acc.reasoning;
          finalReasoning = acc.reasoning;
        }

        if (acc.finishReason === "tool_calls" && acc.toolCalls.size > 0) {
          // Build the assistant message with tool_calls
          const toolCallsArray = Array.from(acc.toolCalls.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([, v]) => ({
              id: v.id ?? `call_${randomUUID()}`,
              type: "function" as const,
              function: { name: v.name, arguments: v.argumentsJson || "{}" },
            }));

          db.insertMessage({
            id: randomUUID(),
            conversationId: convId,
            role: "assistant",
            content: acc.content,
            reasoningContent: lastReasoning.length > 0 ? lastReasoning : null,
            mode: conv.mode,
            toolCallsJson: JSON.stringify(toolCallsArray),
          });

          messages.push({
            role: "assistant",
            content: acc.content || null,
            tool_calls: toolCallsArray,
          });

          // Execute each tool, write result to client + db, append to messages
          for (const tc of toolCallsArray) {
            const tool = getTool(tc.function.name);
            let output: string;
            if (!tool) {
              output = JSON.stringify({ error: `unknown tool '${tc.function.name}'` });
            } else {
              try {
                output = await tool.execute(tc.function.arguments);
              } catch (e) {
                output = JSON.stringify({
                  error: e instanceof Error ? e.message : "tool failure",
                });
              }
            }
            await writeChunk({
              tool_event: {
                id: tc.id,
                name: tc.function.name,
                arguments: tc.function.arguments,
                output,
              },
            });
            db.insertMessage({
              id: randomUUID(),
              conversationId: convId,
              role: "tool",
              content: output,
              toolCallId: tc.id,
              toolName: tc.function.name,
            });
            messages.push({
              role: "tool",
              content: output,
              tool_call_id: tc.id,
              name: tc.function.name,
            });
          }
          continue; // next iteration with extended messages
        }

        // No tool calls → final answer
        finalContent = acc.content;
        if (acc.content.length > 0 || acc.reasoning.length > 0) {
          db.insertMessage({
            id: randomUUID(),
            conversationId: convId,
            role: "assistant",
            content: acc.content,
            reasoningContent: acc.reasoning.length > 0 ? acc.reasoning : null,
            mode: conv.mode,
          });
        }
        db.touchConversation(convId);

        // Best-effort output moderation (non-blocking; only flag, do not retry)
        if (finalContent) {
          const m = moderate(finalContent, "assistant");
          if (!m.ok) {
            await writeChunk({
              moderation_warning: { reason: m.reason },
            });
            logWarn({
              event: "assistant_moderation_warning",
              requestId: c.get("requestId"),
              reason: m.reason,
            });
          }
        }
        await s.write("data: [DONE]\n\n");
        return;
      }

      // Hit the loop ceiling
      await writeChunk({
        error: { code: "TOOL_LOOP_LIMIT", message: "Tool call iterations exceeded limit" },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logWarn({ event: "chat_stream_error", requestId: c.get("requestId"), error: msg });
      await writeChunk({ error: { code: "STREAM_ERROR", message: msg } });
    } finally {
      // Ensure we always free the lock even on aborts; consumeUpstreamSse already releases.
      void finalContent;
      void finalReasoning;
    }
  });
});

// --- Optional: serve client SPA when SERVE_STATIC_DIR is set ---
// Set SERVE_STATIC_DIR=/path/to/client/dist to enable (used by Docker / single-process deploys).
// Static files are served first; if no file matches, requests fall through to API routes,
// and unmatched non-API GET requests fall back to index.html for client-side routing.
const staticDir = process.env.SERVE_STATIC_DIR?.trim();
if (staticDir) {
  if (!fs.existsSync(staticDir)) {
    console.warn(
      `SERVE_STATIC_DIR=${staticDir} does not exist; static serving disabled.`,
    );
  } else {
    const root = path.resolve(staticDir);
    const indexHtmlPath = path.join(root, "index.html");
    let indexHtmlCache: string | null = null;
    const readIndex = () => {
      if (indexHtmlCache !== null) return indexHtmlCache;
      indexHtmlCache = fs.existsSync(indexHtmlPath)
        ? fs.readFileSync(indexHtmlPath, "utf8")
        : null;
      return indexHtmlCache;
    };

    app.use("/*", serveStatic({ root }));

    app.notFound((c) => {
      const url = new URL(c.req.url);
      if (
        url.pathname.startsWith("/api/") ||
        url.pathname === "/health" ||
        url.pathname === "/ready"
      ) {
        return jsonErr(c, 404, "NOT_FOUND", `No route for ${url.pathname}`);
      }
      const html = readIndex();
      if (!html) return c.text("index.html missing", 500);
      return c.html(html);
    });
  }
}

// ---------- Organizations ----------

app.get("/api/orgs", requireBearer, (c) => {
  const uid = c.get("userId")!;
  const rows = db.listOrgsForUser(uid);
  return c.json({ orgs: rows });
});

app.post("/api/orgs", requireBearer, async (c) => {
  const uid = c.get("userId")!;
  const raw = await c.req.text();
  if (raw.length > 4096) return jsonErr(c, 413, "PAYLOAD_TOO_LARGE", "Body too large");
  let body: { name?: string };
  try {
    body = JSON.parse(raw) as { name?: string };
  } catch {
    return jsonErr(c, 400, "BAD_JSON", "Invalid JSON");
  }
  const name = body.name?.trim();
  if (!name || name.length > 80) {
    return jsonErr(c, 400, "VALIDATION_ERROR", "Org name required (1-80 chars)");
  }
  const id = randomUUID();
  const row = db.createOrg({ id, name, createdBy: uid });
  return c.json({ org: { ...row, role: "owner" as const } }, 201);
});

app.get("/api/orgs/:id/members", requireBearer, (c) => {
  const uid = c.get("userId")!;
  const orgId = c.req.param("id");
  if (!db.getOrgIfMember(orgId, uid)) {
    return jsonErr(c, 404, "NOT_FOUND", "Org not found or not a member");
  }
  return c.json({ members: db.listOrgMembers(orgId) });
});

app.post("/api/orgs/:id/members", requireBearer, async (c) => {
  const uid = c.get("userId")!;
  const orgId = c.req.param("id");
  if (!db.isOrgOwner(orgId, uid)) {
    return jsonErr(c, 403, "FORBIDDEN", "Only org owners can invite members");
  }
  const raw = await c.req.text();
  let body: { email?: string };
  try {
    body = JSON.parse(raw) as { email?: string };
  } catch {
    return jsonErr(c, 400, "BAD_JSON", "Invalid JSON");
  }
  const email = body.email?.trim().toLowerCase();
  if (!email || !validEmail(email)) {
    return jsonErr(c, 400, "INVALID_EMAIL", "Valid email required");
  }
  const u = db.getUserByEmail(email);
  if (!u) {
    return jsonErr(c, 404, "USER_NOT_FOUND", "No user with that email; ask them to register first");
  }
  db.addOrgMember({ orgId, userId: u.id, role: "member" });
  return c.json({ ok: true, members: db.listOrgMembers(orgId) });
});

app.delete("/api/orgs/:id/members/:userId", requireBearer, (c) => {
  const uid = c.get("userId")!;
  const orgId = c.req.param("id");
  const targetId = c.req.param("userId");
  if (!db.isOrgOwner(orgId, uid)) {
    return jsonErr(c, 403, "FORBIDDEN", "Only org owners can remove members");
  }
  if (targetId === uid) {
    return jsonErr(c, 400, "VALIDATION_ERROR", "Owner cannot remove themselves; delete the org instead");
  }
  const ok = db.removeOrgMember(orgId, targetId);
  if (!ok) return jsonErr(c, 404, "NOT_FOUND", "Member not found");
  return c.json({ ok: true });
});

app.delete("/api/orgs/:id", requireBearer, (c) => {
  const uid = c.get("userId")!;
  const orgId = c.req.param("id");
  if (!db.isOrgOwner(orgId, uid)) {
    return jsonErr(c, 403, "FORBIDDEN", "Only org owners can delete the org");
  }
  db.deleteOrg(orgId);
  return c.json({ ok: true });
});

// ---------- Documents (RAG-lite) ----------

const MAX_DOC_BYTES = 200 * 1024;

app.get("/api/documents", requireBearer, (c) => {
  const uid = c.get("userId")!;
  const orgIdParam = c.req.query("orgId");
  const orgId = orgIdParam && orgIdParam.length > 0 ? orgIdParam : null;
  if (orgId && !db.getOrgIfMember(orgId, uid)) {
    return jsonErr(c, 403, "FORBIDDEN", "Not a member of that org");
  }
  const rows = db.listDocuments(uid, { orgId });
  return c.json({
    documents: rows.map((r) => ({
      id: r.id,
      title: r.title,
      orgId: r.orgId,
      byteSize: r.byteSize,
      createdAt: r.createdAt,
    })),
  });
});

app.post("/api/documents", requireBearer, async (c) => {
  const uid = c.get("userId")!;
  const raw = await c.req.text();
  if (raw.length > MAX_DOC_BYTES + 4096) {
    return jsonErr(c, 413, "PAYLOAD_TOO_LARGE", "Document too large");
  }
  let body: { title?: string; content?: string; orgId?: string | null };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return jsonErr(c, 400, "BAD_JSON", "Invalid JSON");
  }
  const title = body.title?.trim();
  const content = body.content;
  if (!title || title.length > 200) {
    return jsonErr(c, 400, "VALIDATION_ERROR", "title required (1-200 chars)");
  }
  if (typeof content !== "string" || content.length === 0) {
    return jsonErr(c, 400, "VALIDATION_ERROR", "content required");
  }
  if (Buffer.byteLength(content, "utf8") > MAX_DOC_BYTES) {
    return jsonErr(c, 413, "PAYLOAD_TOO_LARGE", `Content exceeds ${MAX_DOC_BYTES} bytes`);
  }
  let orgId: string | null = null;
  if (body.orgId) {
    if (!db.getOrgIfMember(body.orgId, uid)) {
      return jsonErr(c, 403, "FORBIDDEN", "Not a member of that org");
    }
    orgId = body.orgId;
  }
  const id = randomUUID();
  const row = db.createDocument({ id, userId: uid, orgId, title, content });
  return c.json(
    {
      document: {
        id: row.id,
        title: row.title,
        orgId: row.orgId,
        byteSize: row.byteSize,
        createdAt: row.createdAt,
      },
    },
    201,
  );
});

app.get("/api/documents/search", requireBearer, (c) => {
  const uid = c.get("userId")!;
  const q = c.req.query("q") ?? "";
  const orgIdParam = c.req.query("orgId");
  const orgId = orgIdParam && orgIdParam.length > 0 ? orgIdParam : null;
  if (orgId && !db.getOrgIfMember(orgId, uid)) {
    return jsonErr(c, 403, "FORBIDDEN", "Not a member of that org");
  }
  const limit = Math.min(20, Math.max(1, Number(c.req.query("limit") ?? "5")));
  if (!q.trim()) return c.json({ hits: [] });
  const hits = db.searchDocuments(uid, q, { orgId, limit });
  return c.json({ hits });
});

app.get("/api/documents/:id", requireBearer, (c) => {
  const uid = c.get("userId")!;
  const id = c.req.param("id");
  const doc = db.getDocumentForUser(id, uid);
  if (!doc) return jsonErr(c, 404, "NOT_FOUND", "Document not found");
  return c.json({ document: doc });
});

app.delete("/api/documents/:id", requireBearer, (c) => {
  const uid = c.get("userId")!;
  const id = c.req.param("id");
  const ok = db.deleteDocument(id, uid);
  if (!ok) return jsonErr(c, 404, "NOT_FOUND", "Document not found");
  return c.json({ ok: true });
});

app.onError((err, c) => {
  const requestId = c.get("requestId") ?? "unknown";
  if (err instanceof HTTPException) {
    return c.json(
      { error: { code: String(err.status), message: err.message, requestId } },
      err.status,
    );
  }
  console.error(JSON.stringify({ level: "error", requestId, message: String(err) }));
  return c.json(
    { error: { code: "INTERNAL", message: "Internal server error", requestId } },
    500,
  );
});

function startupCheck() {
  try {
    getJwtSecret();
  } catch (e) {
    console.error(String(e));
    console.error("Set JWT_SECRET in server/.env (see .env.example).");
    process.exit(1);
  }
}

startupCheck();

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Server listening on http://localhost:${info.port}`);
});
