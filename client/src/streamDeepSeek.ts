import { getAuthToken } from "./authStorage";

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

type StreamDelta = {
  content: string;
  reasoning: string;
};

export type ToolEvent = {
  id: string;
  name: string;
  arguments: string;
  output: string;
};

export function joinBase(path: string, apiBase: string): string {
  const base = apiBase.replace(/\/$/, "");
  return path.startsWith("http") ? path : `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function withAuthHeaders(init?: RequestInit): RequestInit {
  const h = new Headers(init?.headers);
  const token = getAuthToken();
  if (token) h.set("Authorization", `Bearer ${token}`);
  return { ...init, headers: h };
}

/**
 * 已知服务端错误码 → 中文友好文案。未命中时回退到后端 message。
 */
const FRIENDLY: Record<string, string> = {
  RATE_LIMIT: "请求过于频繁，请稍后再试。",
  DAILY_QUOTA: "今日对话额度已用尽，请明天再来。",
  UPSTREAM_NOT_CONFIGURED: "服务端未配置 DEEPSEEK_API_KEY，暂时无法对话。",
  UPSTREAM_ERROR: "上游模型请求失败，请稍后重试。",
  UPSTREAM_EMPTY: "上游模型返回为空，请重试。",
  PAYLOAD_TOO_LARGE: "内容超出长度上限。",
  CONTEXT_TOO_LARGE: "对话上下文过长，建议新建一个会话。",
  BAD_JSON: "请求格式有误。",
  VALIDATION_ERROR: "请求内容不合法。",
  INVALID_EMAIL: "邮箱格式不正确。",
  WEAK_PASSWORD: "密码至少 8 位。",
  EMAIL_IN_USE: "该邮箱已被注册。",
  INVALID_CREDENTIALS: "邮箱或密码错误。",
  UNAUTHORIZED: "登录已过期，请重新登录。",
  NOT_FOUND: "资源不存在或已被删除。",
  CONTENT_BLOCKED: "内容被安全策略拦截。",
  FORBIDDEN: "你没有访问该资源的权限。",
  USER_NOT_FOUND: "用户不存在。",
  TOOL_LOOP_LIMIT: "工具调用循环过深，请简化请求。",
  STREAM_ERROR: "流式响应发生错误。",
};

function parseApiError(res: Response, bodyText: string): string {
  try {
    const j = JSON.parse(bodyText) as {
      error?:
        | string
        | { message?: string; code?: string; detail?: string };
      message?: string;
      detail?: string;
    };
    if (typeof j.error === "object" && j.error) {
      const code = j.error.code;
      if (code && FRIENDLY[code]) return FRIENDLY[code];
      if (j.error.message) return j.error.message;
    }
    if (typeof j.error === "string") return j.error;
    return j.message ?? j.detail ?? bodyText;
  } catch {
    if (res.status === 429) return FRIENDLY.RATE_LIMIT;
    if (res.status === 401) return FRIENDLY.UNAUTHORIZED;
    if (res.status === 404) return FRIENDLY.NOT_FOUND;
    return bodyText || `HTTP ${res.status}`;
  }
}

/**
 * Authenticated API fetch (`Authorization: Bearer <JWT>`).
 */
export function apiFetch(
  path: string,
  apiBase: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(joinBase(path, apiBase), withAuthHeaders(init));
}

/**
 * Public JSON — health / ready（无需登录）.
 */
export async function fetchJson<T>(path: string, apiBase: string): Promise<T> {
  const res = await fetch(joinBase(path, apiBase));
  const text = await res.text();
  if (!res.ok) throw new Error(parseApiError(res, text));
  return JSON.parse(text) as T;
}

/**
 * JSON API（需已登录）.
 */
export async function apiJson<T>(
  path: string,
  apiBase: string,
  init?: RequestInit,
): Promise<T> {
  const res = await apiFetch(path, apiBase, init);
  const text = await res.text();
  if (!res.ok) throw new Error(parseApiError(res, text));
  return JSON.parse(text) as T;
}

type StreamCallbacks = {
  onDelta: (d: StreamDelta) => void;
  onToolEvent?: (ev: ToolEvent) => void;
  onModerationWarning?: (reason: string) => void;
  onUpstreamError?: (msg: string) => void;
};

async function pipeSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  cb: StreamCallbacks,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";

    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      let json: unknown;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      const root = json as {
        choices?: Array<{
          delta?: { content?: string | null; reasoning_content?: string | null };
        }>;
        tool_event?: ToolEvent;
        moderation_warning?: { reason?: string };
        error?: { code?: string; message?: string; detail?: string };
      };

      if (root.error) {
        cb.onUpstreamError?.(root.error.message ?? root.error.code ?? "stream error");
        continue;
      }
      if (root.tool_event && cb.onToolEvent) {
        cb.onToolEvent(root.tool_event);
        continue;
      }
      if (root.moderation_warning?.reason && cb.onModerationWarning) {
        cb.onModerationWarning(root.moderation_warning.reason);
        continue;
      }

      const delta = root.choices?.[0]?.delta;
      const content =
        typeof delta?.content === "string" && delta.content.length > 0 ? delta.content : "";
      const reasoning =
        typeof delta?.reasoning_content === "string" && delta.reasoning_content.length > 0
          ? delta.reasoning_content
          : "";
      if (content || reasoning) cb.onDelta({ content, reasoning });
    }
  }
}

export async function streamConversationChat(options: {
  apiBase: string;
  conversationId: string;
  content: string;
  useDocs?: boolean;
  useTools?: boolean;
  signal: AbortSignal;
  onDelta: (d: StreamDelta) => void;
  onToolEvent?: (ev: ToolEvent) => void;
  onModerationWarning?: (reason: string) => void;
  onUpstreamError?: (msg: string) => void;
}): Promise<void> {
  const {
    apiBase,
    conversationId,
    content,
    useDocs,
    useTools,
    signal,
    onDelta,
    onToolEvent,
    onModerationWarning,
    onUpstreamError,
  } = options;
  const res = await apiFetch(
    `/api/conversations/${encodeURIComponent(conversationId)}/chat`,
    apiBase,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, useDocs: !!useDocs, useTools: useTools !== false }),
      signal,
    },
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(parseApiError(res, errText));
  }

  if (!res.body) throw new Error("Empty response body");
  await pipeSseStream(res.body.getReader(), {
    onDelta,
    onToolEvent,
    onModerationWarning,
    onUpstreamError,
  });
}
