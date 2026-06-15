"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PathDag from "@/components/path/PathDag";
import { USER_ID, apiGet, apiPost } from "@/lib/api";
import type { PathPlan } from "@/lib/types";

export default function PathPage() {
  const [plan, setPlan] = useState<PathPlan | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiGet<PathPlan>(`/path?user_id=${USER_ID}`).then((p) => {
      setPlan(p);
      setSel((s) => s ?? p.next_kp);
    });
  }, []);

  useEffect(load, [load]);

  async function replan() {
    setBusy(true);
    try {
      const p = await apiPost<PathPlan>("/path/replan", { user_id: USER_ID, reason: "手动重排" });
      setPlan(p);
      setSel(p.next_kp);
    } finally {
      setBusy(false);
    }
  }

  const node = useMemo(() => plan?.nodes.find((n) => n.id === sel) || null, [plan, sel]);
  const queue = useMemo(
    () => (plan?.nodes.filter((n) => n.order).sort((a, b) => (a.order! - b.order!)) ?? []).slice(0, 5),
    [plan],
  );
  const stats = useMemo(() => {
    const ns = plan?.nodes ?? [];
    return {
      done: ns.filter((n) => n.status === "done").length,
      ready: ns.filter((n) => n.status === "ready").length,
      locked: ns.filter((n) => n.status === "locked").length,
    };
  }, [plan]);

  if (!plan) {
    return <div className="py-20 text-center font-mono text-xs text-slate-500">LOADING PATH...</div>;
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="glass-panel rounded-xl p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div>
            <div className="font-mono text-[10px] tracking-[0.24em] text-blue-600">LEARNING PATH</div>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">知识图谱推进图</h1>
            <p className="mt-1 text-sm text-slate-500">按掌握度、前置关系和错因自动安排下一步。</p>
          </div>
          <div className="ml-auto flex items-center gap-3 text-xs text-slate-500">
            <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500" />已掌握 {stats.done}</span>
            <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-blue-500" />可学习 {stats.ready}</span>
            <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-slate-300" />待解锁 {stats.locked}</span>
          </div>
          <button
            onClick={replan}
            disabled={busy}
            className="rounded-lg border border-blue-300 bg-white px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-50 disabled:opacity-50"
          >
            {busy ? "重排中..." : "按最新画像重排"}
          </button>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-3">
          <PathDag plan={plan} selected={sel} onSelect={setSel} />
        </div>
        <p className="mt-3 text-xs text-slate-500">
          先修达到 60% 解锁，掌握达到 80% 点亮。橙色虚线框代表下一步推荐。
        </p>
      </section>

      <aside className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="font-mono text-[10px] tracking-[0.22em] text-orange-600">NODE DETAIL</div>
          {node ? (
            <>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-lg font-black text-slate-950">{node.name}</span>
                <span className="font-mono text-[10px] text-slate-500">D{node.difficulty} · 优先级 {node.score}</span>
              </div>
              <div className="mt-3 h-2 w-full rounded-full bg-slate-200">
                <div
                  className={`h-2 rounded-full ${node.status === "done" ? "bg-emerald-500" : "bg-blue-600"}`}
                  style={{ width: `${Math.round(node.mastery * 100)}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-slate-500">
                掌握度 {Math.round(node.mastery * 100)}% · {node.status === "done" ? "已掌握" : node.status === "ready" ? "可学习" : "前置未达标"}
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-700">{node.reason}</p>
              <a href="/resources" className="mt-4 block rounded-lg bg-blue-600 py-2.5 text-center text-sm font-bold text-white transition hover:bg-blue-700">
                为“{node.name}”生成资源
              </a>
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-500">点击图中节点查看学习处方。</p>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="font-mono text-[10px] tracking-[0.22em] text-blue-600">NEXT UP</div>
          <h2 className="mt-1 text-sm font-bold text-slate-950">推荐学习序列</h2>
          <ol className="mt-3 space-y-2">
            {queue.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => setSel(n.id)}
                  className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm text-slate-700 transition hover:border-blue-200 hover:bg-blue-50"
                >
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-orange-500 font-mono text-[10px] font-black text-white">
                    {n.order}
                  </span>
                  <span className="flex-1 font-semibold">{n.name}</span>
                  <span className="font-mono text-xs text-slate-500">{Math.round(n.mastery * 100)}%</span>
                </button>
              </li>
            ))}
            {queue.length === 0 && <li className="text-sm text-slate-500">暂无就绪节点，先完成前置知识点。</li>}
          </ol>
        </div>
      </aside>
    </div>
  );
}
