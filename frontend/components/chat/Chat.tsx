"use client";
/** Chat —— 学习对话主组件:
 *  任意自然语言 → POST /api/chat(SSE)→ Orchestrator 意图路由;
 *  token 流入当前助手消息,resource 事件落成内嵌卡片,profile/path 事件上抛给页面
 *  (右侧遥测面板与画像雷达据此实时刷新)。 */
import { useCallback, useEffect, useRef, useState } from "react";
import { USER_ID, postSSE } from "@/lib/api";
import type { ResourceItem, SparkEvent } from "@/lib/types";
import Markdown from "./Markdown";
import ResourceCard from "@/components/resource/ResourceCard";

interface Msg {
  role: "user" | "assistant";
  text: string;
  resources: ResourceItem[];
  citations: string[];
  streaming?: boolean;
}

const STARTERS = [
  "我是大二学生,两周后期末考,想先攻克二叉树和动态规划",
  "为我生成「二叉树」的全套学习资源",
  "为什么 Dijkstra 算法不能处理负权边?",
  "我总是搞混快排和归并的稳定性,出几道题考考我",
];

export default function Chat({ onEvent }: { onEvent?: (ev: SparkEvent) => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<(() => void) | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef(`s-${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs]);

  const send = useCallback(
    (text: string) => {
      const q = text.trim();
      if (!q || busy) return;
      setInput("");
      setBusy(true);
      setMsgs((m) => [
        ...m,
        { role: "user", text: q, resources: [], citations: [] },
        { role: "assistant", text: "", resources: [], citations: [], streaming: true },
      ]);

      const patchLast = (fn: (a: Msg) => Msg) =>
        setMsgs((m) => {
          const out = [...m];
          out[out.length - 1] = fn(out[out.length - 1]);
          return out;
        });

      abortRef.current = postSSE(
        "/chat",
        { user_id: USER_ID, session_id: sessionRef.current, message: q },
        (ev) => {
          onEvent?.(ev);
          switch (ev.type) {
            case "token":
              patchLast((a) => ({ ...a, text: a.text + (ev.delta || "") }));
              break;
            case "resource":
              if (ev.resource) patchLast((a) => ({ ...a, resources: [...a.resources, ev.resource!] }));
              break;
            case "citations":
              if (ev.items?.length)
                patchLast((a) => ({ ...a, citations: Array.from(new Set([...a.citations, ...ev.items!])) }));
              break;
            case "summary":
              patchLast((a) => ({ ...a, text: a.text || (ev.text as string) || "" }));
              break;
            case "error":
              patchLast((a) => ({ ...a, text: a.text + `\n\n> ⚠️ ${ev.detail || "服务异常"}` }));
              break;
            case "done":
              patchLast((a) => ({ ...a, streaming: false }));
              setBusy(false);
              break;
          }
        },
        () => {
          setBusy(false);
          patchLast((a) => ({ ...a, streaming: false }));
        },
      );
    },
    [busy, onEvent],
  );

  return (
    <div className="flex h-[calc(100vh-7.5rem)] flex-col rounded-xl border border-hairline bg-panel/30">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {msgs.length === 0 && (
          <div className="mx-auto mt-14 max-w-md text-center">
            <div className="font-mono text-[10px] tracking-[0.3em] text-spark">MULTI-AGENT TUTORING</div>
            <h1 className="mt-2 text-xl font-bold text-slate-100">
              说出你的目标,九个智能体开始协同
            </h1>
            <p className="mt-2 text-xs leading-6 text-muted">
              画像 · 规划 · 路径 · 文档 / 脑图 / 题库 / 视频并行生成 · 质检评估 —— 右侧遥测面板实时可见。
            </p>
            <div className="mt-5 grid gap-2">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-lg border border-hairline bg-panel/60 px-3 py-2 text-left text-xs text-body transition hover:border-spark/50 hover:text-slate-100"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[78%] rounded-2xl rounded-br-sm bg-spark/15 px-3.5 py-2 text-[13px] text-slate-100">
                {m.text}
              </div>
            </div>
          ) : (
            <div key={i} className="flex gap-2.5">
              <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-ember/50 bg-panel font-mono text-[9px] text-ember">
                AI
              </div>
              <div className="min-w-0 flex-1 space-y-2.5">
                {(m.text || m.streaming) && (
                  <div className="rounded-2xl rounded-tl-sm border border-hairline bg-panel/70 px-3.5 py-2.5">
                    <Markdown text={m.text} streaming={m.streaming} />
                    {m.citations.length > 0 && !m.streaming && (
                      <div className="mt-2 border-t border-hairline/60 pt-1.5">
                        {m.citations.map((c, j) => (
                          <div key={j} className="text-[10.5px] leading-5 text-muted">
                            <span className="font-mono text-ember/80">[{j + 1}]</span> {c}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {m.resources.map((r) => (
                  <ResourceCard key={r.id} r={r} />
                ))}
              </div>
            </div>
          ),
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-hairline p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder="例:帮我规划复习路径 / 讲讲堆排序 / 出 5 道哈希表的题…(Enter 发送)"
            className="max-h-28 flex-1 resize-none rounded-lg border border-hairline bg-ink/70 px-3 py-2.5 text-[13px] text-body outline-none transition focus:border-spark/60"
          />
          {busy ? (
            <button
              onClick={() => abortRef.current?.()}
              className="h-10 shrink-0 rounded-lg border border-ember/60 px-4 text-sm text-ember hover:bg-ember/10"
            >
              停止
            </button>
          ) : (
            <button
              onClick={() => send(input)}
              disabled={!input.trim()}
              className="h-10 shrink-0 rounded-lg bg-spark px-5 text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-40"
            >
              发送
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
