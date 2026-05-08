import { useState } from "react";
import "./AuthPage.css";

type Props = {
  apiBase: string;
  onAuthed: (token: string) => void;
  onCancel?: () => void;
  cancelLabel?: string;
};

const AUTH_FRIENDLY: Record<string, string> = {
  INVALID_EMAIL: "邮箱格式不正确。",
  WEAK_PASSWORD: "密码至少 8 位。",
  EMAIL_IN_USE: "该邮箱已被注册，请直接登录。",
  INVALID_CREDENTIALS: "邮箱或密码错误。",
  RATE_LIMIT: "请求过于频繁，请稍后再试。",
  PAYLOAD_TOO_LARGE: "提交内容过大。",
  BAD_JSON: "请求格式有误。",
};

export function AuthPage({ apiBase, onAuthed, onCancel, cancelLabel }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const path = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const res = await fetch(`${apiBase.replace(/\/$/, "")}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = (await res.json()) as {
        token?: string;
        error?: { code?: string; message?: string };
      };
      if (!res.ok) {
        const code = data.error?.code;
        const msg =
          (code && AUTH_FRIENDLY[code]) ||
          data.error?.message ||
          `HTTP ${res.status}`;
        throw new Error(msg);
      }
      if (data.token) onAuthed(data.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title">登录或注册</h1>
        <p className="auth-sub">登录后会话永久绑定该账号；返回后仍可继续匿名使用。</p>
        <div className="auth-tabs">
          <button
            type="button"
            className={mode === "login" ? "active" : ""}
            onClick={() => setMode("login")}
          >
            Login
          </button>
          <button
            type="button"
            className={mode === "register" ? "active" : ""}
            onClick={() => setMode("register")}
          >
            Register
          </button>
        </div>
        <form onSubmit={(e) => void submit(e)}>
          <label className="auth-field">
            Email
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="auth-field">
            Password
            <input
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </label>
          {error ? (
            <div className="auth-error" role="alert">
              {error}
            </div>
          ) : null}
          <button type="submit" className="btn primary auth-submit" disabled={loading}>
            {loading ? "…" : mode === "login" ? "登录" : "创建账号"}
          </button>
          {onCancel ? (
            <button
              type="button"
              className="btn ghost auth-cancel"
              onClick={onCancel}
              disabled={loading}
            >
              {cancelLabel ?? "取消"}
            </button>
          ) : null}
        </form>
      </div>
    </div>
  );
}
