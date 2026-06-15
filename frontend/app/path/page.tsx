"use client";
/** 学习路径页:个性化路径 DAG(掌握度着色)+ 节点处方详情 + 一键重排。
 *  评估提交后路径自动重排,此页随刷新即见"学习闭环"。 */
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

  if (!plan)
    return <div className="py-20 text-center font-mono text-xs text-muted">LOADING PATH …</div>;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_330px]">
      <section className="rounded-xl border border-hairline bg-panel/40 p-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div>
            <div className="font-mono text-[10px] tracking-[0.25em] text-spark">LEARNING PATH</div>
            <h2 className="text-lg font-bold text-slate-100">你的知识图谱推进图</h2>
          </div>
          <div className="ml-auto flex items-center gap-3 font-mono text-[10px] text-muted">
            <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-mint" />已掌握 {stats.done}</span>
            <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-spark" />可学习 {stats.ready}</span>
            <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#2a3a5e]" />待解锁 {stats.locked}</span>
          </div>
          <button
            onClick={replan}
            disabled={busy}
            className="rounded-lg border border-spark/50 px-3.5 py-1.5 text-xs text-spark transition hover:bg-spark/10 disabled:opacity-50"
          >
            {busy ? "重排中…" : "按最新画像重排"}
          </button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-hairline/60 bg-ink/40 p-2">
          <PathDag plan={plan} selected={sel} onSelect={setSel} />
        </div>
        <p className="mt-2 font-mono text-[10px] text-muted">
          先修达 60% 解锁 · 掌握达 80% 点亮 · 橙色虚线框 = 下一步推荐 · 点击节点查看处方
        </p>
      </section>

      <aside className="space-y-3">
        <div className="rounded-xl border border-hairline bg-panel/40 p-3.5">
          <div className="font-mono text-[10px] tracking-[0.25em] text-ember">NODE DETAIL</div>
          {node ? (
            <>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="text-base font-bold text-slate-100">{node.name}</span>
                <span className="font-mono text-[10px] text-muted">D{node.difficulty} · 优先级 {node.score}</span>
              </div>
              <div className="mt-2 h-1.5 w-full rounded bg-hairline">
                <div
                  className={`h-1.5 rounded ${node.status === "done" ? "bg-mint" : "bg-spark"}`}
                  style={{ width: `${Math.round(node.mastery * 100)}%` }}
                />
              </div>
              <div className="mt-1 font-mono text-[10px] text-muted">掌握度 {Math.round(node.mastery * 100)}% · {node.status === "done" ? "已掌握" : node.status === "ready" ? "可学习" : "先修未达标"}</div>
              <p className="mt-2 text-xs leading-6 text-body">{node.reason}</p>
              <a
                href="/resources"
                className="mt-3 block rounded-lg bg-spark/15 py-2 text-center text-xs text-spark transition hover:bg-spark/25"
              >
                去为「{node.name}」生成资源 →
              </a>
            </>
          ) : (
            <p className="mt-2 text-xs text-muted">点击图中节点查看学习处方。</p>
          )}
        </div>

        <div className="rounded-xl border border-hairline bg-panel/40 p-3.5">
          <div className="font-mono text-[10px] tracking-[0.25em] text-spark">NEXT UP · 推荐序列</div>
          <ol className="mt-2 space-y-1.5">
            {queue.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => setSel(n.id)}
                  className="flex w-full items-center gap-2 rounded-md border border-hairline px-2.5 py-1.5 text-left text-xs text-body transition hover:border-spark/50"
                >
                  <span className="flex items-center justify-center rounded-full bg-ember font-mono text-[10px] font-bold text-ink" style={{ width: 18, height: 18 }}>
                    {n.order}
                  </span>
                  <span className="flex-1">{n.name}</span>
                  <span className="font-mono text-[10px] text-muted">{Math.round(n.mastery * 100)}%</span>
                </button>
              </li>
            ))}
            {queue.length === 0 && <li className="text-xs text-muted">暂无就绪节点 —— 先完成先修知识点。</li>}
          </ol>
        </div>
      </aside>
    </div>
  );
}
