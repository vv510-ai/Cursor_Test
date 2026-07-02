"use client";

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
  "我是大二学生，两周后期末，想先攻克二叉树和动态规划",
  "为我生成二叉树的全套学习资源",
  "为什么 Dijkstra 算法不能处理负权边？",
  "我总是混淆快排和归并的稳定性，出几道题考考我",
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
              if (ev.items?.length) {
                patchLast((a) => ({ ...a, citations: Array.from(new Set([...a.citations, ...ev.items!])) }));
              }
              break;
            case "summary":
              patchLast((a) => ({ ...a, text: a.text || (ev.text as string) || "" }));
              break;
            case "error":
              patchLast((a) => ({ ...a, text: a.text + `\n\n> 服务异常：${ev.detail || "请稍后重试"}`, streaming: false }));
              setBusy(false);
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
    <div className="glass-panel flex h-[calc(100vh-9rem)] min-h-[560px] flex-col overflow-hidden rounded-xl">
      <div className="border-b border-slate-200 bg-white/70 px-5 py-4">
        <div className="font-mono text-[10px] tracking-[0.24em] text-blue-600">MULTI-AGENT TUTORING</div>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-black leading-tight tracking-tight text-slate-950 sm:text-2xl">
              说出学习目标，系统拆解、检索、生成、评估
            </h1>
            <p className="mt-1 text-sm text-slate-500">画像、规划、路径、资源与质检会在右侧实时展开。</p>
          </div>
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700">
            当前用户：demo_user
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {msgs.length === 0 && (
          <div className="mx-auto grid max-w-3xl gap-3 pt-4 sm:grid-cols-2">
            {STARTERS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="rounded-xl border border-slate-200 bg-white p-4 text-left text-sm text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
              >
                <span className="mb-2 block font-mono text-[10px] tracking-[0.2em] text-blue-500">TRY THIS</span>
                {s}
              </button>
            ))}
          </div>
        )}

        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[82%] rounded-2xl rounded-br-md bg-blue-600 px-4 py-2.5 text-sm leading-6 text-white shadow-sm">
                {m.text}
              </div>
            </div>
          ) : (
            <div key={i} className="flex gap-3">
              <div className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-orange-200 bg-orange-50 font-mono text-[10px] font-bold text-orange-700">
                AI
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                {(m.text || m.streaming) && (
                  <div className="rounded-2xl rounded-tl-md border border-slate-200 bg-white px-4 py-3 shadow-sm">
                    <Markdown text={m.text} streaming={m.streaming} />
                    {m.citations.length > 0 && !m.streaming && (
                      <div className="mt-3 border-t border-slate-200 pt-2">
                        {m.citations.map((c, j) => (
                          <div key={j} className="text-xs leading-5 text-slate-500">
                            <span className="font-mono text-orange-600">[{j + 1}]</span> {c}
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

      <div className="border-t border-slate-200 bg-white/80 p-4">
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
            placeholder="例如：帮我规划二叉树复习路径，顺便生成图文、题目和讲解视频"
            className="max-h-28 flex-1 resize-none rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
          />
          {busy ? (
            <button
              onClick={() => abortRef.current?.()}
              className="h-11 shrink-0 rounded-lg border border-orange-300 px-4 text-sm font-semibold text-orange-700 hover:bg-orange-50"
            >
              停止
            </button>
          ) : (
            <button
              onClick={() => send(input)}
              disabled={!input.trim()}
              className="h-11 shrink-0 rounded-lg bg-blue-600 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              发送
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
