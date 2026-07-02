"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AgentTrace, { applyTraceEvent, emptyTrace, type TraceState } from "@/components/agent/AgentTrace";
import ResourceCard from "@/components/resource/ResourceCard";
import { USER_ID, apiGet, apiUpload, postSSE } from "@/lib/api";
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

interface TraceRunReport {
  session_id: string;
  run_dir: string;
  debug_report: string;
  summary?: {
    event_counts?: Record<string, number>;
    route?: string[];
  };
  resources?: { kind?: string; title?: string; citation_count?: number }[];
}

interface KnowledgeSource {
  id: string;
  title: string;
  filename: string;
  kp: string;
  source_type: string;
  chunk_count: number;
  status: string;
  created_at?: string;
}

interface KnowledgeUploadResult {
  source: KnowledgeSource;
  vector_count: number;
  sample?: { text: string; citation: string }[];
}

export default function ResourcesPage() {
  const [kp, setKp] = useState("binary_tree");
  const [kinds, setKinds] = useState<string[]>(["doc"]);
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [trace, setTrace] = useState<TraceState>(emptyTrace());
  const [fresh, setFresh] = useState<ResourceItem[]>([]);
  const [history, setHistory] = useState<ResourceItem[]>([]);
  const [note, setNote] = useState("");
  const [runInfo, setRunInfo] = useState<{ session_id: string; run_dir: string } | null>(null);
  const [traceReport, setTraceReport] = useState<TraceRunReport | null>(null);
  const [traceOpen, setTraceOpen] = useState(false);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState("");
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploadResult, setUploadResult] = useState<KnowledgeUploadResult | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [showUpload, setShowUpload] = useState(false);

  const selectedKpName = useMemo(() => KPS.find(([id]) => id === kp)?.[1] || kp, [kp]);
  const selectedKindNames = useMemo(
    () => KINDS.filter(([id]) => kinds.includes(id)).map(([, name]) => name),
    [kinds],
  );
  const runStatus = busy ? "生成中" : fresh.length > 0 ? "已生成" : "待生成";

  const loadHistory = useCallback(() => {
    apiGet<{ items: ResourceItem[] }>(`/resources?user_id=${USER_ID}`)
      .then((d) => {
        setHistory(d.items);
        setFresh((prev) => prev.map((r) => d.items.find((item) => item.id === r.id) || r));
      })
      .catch(() => {});
  }, []);

  const loadSources = useCallback(() => {
    apiGet<{ items: KnowledgeSource[] }>(`/knowledge/sources?user_id=${USER_ID}`)
      .then((d) => {
        setSources(d.items);
        const live = new Set(d.items.map((item) => item.id));
        setSelectedSourceIds((ids) => ids.filter((id) => live.has(id)));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadHistory();
    loadSources();
  }, [loadHistory, loadSources]);

  function toggleKind(k: string) {
    setKinds((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k]));
  }

  function toggleSource(id: string) {
    setSelectedSourceIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  async function uploadKnowledge() {
    if (!uploadFile || uploadBusy) return;
    setUploadBusy(true);
    setUploadError("");
    setUploadStatus("正在上传并索引资料...");
    setUploadResult(null);
    const form = new FormData();
    form.append("file", uploadFile);
    form.append("user_id", USER_ID);
    form.append("kp", kp);
    form.append("title", uploadTitle.trim() || uploadFile.name);
    try {
      const result = await apiUpload<KnowledgeUploadResult>("/knowledge/upload", form);
      setUploadResult(result);
      setUploadFile(null);
      setUploadTitle("");
      setFileInputKey((x) => x + 1);
      setSelectedSourceIds((ids) => (ids.includes(result.source.id) ? ids : [result.source.id, ...ids]));
      loadSources();
      setUploadStatus("");
      if (!goal.trim()) setGoal(`请基于我上传的「${result.source.title}」生成学习资源`);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "上传失败");
      setUploadStatus("");
    } finally {
      setUploadBusy(false);
    }
  }

  function generate() {
    if (busy || kinds.length === 0) return;
    setBusy(true);
    setFresh([]);
    setNote("");
    setRunInfo(null);
    setTraceReport(null);
    setTraceOpen(false);
    setTraceError("");
    setTrace(emptyTrace());
    postSSE(
      "/resources/generate",
      { user_id: USER_ID, goal, knowledge_points: [kp], kinds, source_ids: selectedSourceIds },
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

  async function toggleTraceReport() {
    if (!runInfo?.session_id) return;
    if (traceOpen) {
      setTraceOpen(false);
      return;
    }
    setTraceOpen(true);
    if (traceReport?.session_id === runInfo.session_id) return;
    setTraceLoading(true);
    setTraceError("");
    try {
      const report = await apiGet<TraceRunReport>(`/debug/runs/${runInfo.session_id}`);
      setTraceReport(report);
    } catch {
      setTraceError("调试报告读取失败");
    } finally {
      setTraceLoading(false);
    }
  }

  const freshIds = new Set(fresh.map((r) => r.id));

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-5">
        <section className="glass-panel overflow-hidden rounded-xl">
          <div className="border-b border-slate-200 bg-white/80 px-5 py-5">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <div className="font-mono text-[10px] tracking-[0.24em] text-blue-600">RESOURCE FORGE</div>
                <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">资源工坊</h1>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  {selectedKpName} · {selectedKindNames.length ? selectedKindNames.join(" / ") : "未选择资源类型"}
                </p>
              </div>
              <div className="grid w-full gap-2 sm:grid-cols-3 lg:w-[430px]">
                <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                  <div className="font-mono text-[10px] tracking-[0.16em] text-blue-500">KP</div>
                  <div className="mt-1 truncate text-sm font-black text-blue-900">{selectedKpName}</div>
                </div>
                <div className="rounded-lg border border-orange-100 bg-orange-50 px-3 py-2">
                  <div className="font-mono text-[10px] tracking-[0.16em] text-orange-500">KINDS</div>
                  <div className="mt-1 text-sm font-black text-orange-900">{kinds.length} / {KINDS.length}</div>
                </div>
                <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2">
                  <div className="font-mono text-[10px] tracking-[0.16em] text-emerald-600">STATUS</div>
                  <div className="mt-1 text-sm font-black text-emerald-900">{runStatus}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-5 p-5">
            <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
              <div className="font-mono text-[10px] tracking-[0.2em] text-orange-600">DEMO STEP 1</div>
              <div className="mt-1 font-bold text-slate-950">演示时选择“二叉树 + 图文教程”，生成后展开卡片，直接看正文脚注 [^1] 和引用来源。</div>
            </div>

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
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-bold text-slate-900">资源类型</div>
                <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[10px] text-slate-500">
                  {kinds.length} selected
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {KINDS.map(([id, name, desc]) => {
                  const selected = kinds.includes(id);
                  return (
                    <button
                      key={id}
                      onClick={() => toggleKind(id)}
                      className={`min-h-[92px] rounded-xl border p-3 text-left transition ${
                        selected
                          ? "border-orange-300 bg-orange-50 shadow-sm"
                          : "border-slate-200 bg-white hover:border-orange-200 hover:bg-orange-50/50"
                      }`}
                    >
                      <span className="flex items-start justify-between gap-3">
                        <span>
                          <span className="block text-sm font-bold text-slate-950">{name}</span>
                          <span className="mt-1 block text-xs leading-5 text-slate-500">{desc}</span>
                        </span>
                        <span
                          className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[11px] font-black ${
                            selected ? "border-orange-300 bg-orange-500 text-white" : "border-slate-200 bg-slate-50 text-transparent"
                          }`}
                        >
                          ✓
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white/80 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-mono text-[10px] tracking-[0.18em] text-blue-600">KNOWLEDGE</div>
                  <div className="text-sm font-black text-slate-950">上传学习资料</div>
                </div>
                <button
                  onClick={() => setShowUpload((v) => !v)}
                  className="rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-[10px] text-slate-500 transition hover:border-blue-200 hover:text-blue-700"
                >
                  {showUpload ? "收起上传" : "展开上传"}
                </button>
              </div>
              {!showUpload && <div className="text-xs text-slate-500">本次演示使用课程知识库。需要临时资料时再展开上传。</div>}
              {showUpload && (
                <>
                  <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <input
                      key={fileInputKey}
                      type="file"
                      accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
                      onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                      className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-slate-700"
                    />
                    <input
                      value={uploadTitle}
                      onChange={(e) => setUploadTitle(e.target.value)}
                      placeholder="资料标题"
                      className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                    />
                    <button
                      onClick={uploadKnowledge}
                      disabled={!uploadFile || uploadBusy}
                      className="min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-black text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {uploadBusy ? "索引中..." : "上传并索引"}
                    </button>
                  </div>
                  {uploadStatus && <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">{uploadStatus}</div>}
                  {uploadError && <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{uploadError}</div>}
                  {uploadResult && (
                    <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                      已索引 {uploadResult.source.chunk_count} 个片段 · 知识库共 {uploadResult.vector_count} 个片段
                    </div>
                  )}
                  {sources.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>已上传资料</span>
                        <span className="font-mono">{selectedSourceIds.length} selected</span>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {sources.slice(0, 4).map((source) => {
                          const checked = selectedSourceIds.includes(source.id);
                          return (
                            <label
                              key={source.id}
                              className={`flex min-w-0 cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 transition ${
                                checked ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-slate-50 hover:border-blue-200"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleSource(source.id)}
                                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-bold text-slate-900">{source.title || source.filename}</span>
                                <span className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                                  <span className="font-mono text-blue-600">{source.kp || "general"}</span>
                                  <span>{source.chunk_count} chunks</span>
                                  <span>{source.status}</span>
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50/80 p-3 sm:grid-cols-3">
              <div>
                <div className="font-mono text-[10px] tracking-[0.16em] text-slate-500">TARGET</div>
                <div className="mt-1 truncate text-sm font-bold text-slate-900">{selectedKpName}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] tracking-[0.16em] text-slate-500">OUTPUT</div>
                <div className="mt-1 truncate text-sm font-bold text-slate-900">
                  {selectedKindNames.length ? selectedKindNames.join(" / ") : "未选择"}
                </div>
              </div>
              <div>
                <div className="font-mono text-[10px] tracking-[0.16em] text-slate-500">SOURCE</div>
                <div className="mt-1 truncate text-sm font-bold text-slate-900">
                  {selectedSourceIds.length ? `${selectedSourceIds.length} 份资料` : "课程知识库"}
                </div>
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
                {busy ? "生成中..." : `生成 ${kinds.length} 类资源`}
              </button>
            </div>
            {selectedSourceIds.length > 0 && (
              <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                本次将优先基于 {selectedSourceIds.length} 份已选资料生成
              </div>
            )}
            {note && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{note}</p>}
            {runInfo && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="mr-2 font-mono text-[10px] tracking-[0.18em] text-blue-600">RUN TRACE</span>{" "}
                    <span className="font-mono text-slate-900">{runInfo.session_id}</span>
                  </div>
                  <button
                    onClick={toggleTraceReport}
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 font-mono text-[10px] text-slate-600 transition hover:border-blue-300 hover:text-blue-700"
                  >
                    {traceOpen ? "收起技术报告" : "技术报告"}
                  </button>
                </div>
                {traceOpen && (
                  <div className="mt-3 border-t border-slate-200 pt-3">
                    {traceLoading ? (
                      <div className="font-mono text-[10px] text-slate-500">REPORT LOADING...</div>
                    ) : traceError ? (
                      <div className="text-xs text-rose-600">{traceError}</div>
                    ) : traceReport ? (
                      <div className="space-y-3">
                        <div className="grid gap-2 sm:grid-cols-3">
                          <div>
                            <div className="font-mono text-[10px] tracking-[0.16em] text-slate-500">EVENTS</div>
                            <div className="mt-0.5 font-mono text-sm text-slate-900">
                              {Object.values(traceReport.summary?.event_counts || {}).reduce((a, b) => a + b, 0)}
                            </div>
                          </div>
                          <div>
                            <div className="font-mono text-[10px] tracking-[0.16em] text-slate-500">RESOURCES</div>
                            <div className="mt-0.5 font-mono text-sm text-slate-900">{traceReport.resources?.length || 0}</div>
                          </div>
                          <div>
                            <div className="font-mono text-[10px] tracking-[0.16em] text-slate-500">ROUTE</div>
                            <div className="mt-0.5 truncate text-xs text-slate-700">{traceReport.summary?.route?.join(" → ") || "—"}</div>
                          </div>
                        </div>
                        {traceReport.resources && traceReport.resources.length > 0 && (
                          <div className="space-y-1">
                            {traceReport.resources.slice(0, 6).map((r, i) => (
                              <div key={`${r.kind}-${i}`} className="flex items-center gap-2 text-xs text-slate-600">
                                <span className="font-mono text-[10px] text-blue-600">{r.kind || "res"}</span>
                                <span className="min-w-0 flex-1 truncate">{r.title || "untitled"}</span>
                                <span className="font-mono text-[10px] text-slate-400">C{r.citation_count ?? 0}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-[11px] leading-5 text-slate-100">
                          {traceReport.debug_report || "debug_report.md 为空"}
                        </pre>
                      </div>
                    ) : null}
                  </div>
                )}
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
                <p className="mt-1 text-xs text-slate-500">展开图文教程，正文脚注 [^n] 会和底部引用来源一一对应。</p>
              </div>
              <span className="text-sm text-slate-500">{fresh.length} 个资源</span>
            </div>
            {fresh.map((r) => (
              <ResourceCard key={r.id} r={r} defaultOpen onQuizEvaluated={loadHistory} />
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
            <ResourceCard key={r.id} r={r} onQuizEvaluated={loadHistory} />
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
