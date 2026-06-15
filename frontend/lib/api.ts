import type { SparkEvent } from "./types";

/** 所有请求经 Next BFF(app/api/[...path]/route.ts)转发到后端,规避浏览器 CORS。 */
const BASE = "/api";

/** POST + SSE:逐事件回调;返回 abort 函数。 */
export function postSSE(
  path: string,
  body: unknown,
  onEvent: (ev: SparkEvent) => void,
  onClose?: () => void,
): () => void {
  const ctrl = new AbortController();
  (async () => {
    try {
      const res = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        onEvent({ type: "error", detail: `HTTP ${res.status}` });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          try {
            onEvent(JSON.parse(line.slice(6)) as SparkEvent);
          } catch {
            /* 跳过坏帧 */
          }
        }
      }
    } catch (e: unknown) {
      if ((e as Error)?.name !== "AbortError")
        onEvent({ type: "error", detail: String(e) });
    } finally {
      onClose?.();
    }
  })();
  return () => ctrl.abort();
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const USER_ID = "demo_user";
