"use client";
/** 资源工坊:选知识点与资源类型 → 一键并行生成(SSE 实时遥测)→ 卡片即时落地;
 *  下方为历史资源墙(GET /api/resources)。 */
import { useCallback, useEffect, useState } from "react";
import AgentTrace, { applyTraceEvent, emptyTrace, type TraceState } from "@/components/agent/AgentTrace";
import ResourceCard from "@/components/resource/ResourceCard";
import { USER_ID, apiGet, postSSE } from "@/lib/api";
import type { ResourceItem, SparkEvent } from "@/lib/types";

const KPS: [string, string][] = [
  ["complexity", "复杂度"], ["array", "数组"], ["linked_list", "链表"], ["stack", "栈"],
  ["queue", "队列"], ["recursion", "递归"], ["sorting_basic", "基础排序"], ["sorting_adv", "高级排序"],
  ["binary_tree", "二叉树"], ["bst", "BST"], ["heap", "堆"], ["hash", "哈希"],
  ["graph_basic", "图基础"], ["graph_traverse", "图遍历"], ["shortest_path", "最短路"], ["dp", "动态规划"],
];
const KINDS: [string, string][] = [
  ["doc", "图文教程"], ["mindmap", "思维导图"], ["quiz", "智能题组"],
  ["code", "代码示例"], ["video", "讲解视频"],
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
    setTrace(emptyTrace());
    postSSE(
      "/resources/generate",
      { user_id: USER_ID, goal, knowledge_points: [kp], kinds },
      (ev: SparkEvent) => {
        setTrace((t) => applyTraceEvent(t, ev));
        if (ev.type === "resource" && ev.resource) setFresh((r) => [...r, ev.resource!]);
        if (ev.type === "summary" && ev.text) setNote(ev.text as string);
        if (ev.type === "error") setNote(`⚠️ ${ev.detail || "生成异常"}`);
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
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        {/* 生成台 */}
        <section className="rounded-xl border border-hairline bg-panel/40 p-4">
          <div className="font-mono text-[10px] tracking-[0.25em] text-spark">RESOURCE FORGE</div>
          <h2 className="mt-1 text-lg font-bold text-slate-100">个性化资源,一次并行铸造</h2>

          <div className="mt-3">
            <div className="mb-1.5 text-xs text-muted">知识点</div>
            <div className="flex flex-wrap gap-1.5">
              {KPS.map(([id, name]) => (
                <button
                  key={id}
                  onClick={() => setKp(id)}
                  className={`rounded-md border px-2.5 py-1 text-xs transition ${
                    kp === id
                      ? "border-spark/70 bg-spark/15 text-slate-100"
                      : "border-hairline text-muted hover:border-spark/40 hover:text-body"
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3">
            <div className="mb-1.5 text-xs text-muted">资源类型(并行生成)</div>
            <div className="flex flex-wrap gap-1.5">
              {KINDS.map(([id, name]) => (
                <button
                  key={id}
                  onClick={() => toggleKind(id)}
                  className={`rounded-md border px-2.5 py-1 text-xs transition ${
                    kinds.includes(id)
                      ? "border-ember/70 bg-ember/15 text-slate-100"
                      : "border-hairline text-muted hover:border-ember/40 hover:text-body"
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 flex gap-2">
            <input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="可选:补充目标,如「两周后期末考,偏好可视化讲解」"
              className="flex-1 rounded-lg border border-hairline bg-ink/70 px-3 py-2 text-xs text-body outline-none focus:border-spark/60"
            />
            <button
              onClick={generate}
              disabled={busy || kinds.length === 0}
              className="rounded-lg bg-ember px-5 py-2 text-sm font-semibold text-ink transition hover:brightness-110 disabled:opacity-40"
            >
              {busy ? "智能体协同中…" : "开始生成"}
            </button>
          </div>
          {note && <p className="mt-2 text-xs text-mint">{note}</p>}
        </section>

        {/* 本次产出 */}
        {fresh.length > 0 && (
          <section className="space-y-2.5">
            <div className="font-mono text-[10px] tracking-[0.25em] text-ember">FRESH OUTPUT · 本次产出</div>
            {fresh.map((r) => (
              <ResourceCard key={r.id} r={r} defaultOpen />
            ))}
          </section>
        )}

        {/* 历史 */}
        <section className="space-y-2.5">
          <div className="font-mono text-[10px] tracking-[0.25em] text-muted">LIBRARY · 我的资源库({history.length})</div>
          {history.filter((r) => !freshIds.has(r.id)).map((r) => (
            <ResourceCard key={r.id} r={r} />
          ))}
          {history.length === 0 && (
            <div className="rounded-xl border border-dashed border-hairline p-8 text-center text-xs text-muted">
              资源库为空 —— 选择知识点与类型,点「开始生成」铸造第一批资源。
            </div>
          )}
        </section>
      </div>

      <aside className="hidden lg:block">
        <div className="sticky top-[4.5rem]">
          <AgentTrace trace={trace} />
        </div>
      </aside>
    </div>
  );
}
