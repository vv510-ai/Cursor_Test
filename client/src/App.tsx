import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import "./App.css";
import { AuthPage } from "./AuthPage";
import { ParticleBackground } from "./ParticleBackground";
import { getAuthToken, setAuthToken } from "./authStorage";
import {
  apiJson,
  fetchJson,
  streamConversationChat,
  type ToolEvent,
} from "./streamDeepSeek";

type HealthPayload = {
  status: string;
  service: string;
  uptimeSeconds: number;
  config: {
    deepseekBaseUrlConfigured: boolean;
    deepseekApiKeyPresent: boolean;
    sqlitePath?: string;
    defaultModel?: string;
  };
};

type ReadyPayload =
  | { ready: true; upstream: string; probedUrl?: string }
  | {
      ready: false;
      reason?: string;
      message?: string;
      status?: number;
    };

type ConversationMode = "chat" | "reasoner";

type ConvSummary = {
  id: string;
  title: string;
  mode: ConversationMode;
  systemPrompt: string | null;
  temperature: number | null;
  maxTokens: number | null;
  orgId: string | null;
  createdAt: number;
  updatedAt: number;
};

type ApiMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  reasoningContent: string | null;
  mode: string | null;
  toolCallsJson: string | null;
  toolCallId: string | null;
  toolName: string | null;
  createdAt: number;
};

type UiToolInvocation = {
  id: string;
  name: string;
  arguments: string;
  output: string;
};

type UiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  toolInvocations?: UiToolInvocation[];
};

type Org = {
  id: string;
  name: string;
  role: "owner" | "member";
  createdAt: number;
};

type DocumentSummary = {
  id: string;
  title: string;
  orgId: string | null;
  byteSize: number;
  createdAt: number;
};

function apiBase(): string {
  // Build-time override (Vite). Empty / unset → use same origin as the page (Docker single-process deploy).
  const env = import.meta.env.VITE_API_URL?.trim();
  if (env) return env.replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "http://localhost:8787";
}

function mapApiToUi(msgs: ApiMessage[]): UiMessage[] {
  // Coalesce assistant tool_call rows + their tool result rows into the next assistant text bubble.
  // History order: user / assistant(tool_calls) / tool / tool / assistant(text) ...
  const out: UiMessage[] = [];
  let pendingTools: UiToolInvocation[] = [];
  const callMeta = new Map<string, { name: string; args: string }>();

  for (const m of msgs) {
    if (m.role === "system") continue;

    if (m.role === "assistant" && m.toolCallsJson) {
      try {
        const parsed = JSON.parse(m.toolCallsJson) as Array<{
          id: string;
          function: { name: string; arguments: string };
        }>;
        for (const tc of parsed) {
          callMeta.set(tc.id, { name: tc.function.name, args: tc.function.arguments });
        }
      } catch {
        /* ignore malformed */
      }
      continue; // do not render the tool-call assistant row directly; fold into next assistant
    }

    if (m.role === "tool") {
      const meta = callMeta.get(m.toolCallId ?? "");
      pendingTools.push({
        id: m.toolCallId ?? m.id,
        name: m.toolName ?? meta?.name ?? "tool",
        arguments: meta?.args ?? "{}",
        output: m.content,
      });
      continue;
    }

    if (m.role === "user" || m.role === "assistant") {
      out.push({
        id: m.id,
        role: m.role,
        content: m.content,
        reasoning: m.reasoningContent ?? undefined,
        toolInvocations: pendingTools.length > 0 ? pendingTools : undefined,
      });
      pendingTools = [];
    }
  }
  return out;
}

type Identity = {
  id: string;
  email: string;
  isAnonymous: boolean;
};

