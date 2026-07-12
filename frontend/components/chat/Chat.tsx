"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { USER_ID, postSSE } from "@/lib/api";
import { useView } from "@/components/view/ViewContext";
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
  "我是大二学生,两周后期末,想先攻克二叉树和动态规划",
  "二叉树遍历应该按什么顺序学?",
  "为什么 Dijkstra 算法不能处理负权边?",
  "为什么快排通常不稳定,而归并排序稳定?",
];

const FLOW = [
  ["01", "定位重点", "找到薄弱处"],
  ["02", "形成路线", "排出顺序"],
  ["03", "配套资料", "讲义/脑图/练习"],
  ["04", "练习校准", "结果同步更新"],
];

export default function Chat({
  onEvent,
  seed,
  request,
  onSeedConsumed,
  onQuizEvaluated,
}: {
  onEvent?: (ev: SparkEvent) => void;
  /** 外部(首页快捷入口)注入的一次性发送内容 */
  seed?: string;
  request?: { path: string; body: Record<string, unknown>; display: string };
  onSeedConsumed?: () => void;
  onQuizEvaluated?: (report: { path?: import("@/lib/types").PathPlan; profile_version?: number }) => void;
}) {
  const { view } = useView();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [queuedHint, setQueuedHint] = useState("");
  const abortRef = useRef<(() => void) | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef(`s-${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs]);

  const send = useCallback(
    (text: string, directRequest?: { path: string; body: Record<string, unknown>; display: string }) => {
      const q = text.trim();
      if (!q) return;
      if (busy) {
        setQueuedHint("当前任务还在整理中。可以先停止，再开始新的任务。");
        return;
      }
      setQueuedHint("");
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
        directRequest?.path || "/chat",
        directRequest?.body || { user_id: USER_ID, session_id: sessionRef.current, message: q },
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
              if (ev.items?.length && (!directRequest || directRequest.path === "/chat")) {
                patchLast((a) => ({ ...a, citations: Array.from(new Set([...a.citations, ...ev.items!])) }));
              }
              break;
            case "summary":
              patchLast((a) => ({ ...a, text: a.text || (ev.text as string) || "" }));
              break;
            case "error":
              patchLast((a) => ({ ...a, text: a.text + `\n\n> 服务异常:${ev.detail || "请稍后重试"}`, streaming: false }));
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

  useEffect(() => {
    if (seed && !busy) {
      send(seed);
      onSeedConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  useEffect(() => {
    if (request && !busy) {
      send(request.display, request);
      onSeedConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  useEffect(() => {
    return () => abortRef.current?.();
  }, []);

  return (
    <div className="flex h-[calc(100vh-15rem)] min-h-[520px] flex-col overflow-hidden rounded-[14px] border border-[#E5E9E3] bg-white shadow-[0_1px_2px_rgba(18,30,22,0.05),0_6px_20px_rgba(18,30,22,0.06)]">
      <div className="border-b border-[#E5E9E3] bg-[#FBFCFA] px-5 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold tracking-[0.18em] text-emerald-700">学习目标</div>
            <h2 className="mt-0.5 text-lg font-bold leading-tight tracking-tight text-[#182119]">
              写下目标，系统整理学习安排
            </h2>
          </div>
          <div className="rounded-full border border-emerald-100 bg-[#E3F0E9] px-3 py-1.5 text-xs font-medium text-emerald-800">
            当前学习档案
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {msgs.length === 0 && (
          <div className="mx-auto max-w-3xl space-y-4 pt-2">
            <div className="rounded-[14px] border border-[#D2DAD2] bg-[#F0F6F2] p-3">
              <div className="mb-2 text-xs font-bold text-emerald-800">
                {view === "judge" ? "管理者视角：先看学习成效，再看依据" : "按三个步骤推进：定重点、取资料、看进展"}
              </div>
              <div className="grid gap-2 sm:grid-cols-4">
                {FLOW.map(([code, title, desc]) => (
                  <div key={code} className="rounded-[10px] border border-[#E5E9E3] bg-white px-3 py-2">
                    <div className="font-mono text-[10px] font-bold tracking-[0.18em] text-emerald-700">{code}</div>
                    <div className="mt-1 text-xs font-bold text-[#182119]">{title}</div>
                    <div className="mt-0.5 text-[11px] leading-4 text-[#8B958D]">{desc}</div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-xs font-bold text-[#8B958D]">可以从一个示例目标开始</div>
              <div className="grid gap-3 sm:grid-cols-2">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-[14px] border border-[#E5E9E3] bg-white p-4 text-left text-sm text-[#57635A] shadow-sm transition hover:-translate-y-0.5 hover:border-[#D2DAD2] hover:shadow-[0_1px_2px_rgba(18,30,22,0.05),0_6px_20px_rgba(18,30,22,0.08)]"
                  >
                    <span className="mb-2 block font-mono text-[10px] tracking-[0.2em] text-emerald-700">学习目标</span>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[82%] rounded-[14px] rounded-br-md bg-[#0E1411] px-4 py-2.5 text-sm leading-6 text-white shadow-sm">
                {m.text}
              </div>
            </div>
          ) : (
            <div key={i} className="flex gap-3">
              <div className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-emerald-200 bg-[#E3F0E9] font-mono text-[10px] font-bold text-emerald-800">
                学伴
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                {(m.text || m.streaming) && (
                  <div className="rounded-[14px] rounded-tl-md border border-[#E5E9E3] bg-white px-4 py-3 shadow-sm">
                    <Markdown text={m.text} streaming={m.streaming} />
                    {m.citations.length > 0 && !m.streaming && (
                      <div className="mt-3 border-t border-slate-200 pt-2">
                        <div className="mb-1 font-mono text-[10px] tracking-[0.18em] text-emerald-600">内容出处</div>
                        {m.citations.map((c, j) => (
                          <div key={j} className="text-xs leading-5 text-slate-500">
                            <span className="font-mono text-emerald-600">[{j + 1}]</span> {c}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {m.resources.map((r) => (
                  <ResourceCard key={r.id} r={r} onQuizEvaluated={onQuizEvaluated} />
                ))}
              </div>
            </div>
          ),
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-[#E5E9E3] bg-[#FBFCFA] p-4">
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
            aria-label="学习目标输入"
            placeholder="例如：两周后期末，请帮我先攻克二叉树和动态规划"
            className="max-h-28 flex-1 resize-none rounded-[10px] border border-[#D2DAD2] bg-white px-3 py-2.5 text-sm text-[#182119] outline-none transition placeholder:text-[#8B958D] focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
          />
          {busy ? (
            <button
              onClick={() => abortRef.current?.()}
              className="h-11 shrink-0 rounded-[10px] border border-orange-300 px-4 text-sm font-semibold text-orange-700 hover:bg-orange-50"
            >
              停止
            </button>
          ) : (
            <button
              onClick={() => send(input)}
              disabled={!input.trim()}
              className="h-11 shrink-0 rounded-[10px] bg-[#0F6B50] px-5 text-sm font-bold text-white shadow-sm transition hover:bg-[#0B5340] disabled:cursor-not-allowed disabled:opacity-40"
            >
              开始
            </button>
          )}
        </div>
        {queuedHint && <div className="mt-2 text-xs font-semibold text-orange-700">{queuedHint}</div>}
      </div>
    </div>
  );
}
