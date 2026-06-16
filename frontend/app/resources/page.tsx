"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AgentTrace, { applyTraceEvent, emptyTrace, type TraceState } from "@/components/agent/AgentTrace";
import ResourceCard from "@/components/resource/ResourceCard";
import { USER_ID, apiGet, postSSE } from "@/lib/api";
import type { ResourceItem, SparkEvent } from "@/lib/types";

const KPS: [string, string][] = [
  ["complexity", "复杂度"],
  ["array", "数组"],
  ["linked_list", "链表"],
  ["stack", "栈"],
  ["queue", "队列"],
  ["recursion", "递归"],
  ["sorting_basic", "基础排序"],
  ["sorting_adv", "高级排序"],
  ["binary_tree", "二叉树"],
  ["bst", "BST"],
  ["heap", "堆"],
  ["hash", "哈希"],
  ["graph_basic", "图基础"],
  ["graph_traverse", "图遍历"],
  ["shortest_path", "最短路"],
  ["dp", "动态规划"],
];

const KINDS: [string, string, string][] = [
  ["doc", "图文教程", "结构化讲义和例题"],
  ["mindmap", "思维导图", "知识点关系梳理"],
  ["quiz", "智能题组", "带错因标签的练习"],
  ["code", "代码示例", "可运行片段"],
  ["video", "讲解视频", "分镜脚本和视频任务"],
];

export default function ResourcesPage() {
  const [kp, setKp] = useState("binary_tree");
  const [kinds, setKinds] = useState<string[]>(["doc", "mindmap", "quiz", "video"]);
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [trace, setTrace] = useState<TraceState>(emptyTrace());
  const [fresh, setFresh] = useState<ResourceItem[]>([]);
  const [history, setHistory] = useState<ResourceItem[]>([]);
  const [note, setNote] = useState("");
  const [runInfo, setRunInfo] = useState<{ session_id: string; run_dir: string } | null>(null);

  const selectedKpName = useMemo(() => KPS.find(([id]) => id === kp)?.[1] || kp, [kp]);

  const loadHistory = useCallback(() => {
    apiGet<{ items: ResourceItem[] }>(`/resources?user_id=${USER_ID}`)
      .then((d) => setHistory(d.items))
      .catch(() => {});
  }, []);

  useEffect(loadHistory, [loadHistory]);

  function toggleKind(k: string) {
    setKinds((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k]));
  }

  function generate() {
    if (busy || kinds.length === 0) return;
    setBusy(true);
    setFresh([]);
    setNote("");
    setRunInfo(null);
    setTrace(emptyTrace());
    postSSE(
      "/resources/generate",
      { user_id: USER_ID, goal, knowledge_points: [kp], kinds },
      (ev: SparkEvent) => {
        setTrace((t) => applyTraceEvent(t, ev));
        if (ev.type === "trace") {
          setRunInfo({
            session_id: ev.session_id || "",
            run_dir: ev.run_dir || "",
          });
        }
        if (ev.type === "resource" && ev.resource) setFresh((r) => [...r, ev.resource!]);
        if (ev.type === "summary" && ev.text) setNote(ev.text as string);
        if (ev.type === "error") setNote(`生成异常：${ev.detail || "请查看后端日志"}`);
        if (ev.type === "done") {
          setBusy(false);
          loadHistory();
        }
      },
      () => setBusy(false),
    );
  }

  const freshIds = new Set(fresh.map((r) => r.id));

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-5">
        <section className="glass-panel overflow-hidden rounded-xl">
          <div className="border-b border-slate-200 bg-white/72 px-5 py-5">
            <div className="font-mono text-[10px] tracking-[0.24em] text-blue-600">RESOURCE FORGE</div>
            <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="text-2xl font-black tracking-tight text-slate-950">个性化资源，一次并行生成</h1>
                <p className="mt-1 text-sm text-slate-500">选择知识点和资源类型，系统会同时生成教程、题组、脑图与讲解脚本。</p>
              </div>
              <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700">
                当前：{selectedKpName}
              </div>
            </div>
          </div>

          <div className="space-y-5 p-5">
            <div>
              <div className="mb-2 text-sm font-bold text-slate-900">知识点</div>
              <div className="flex flex-wrap gap-2">
                {KPS.map(([id, name]) => (
                  <button
                    key={id}
                    onClick={() => setKp(id)}
                    className={`rounded-lg border px-3 py-2 text-sm transition ${
                      kp === id
                        ? "border-blue-300 bg-blue-600 text-white shadow-sm"
                        : "border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50"
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 text-sm font-bold text-slate-900">资源类型</div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {KINDS.map(([id, name, desc]) => (
                  <button
                    key={id}
                    onClick={() => toggleKind(id)}
                    className={`rounded-xl border p-3 text-left transition ${
                      kinds.includes(id)
                        ? "border-orange-300 bg-orange-50 shadow-sm"
                        : "border-slate-200 bg-white hover:border-orange-200 hover:bg-orange-50/50"
                    }`}
                  >
                    <span className="block text-sm font-bold text-slate-950">{name}</span>
                    <span className="mt-1 block text-xs text-slate-500">{desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="可选：补充目标，例如“两周后期末，希望可视化讲解”"
                className="min-h-11 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
              />
              <button
                onClick={generate}
                disabled={busy || kinds.length === 0}
                className="min-h-11 rounded-lg bg-orange-500 px-6 text-sm font-black text-white shadow-sm transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? "生成中..." : "开始生成"}
              </button>
            </div>
            {note && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{note}</p>}
            {runInfo && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <span className="mr-2 font-mono text-[10px] tracking-[0.18em] text-blue-600">TRACE</span>
                {" "}
                <span className="font-mono text-slate-900">{runInfo.session_id}</span>
                {runInfo.run_dir && <span className="mt-1 block break-all font-mono text-[11px] text-slate-500">{runInfo.run_dir}</span>}
              </div>
            )}
          </div>
        </section>

        {fresh.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-mono text-[10px] tracking-[0.24em] text-orange-600">FRESH OUTPUT</div>
                <h2 className="text-lg font-black text-slate-950">本次生成结果</h2>
              </div>
              <span className="text-sm text-slate-500">{fresh.length} 个资源</span>
            </div>
            {fresh.map((r) => (
              <ResourceCard key={r.id} r={r} defaultOpen />
            ))}
          </section>
        )}

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-mono text-[10px] tracking-[0.24em] text-slate-500">LIBRARY</div>
              <h2 className="text-lg font-black text-slate-950">我的资源库</h2>
            </div>
            <span className="text-sm text-slate-500">{history.length} 个资源</span>
          </div>
          {history.filter((r) => !freshIds.has(r.id)).map((r) => (
            <ResourceCard key={r.id} r={r} />
          ))}
          {history.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-10 text-center text-sm text-slate-500">
              资源库为空。选择知识点和类型后，点击“开始生成”创建第一批资源。
            </div>
          )}
        </section>
      </div>

      <aside className="hidden lg:block">
        <div className="sticky top-[5.5rem]">
          <AgentTrace trace={trace} />
        </div>
      </aside>
    </div>
  );
}