export default function App() {
  const base = useMemo(() => apiBase(), []);
  const [token, setTokenState] = useState<string | null>(() => getAuthToken());
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [showLogin, setShowLogin] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const existing = getAuthToken();

      if (existing) {
        try {
          const me = await apiJson<{ user: Identity }>("/api/auth/me", base);
          if (!cancelled) {
            setTokenState(existing);
            setIdentity(me.user);
            setAuthChecking(false);
          }
          return;
        } catch {
          // token invalid → fall through to anon-create
          setAuthToken(null);
        }
      }

      try {
        const r = await fetch(`${base.replace(/\/$/, "")}/api/auth/anonymous`, {
          method: "POST",
        });
        const data = (await r.json()) as {
          token?: string;
          user?: Identity;
          error?: { message?: string };
        };
        if (!r.ok || !data.token || !data.user) {
          throw new Error(data.error?.message ?? `HTTP ${r.status}`);
        }
        if (!cancelled) {
          setAuthToken(data.token);
          setTokenState(data.token);
          setIdentity(data.user);
          setBootError(null);
          setAuthChecking(false);
        }
      } catch (e) {
        if (!cancelled) {
          setBootError(e instanceof Error ? e.message : "无法初始化匿名会话");
          setAuthChecking(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [base]);

  const onAuthed = useCallback(
    async (newToken: string) => {
      setAuthToken(newToken);
      setTokenState(newToken);
      setShowLogin(false);
      try {
        const me = await apiJson<{ user: Identity }>("/api/auth/me", base);
        setIdentity(me.user);
      } catch {
        setIdentity(null);
      }
    },
    [base],
  );

  const onLogout = useCallback(() => {
    setAuthToken(null);
    setTokenState(null);
    setIdentity(null);
    setShowLogin(true);
  }, []);

  const onUseAnonymous = useCallback(() => {
    setAuthToken(null);
    setTokenState(null);
    setIdentity(null);
    setShowLogin(false);
    setAuthChecking(true);
    // Trigger the boot effect by forcing a remount via a microtask.
    // Simpler: directly call anonymous flow.
    void (async () => {
      try {
        const r = await fetch(`${base.replace(/\/$/, "")}/api/auth/anonymous`, {
          method: "POST",
        });
        const data = (await r.json()) as { token?: string; user?: Identity };
        if (r.ok && data.token && data.user) {
          setAuthToken(data.token);
          setTokenState(data.token);
          setIdentity(data.user);
        }
      } finally {
        setAuthChecking(false);
      }
    })();
  }, [base]);

  if (authChecking) {
    return (
      <>
        <ParticleBackground />
        <div className="app auth-checking app-front">
          <p className="muted">正在为你准备…</p>
        </div>
      </>
    );
  }

  if (bootError) {
    return (
      <>
        <ParticleBackground />
        <div className="app auth-checking app-front">
          <p className="muted">{bootError}</p>
          <button type="button" className="btn primary" onClick={() => window.location.reload()}>
            重试
          </button>
        </div>
      </>
    );
  }

  if (showLogin || !token) {
    return (
      <>
        <ParticleBackground />
        <AuthPage
          apiBase={base}
          onAuthed={onAuthed}
          onCancel={token ? () => setShowLogin(false) : onUseAnonymous}
          cancelLabel={token ? "返回" : "继续以匿名身份使用"}
        />
      </>
    );
  }

  return (
    <>
      <ParticleBackground />
      <ChatApp
        base={base}
        identity={identity}
        onLogout={onLogout}
        onSwitchAccount={() => setShowLogin(true)}
      />
    </>
  );
}

function ChatApp({
  base,
  identity,
  onLogout,
  onSwitchAccount,
}: {
  base: string;
  identity: Identity | null;
  onLogout: () => void;
  onSwitchAccount: () => void;
}) {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [ready, setReady] = useState<ReadyPayload | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  const [conversations, setConversations] = useState<ConvSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [mode, setMode] = useState<ConversationMode>("chat");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Phase 4 additions
  const [orgs, setOrgs] = useState<Org[]>([]);
  // null = personal scope
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [useDocs, setUseDocs] = useState(false);
  const [useTools, setUseTools] = useState(true);
  const [docsOpen, setDocsOpen] = useState(false);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const docFileInputRef = useRef<HTMLInputElement | null>(null);
  // Live-streaming tool events for the in-progress assistant message.
  const liveToolsRef = useRef<UiToolInvocation[]>([]);

  const activeConv = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const h = await fetchJson<HealthPayload>("/health", base);
        if (!cancelled) {
          setHealth(h);
          setHealthError(null);
        }
      } catch (e) {
        if (!cancelled)
          setHealthError(e instanceof Error ? e.message : "Health check failed");
      }
      try {
        const r = await fetch(`${base}/ready`);
        const body = (await r.json()) as ReadyPayload;
        if (!cancelled) setReady(body);
      } catch (e) {
        if (!cancelled)
          setReady({
            ready: false,
            reason: "fetch_failed",
            message: e instanceof Error ? e.message : String(e),
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base]);

  const loadConversation = useCallback(
    async (id: string) => {
      const data = await apiJson<{
        conversation: ConvSummary;
        messages: ApiMessage[];
      }>(`/api/conversations/${encodeURIComponent(id)}`, base);
      setMode(data.conversation.mode);
      setMessages(mapApiToUi(data.messages));
    },
    [base],
  );

  const refreshList = useCallback(async () => {
    const qs =
      activeOrgId === null
        ? "?scope=personal"
        : `?orgId=${encodeURIComponent(activeOrgId)}`;
    const data = await apiJson<{ conversations: ConvSummary[] }>(
      `/api/conversations${qs}`,
      base,
    );
    setConversations(data.conversations);
    return data.conversations;
  }, [base, activeOrgId]);

  const refreshOrgs = useCallback(async () => {
    try {
      const data = await apiJson<{ orgs: Org[] }>("/api/orgs", base);
      setOrgs(data.orgs);
      // If activeOrgId no longer exists, drop back to personal
      if (
        activeOrgId !== null &&
        !data.orgs.some((o) => o.id === activeOrgId)
      ) {
        setActiveOrgId(null);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("401")) setError(msg);
    }
  }, [base, activeOrgId]);

  const refreshDocs = useCallback(async () => {
    setDocsLoading(true);
    try {
      const qs =
        activeOrgId === null ? "" : `?orgId=${encodeURIComponent(activeOrgId)}`;
      const data = await apiJson<{ documents: DocumentSummary[] }>(
        `/api/documents${qs}`,
        base,
      );
      setDocuments(data.documents);
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法加载文档");
    } finally {
      setDocsLoading(false);
    }
  }, [base, activeOrgId]);

  // Initial: load orgs once
  useEffect(() => {
    void refreshOrgs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload conversations whenever the scope (personal/org) changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBooting(true);
      setError(null);
      try {
        const list = await refreshList();
        if (cancelled) return;
        if (list.length === 0) {
          const created = await apiJson<{ conversation: ConvSummary }>(
            "/api/conversations",
            base,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(activeOrgId ? { orgId: activeOrgId } : {}),
            },
          );
          if (cancelled) return;
          setConversations([created.conversation]);
          setActiveId(created.conversation.id);
          setMode(created.conversation.mode);
          setMessages([]);
        } else {
          setActiveId((prev) => {
            const exists = prev && list.some((c) => c.id === prev);
            return exists ? prev : list[0].id;
          });
        }
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "Failed to load conversations";
          setError(msg);
          if (msg.includes("401") || msg.includes("UNAUTHORIZED") || msg.includes("Invalid")) {
            onLogout();
          }
        }
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base, onLogout, refreshList, activeOrgId]);

  useEffect(() => {
    if (!activeId || booting) return;
    let cancelled = false;
    (async () => {
      try {
        await loadConversation(activeId);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load messages");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId, booting, loadConversation]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  }, []);

  const onNewChat = useCallback(async () => {
    setError(null);
    const created = await apiJson<{ conversation: ConvSummary }>(
      "/api/conversations",
      base,
      { method: "POST", body: "{}" },
    );
    await refreshList();
    setActiveId(created.conversation.id);
    setMode(created.conversation.mode);
    setMessages([]);
  }, [base, refreshList]);

  const onSelect = useCallback((id: string) => {
    if (id === activeId) return;
    setError(null);
    setActiveId(id);
  }, [activeId]);

  const onDelete = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!window.confirm("Delete this conversation?")) return;
      setError(null);
      await apiJson(`/api/conversations/${encodeURIComponent(id)}`, base, {
        method: "DELETE",
      });
      const next = await refreshList();
      if (next.length === 0) {
        const created = await apiJson<{ conversation: ConvSummary }>(
          "/api/conversations",
          base,
          { method: "POST", body: "{}" },
        );
        await refreshList();
        setActiveId(created.conversation.id);
        setMode(created.conversation.mode);
        setMessages([]);
        return;
      }
      if (activeId === id) {
        setActiveId(next[0].id);
      }
    },
    [activeId, base, refreshList],
  );

  const onModeChange = useCallback(
    async (next: ConversationMode) => {
      if (!activeId) return;
      setMode(next);
      setError(null);
      await apiJson(`/api/conversations/${encodeURIComponent(activeId)}`, base, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
      await refreshList();
    },
    [activeId, base, refreshList],
  );

  const onRename = useCallback(
    async (id: string, currentTitle: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const next = window.prompt("新名称", currentTitle)?.trim();
      if (!next || next === currentTitle) return;
      setError(null);
      try {
        await apiJson(`/api/conversations/${encodeURIComponent(id)}`, base, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: next.slice(0, 80) }),
        });
        await refreshList();
      } catch (err) {
        setError(err instanceof Error ? err.message : "重命名失败");
      }
    },
    [base, refreshList],
  );

  const onSaveSettings = useCallback(
    async (next: {
      systemPrompt: string | null;
      temperature: number | null;
      maxTokens: number | null;
    }) => {
      if (!activeId) return;
      setError(null);
      try {
        const data = await apiJson<{ conversation: ConvSummary }>(
          `/api/conversations/${encodeURIComponent(activeId)}`,
          base,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(next),
          },
        );
        setConversations((prev) =>
          prev.map((c) => (c.id === data.conversation.id ? data.conversation : c)),
        );
        setSettingsOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "保存设置失败");
      }
    },
    [activeId, base],
  );

  const onExportMarkdown = useCallback(() => {
    if (!activeConv) return;
    const lines: string[] = [];
    lines.push(`# ${activeConv.title}`);
    lines.push("");
    lines.push(`*导出时间：${new Date().toLocaleString()}*`);
    if (activeConv.systemPrompt) {
      lines.push("");
      lines.push("## System");
      lines.push("");
      lines.push("```");
      lines.push(activeConv.systemPrompt);
      lines.push("```");
    }
    for (const m of messages) {
      lines.push("");
      lines.push(m.role === "user" ? "## You" : "## Assistant");
      if (m.role === "assistant" && m.reasoning) {
        lines.push("");
        lines.push("<details><summary>Thinking</summary>");
        lines.push("");
        lines.push("```");
        lines.push(m.reasoning);
        lines.push("```");
        lines.push("");
        lines.push("</details>");
      }
      lines.push("");
      lines.push(m.content);
    }
    const blob = new Blob([lines.join("\n")], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safe = activeConv.title.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 60) || "chat";
    a.download = `${safe}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [activeConv, messages]);

  const onAttachFile = useCallback(
    async (file: File) => {
      const ALLOWED = /\.(txt|md|markdown|json|csv|log|tsv)$/i;
      const MAX_SIZE = 200 * 1024;
      if (!ALLOWED.test(file.name)) {
        setError("仅支持 .txt / .md / .json / .csv / .log / .tsv 等文本附件。");
        return;
      }
      if (file.size > MAX_SIZE) {
        setError(`附件过大（>${Math.round(MAX_SIZE / 1024)} KB），请压缩或截取片段。`);
        return;
      }
      try {
        const text = await file.text();
        const lang = /\.json$/i.test(file.name)
          ? "json"
          : /\.(md|markdown)$/i.test(file.name)
            ? "markdown"
            : /\.csv$/i.test(file.name)
              ? "csv"
              : "";
        const block = `\n\n--- 附件: ${file.name} ---\n\`\`\`${lang}\n${text}\n\`\`\`\n--- 附件结束 ---\n\n`;
        setInput((prev) => (prev ? `${prev}${block}` : block));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "读取附件失败");
      }
    },
    [],
  );

  const onCreateOrg = useCallback(async () => {
    const name = window.prompt("组织名称（1-80 字符）", "我的工作区")?.trim();
    if (!name) return;
    try {
      const created = await apiJson<{ org: Org }>("/api/orgs", base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      await refreshOrgs();
      setActiveOrgId(created.org.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建组织失败");
    }
  }, [base, refreshOrgs]);

  const onInviteMember = useCallback(
    async (orgId: string) => {
      const email = window.prompt("邀请用户的邮箱（必须已注册）")?.trim();
      if (!email) return;
      try {
        await apiJson(
          `/api/orgs/${encodeURIComponent(orgId)}/members`,
          base,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
          },
        );
        setError(null);
        alert(`已添加 ${email}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "邀请失败");
      }
    },
    [base],
  );

  const onUploadDocument = useCallback(
    async (file: File) => {
      const MAX = 200 * 1024;
      if (file.size > MAX) {
        setError(`文档过大（>${Math.round(MAX / 1024)} KB）`);
        return;
      }
      const text = await file.text();
      try {
        await apiJson("/api/documents", base, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: file.name,
            content: text,
            orgId: activeOrgId,
          }),
        });
        await refreshDocs();
      } catch (e) {
        setError(e instanceof Error ? e.message : "上传失败");
      }
    },
    [base, activeOrgId, refreshDocs],
  );

  const onDeleteDocument = useCallback(
    async (id: string) => {
      if (!window.confirm("删除这个文档？")) return;
      try {
        await apiJson(`/api/documents/${encodeURIComponent(id)}`, base, {
          method: "DELETE",
        });
        await refreshDocs();
      } catch (e) {
        setError(e instanceof Error ? e.message : "删除失败");
      }
    },
    [base, refreshDocs],
  );

  // Open the documents drawer → load on demand
  useEffect(() => {
    if (docsOpen) void refreshDocs();
  }, [docsOpen, refreshDocs]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || !activeId) return;

    const assistantId = crypto.randomUUID();
    const userMsg: UiMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };

    liveToolsRef.current = [];
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantId, role: "assistant", content: "", reasoning: "" },
    ]);
    setInput("");
    setError(null);
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamConversationChat({
        apiBase: base,
        conversationId: activeId,
        content: text,
        useDocs,
        useTools,
        signal: controller.signal,
        onDelta: ({ content, reasoning }) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: content ? m.content + content : m.content,
                    reasoning:
                      reasoning !== undefined && reasoning.length > 0
                        ? (m.reasoning ?? "") + reasoning
                        : m.reasoning,
                  }
                : m,
            ),
          );
        },
        onToolEvent: (ev: ToolEvent) => {
          liveToolsRef.current = [...liveToolsRef.current, ev];
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, toolInvocations: [...liveToolsRef.current] }
                : m,
            ),
          );
        },
        onModerationWarning: (reason) => {
          setError(`输出可能存在安全问题：${reason}`);
        },
        onUpstreamError: (msg) => {
          setError(msg);
        },
      });
      await loadConversation(activeId);
      await refreshList();
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        setError(null);
        await loadConversation(activeId);
        await refreshList();
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        if (msg.includes("401") || msg.includes("UNAUTHORIZED")) onLogout();
        setMessages((prev) => prev.filter((m) => m.id !== assistantId && m.id !== userMsg.id));
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [
    activeId,
    base,
    loadConversation,
    loading,
    onLogout,
    refreshList,
    useDocs,
    useTools,
  ]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const activeTitle = conversations.find((c) => c.id === activeId)?.title ?? "Chat";

  return (
    <div className="app app-front">
      <header className="top">
        <div className="brand">
          <span className="logo">DeepSeek</span>
          <span className="subtitle">{health?.config?.defaultModel ?? "deepseek-chat"}</span>
        </div>
        <div className="status-row">
          {identity?.isAnonymous ? (
            <>
              <span className="pill warn" title="数据按浏览器隔离；清除站点数据会丢失">
                匿名
              </span>
              <button
                type="button"
                className="btn ghost pill-btn"
                onClick={onSwitchAccount}
              >
                注册 / 登录
              </button>
            </>
          ) : (
            <>
              {identity?.email ? (
                <span className="pill" title={identity.email}>
                  {identity.email}
                </span>
              ) : null}
              <button type="button" className="btn ghost pill-btn" onClick={onLogout}>
                退出
              </button>
            </>
          )}
          <label className="pill org-switcher" title="切换工作区（个人 / 组织）">
            <span className="org-label">工作区</span>
            <select
              value={activeOrgId ?? ""}
              onChange={(e) => setActiveOrgId(e.target.value || null)}
            >
              <option value="">个人</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.role === "owner" ? " ★" : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="icon-edit"
              onClick={() => void onCreateOrg()}
              title="新建组织"
            >
              ＋
            </button>
            {activeOrgId && orgs.find((o) => o.id === activeOrgId)?.role === "owner" ? (
              <button
                type="button"
                className="icon-edit"
                onClick={() => void onInviteMember(activeOrgId)}
                title="邀请成员（按邮箱）"
              >
                👥
              </button>
            ) : null}
          </label>
          <span className="pill api">
            API: <code>{base}</code>
          </span>
          {healthError ? (
            <span className="pill bad">Health: {healthError}</span>
          ) : health ? (
            <span className="pill ok">
              Health ok · model <code>{health.config.defaultModel ?? "deepseek-chat"}</code> · key:{" "}
              {health.config.deepseekApiKeyPresent ? "yes (.env)" : "no"}
            </span>
          ) : (
            <span className="pill">Health …</span>
          )}
          {ready?.ready ? (
            <span className="pill ok">Upstream reachable</span>
          ) : ready && !ready.ready ? (
            <span className="pill warn" title={ready.message}>
              Ready: {ready.reason ?? "not_ready"}
            </span>
          ) : (
            <span className="pill">Ready …</span>
          )}
        </div>
      </header>

      <div className="app-layout">
        <aside className="sidebar" aria-label="Conversations">
          <div className="side-head">
            <button type="button" className="btn primary block" onClick={() => void onNewChat()}>
              New chat
            </button>
          </div>
          <ul className="conv-list">
            {conversations.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={`conv-item ${c.id === activeId ? "active" : ""}`}
                  onClick={() => onSelect(c.id)}
                  onDoubleClick={(e) => void onRename(c.id, c.title, e)}
                  title="双击重命名"
                >
                  <span className="conv-title">{c.title}</span>
                  <span className="conv-meta">{c.mode === "reasoner" ? "R" : "C"}</span>
                </button>
                <button
                  type="button"
                  className="icon-edit"
                  title="重命名"
                  onClick={(e) => void onRename(c.id, c.title, e)}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="icon-del"
                  title="删除"
                  onClick={(e) => void onDelete(c.id, e)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <main className="chat">
          <div className="chat-head">
            <h1 className="thread-title">{activeTitle}</h1>
            {booting ? <span className="muted">Loading…</span> : null}
          </div>

          <div className="toolbar">
            <label className="model-label">
              Mode（upstream 固定 <code>deepseek-chat</code>）
              <select
                value={mode}
                onChange={(e) => void onModeChange(e.target.value as ConversationMode)}
                disabled={loading || !activeId}
              >
                <option value="chat">对话 · thinking off</option>
                <option value="reasoner">推理 · thinking on</option>
              </select>
            </label>
            <div className="toolbar-actions">
              <label className="toggle" title="发送时让助手可调用 calculator / current_time 工具">
                <input
                  type="checkbox"
                  checked={useTools}
                  onChange={(e) => setUseTools(e.target.checked)}
                />
                工具
              </label>
              <label
                className="toggle"
                title="发送时把当前消息当作查询，从你的文档库中检索片段并注入上下文"
              >
                <input
                  type="checkbox"
                  checked={useDocs}
                  onChange={(e) => setUseDocs(e.target.checked)}
                />
                @docs
              </label>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setDocsOpen(true)}
                title="管理文档（用于 RAG-lite 检索）"
              >
                文档
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setSettingsOpen(true)}
                disabled={!activeId}
                title="系统提示词 / 温度 / max_tokens"
              >
                设置
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={onExportMarkdown}
                disabled={!activeId || messages.length === 0}
                title="导出当前会话为 Markdown 文件"
              >
                导出 .md
              </button>
              {loading ? (
                <button type="button" className="btn ghost" onClick={stop}>
                  Stop
                </button>
              ) : null}
            </div>
          </div>

          <div className="messages">
            {!booting && messages.length === 0 && (
              <p className="empty">
                登录后会话按用户隔离；上游模型固定为 <code>deepseek-chat</code>，通过{" "}
                <code>thinking</code> / <code>reasoning_effort</code> 区分模式。助手回复使用 Markdown（已做{" "}
                <code>rehype-sanitize</code> 净化）。
              </p>
            )}
            {messages.map((m) => (
              <article key={m.id} className={`bubble ${m.role}`}>
                <div className="meta">{m.role === "user" ? "You" : "Assistant"}</div>
                {m.role === "assistant" && m.reasoning ? (
                  <details className="reasoning" open>
                    <summary>Thinking</summary>
                    <pre className="reasoning-body">{m.reasoning}</pre>
                  </details>
                ) : null}
                {m.role === "assistant" && m.toolInvocations && m.toolInvocations.length > 0 ? (
                  <div className="tool-invocations">
                    {m.toolInvocations.map((t) => (
                      <details key={t.id} className="tool-call">
                        <summary>
                          <code className="tool-name">🛠 {t.name}</code>{" "}
                          <span className="tool-args">{truncate(t.arguments, 80)}</span>
                        </summary>
                        <div className="tool-detail">
                          <div className="tool-section-label">参数</div>
                          <pre>{prettyJson(t.arguments)}</pre>
                          <div className="tool-section-label">输出</div>
                          <pre>{prettyJson(t.output)}</pre>
                        </div>
                      </details>
                    ))}
                  </div>
                ) : null}
                {m.role === "assistant" && m.content ? (
                  <div className="body md">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeSanitize]}
                      components={{
                        a: ({ node: _n, ...props }) => (
                          <a
                            {...props}
                            target="_blank"
                            rel="noopener noreferrer"
                          />
                        ),
                      }}
                    >
                      {m.content}
                    </ReactMarkdown>
                  </div>
                ) : m.role === "user" ? (
                  <div className="body">{m.content}</div>
                ) : m.role === "assistant" && loading ? (
                  <div className="typing">…</div>
                ) : null}
              </article>
            ))}
            <div ref={bottomRef} />
          </div>

          {error ? (
            <div className="banner error" role="alert">
              {error}
            </div>
          ) : null}

          <div className="composer">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="消息… (Enter 发送，Shift+Enter 换行)"
              rows={3}
              disabled={loading || booting || !activeId}
            />
            <div className="composer-actions">
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.markdown,.json,.csv,.log,.tsv"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onAttachFile(f);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                className="btn ghost"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading || booting || !activeId}
                title="添加文本附件（拼接到当前输入）"
              >
                附件
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => void send()}
                disabled={loading || booting || !activeId || !input.trim()}
              >
                Send
              </button>
            </div>
          </div>
        </main>
      </div>

      {settingsOpen && activeConv ? (
        <SettingsDialog
          conv={activeConv}
          onClose={() => setSettingsOpen(false)}
          onSave={(next) => void onSaveSettings(next)}
        />
      ) : null}

      {docsOpen ? (
        <DocumentsDrawer
          docs={documents}
          loading={docsLoading}
          orgLabel={
            activeOrgId === null
              ? "个人"
              : orgs.find((o) => o.id === activeOrgId)?.name ?? "组织"
          }
          onClose={() => setDocsOpen(false)}
          onUpload={() => docFileInputRef.current?.click()}
          onDelete={(id) => void onDeleteDocument(id)}
        />
      ) : null}

      <input
        ref={docFileInputRef}
        type="file"
        accept=".txt,.md,.markdown,.json,.csv,.log,.tsv"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onUploadDocument(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function prettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

function DocumentsDrawer({
  docs,
  loading,
  orgLabel,
  onClose,
  onUpload,
  onDelete,
}: {
  docs: DocumentSummary[];
  loading: boolean;
  orgLabel: string;
  onClose: () => void;
  onUpload: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal docs-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-head">
          <h2>文档（{orgLabel}）</h2>
          <button type="button" className="icon-del" onClick={onClose} title="关闭">
            ×
          </button>
        </div>

        <p className="muted small">
          上传 .txt / .md / .json / .csv / .log / .tsv（≤200 KB）。勾选 <code>@docs</code>{" "}
          后，发送的消息会做关键字检索（SQLite FTS5），把匹配片段作为上下文注入。
          <br />
          这是 <strong>RAG-lite</strong>：基于关键字而非向量；语义检索请等下一阶段升级到 pgvector / Qdrant。
        </p>

        <div className="docs-actions">
          <button type="button" className="btn primary" onClick={onUpload}>
            上传
          </button>
        </div>

        {loading ? (
          <p className="muted">加载中…</p>
        ) : docs.length === 0 ? (
          <p className="muted">还没有文档。上传一个开始吧。</p>
        ) : (
          <ul className="docs-list">
            {docs.map((d) => (
              <li key={d.id} className="doc-item">
                <div className="doc-meta">
                  <span className="doc-title">{d.title}</span>
                  <span className="doc-size">{Math.round(d.byteSize / 1024)} KB</span>
                </div>
                <button
                  type="button"
                  className="icon-del"
                  onClick={() => onDelete(d.id)}
                  title="删除"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SettingsDialog({
  conv,
  onClose,
  onSave,
}: {
  conv: ConvSummary;
  onClose: () => void;
  onSave: (next: {
    systemPrompt: string | null;
    temperature: number | null;
    maxTokens: number | null;
  }) => void;
}) {
  const [systemPrompt, setSystemPrompt] = useState(conv.systemPrompt ?? "");
  const [temperature, setTemperature] = useState<string>(
    conv.temperature == null ? "" : String(conv.temperature),
  );
  const [maxTokens, setMaxTokens] = useState<string>(
    conv.maxTokens == null ? "" : String(conv.maxTokens),
  );

  const submit = () => {
    const sp = systemPrompt.trim();
    const tStr = temperature.trim();
    const mStr = maxTokens.trim();
    let t: number | null = null;
    let m: number | null = null;
    if (tStr) {
      const n = Number(tStr);
      if (!Number.isFinite(n) || n < 0 || n > 2) {
        alert("温度必须是 [0, 2] 区间的数字");
        return;
      }
      t = n;
    }
    if (mStr) {
      const n = Number(mStr);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 32000) {
        alert("max_tokens 必须是 [1, 32000] 之间的整数");
        return;
      }
      m = n;
    }
    onSave({
      systemPrompt: sp.length > 0 ? sp : null,
      temperature: t,
      maxTokens: m,
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>会话设置</h2>
          <button type="button" className="icon-del" onClick={onClose} title="关闭">
            ×
          </button>
        </div>

        <label className="form-field">
          系统提示词（system prompt）
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={6}
            maxLength={8000}
            placeholder="例如：你是一个简洁的 TypeScript 助手，回答尽量短。"
          />
          <small className="muted">
            最多 8000 字符；留空则不发送 system 消息。仅对该会话生效。
          </small>
        </label>

        <div className="form-row">
          <label className="form-field">
            温度（0–2，留空使用模型默认）
            <input
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
              placeholder="例如 0.7"
            />
          </label>

          <label className="form-field">
            max_tokens（留空表示不限制）
            <input
              type="number"
              step="1"
              min="1"
              max="32000"
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value)}
              placeholder="例如 2048"
            />
          </label>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn primary" onClick={submit}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
