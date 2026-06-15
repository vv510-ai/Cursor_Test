"use client";
/** AgentTrace —— 任务遥测面板(本系统的签名件)。
 *  以"任务控制台"的方式实时呈现 LangGraph 编排:意图路由 → 规划 → 并行生成 → 质检,
 *  节点呼吸点亮、连线流动、每个智能体一行 mono 电文。评委据此一眼看懂多智能体协同。 */
import { useMemo } from "react";
import type { AgentId, SparkEvent } from "@/lib/types";

export type NodeStatus = "idle" | "running" | "done" | "error";
export interface TraceNode {
  status: NodeStatus;
  label: string;
  detail: string;
  summary: string;
  ts?: string;
}
export type TraceState = Record<string, TraceNode>;

const AGENT_META: Record<string, { name: string; code: string }> = {
  profile: { name: "画像智能体", code: "PRF" },
  orchestrator: { name: "编排器", code: "ORC" },
  planner: { name: "资源规划", code: "PLN" },
  path: { name: "路径规划", code: "PTH" },
  doc: { name: "文档生成", code: "DOC" },
  mindmap: { name: "思维导图", code: "MAP" },
  quiz: { name: "智能题库", code: "QUZ" },
  media: { name: "媒体生成", code: "MED" },
  tutor: { name: "答疑导师", code: "TUT" },
  eval: { name: "评估质检", code: "EVL" },
};

export function emptyTrace(): TraceState {
  const t: TraceState = {};
  for (const k of Object.keys(AGENT_META))
    t[k] = { status: "idle", label: AGENT_META[k].name, detail: "", summary: "" };
  return t;
}

/** 把 SSE 事件折叠进遥测状态(页面侧 setState(prev => applyTraceEvent(prev, ev)))。 */
export function applyTraceEvent(prev: TraceState, ev: SparkEvent): TraceState {
  const a = ev.agent as string | undefined;
  if (!a || !(a in prev)) {
    if (ev.type === "error") {
      const t = { ...prev };
      for (const k of Object.keys(t))
        if (t[k].status === "running") t[k] = { ...t[k], status: "error", detail: ev.detail || "" };
      return t;
    }
    return prev;
  }
  const node = prev[a];
  switch (ev.type) {
    case "agent_start":
      return { ...prev, [a]: { ...node, status: "running", detail: ev.detail || "", ts: ev.ts } };
    case "progress":
      return { ...prev, [a]: { ...node, detail: ev.detail || node.detail } };
    case "agent_end":
      return { ...prev, [a]: { ...node, status: "done", summary: ev.summary || "", ts: ev.ts } };
    case "safety":
      return { ...prev, [a]: { ...node, detail: `⚠ ${ev.detail || ""}` } };
    default:
      return prev;
  }
}

/* ── 视图 ───────────────────────────────────────────────────────────── */
const dot: Record<NodeStatus, string> = {
  idle: "bg-[#2a3a5e]",
  running: "bg-spark shadow-[0_0_8px_2px_rgba(56,189,248,.55)] animate-breathe",
  done: "bg-mint",
  error: "bg-rose-400",
};

function Node({ id, n, small = false }: { id: string; n: TraceNode; small?: boolean }) {
  const meta = AGENT_META[id];
  const active = n.status === "running";
  return (
    <div
      className={`rounded-lg border px-3 py-2 transition-colors ${
        active
          ? "border-spark/70 bg-spark/10"
          : n.status === "done"
            ? "border-mint/30 bg-panel"
            : n.status === "error"
              ? "border-rose-400/50 bg-rose-400/10"
              : "border-hairline bg-panel/60"
      } ${small ? "min-w-0" : ""}`}
    >
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot[n.status]}`} />
        <span className="font-mono text-[10px] tracking-[0.2em] text-spark/70">{meta.code}</span>
        <span className={`truncate text-xs ${active ? "text-slate-100" : "text-body"}`}>{meta.name}</span>
        {n.ts && <span className="ml-auto font-mono text-[9px] text-muted">{n.ts}</span>}
      </div>
      {(n.status === "running" && n.detail) || (n.status === "done" && n.summary) ? (
        <div className="mt-1 truncate pl-4 font-mono text-[10px] leading-4 text-muted">
          {n.status === "done" ? `✓ ${n.summary}` : `… ${n.detail}`}
        </div>
      ) : null}
    </div>
  );
}

function Pipe({ active }: { active: boolean }) {
  return (
    <div className="flex justify-center py-0.5">
      <svg width="2" height="14">
        <line
          x1="1" y1="0" x2="1" y2="14"
          stroke={active ? "#38bdf8" : "#1e2a45"}
          strokeWidth="2"
          strokeDasharray={active ? "4 4" : undefined}
          className={active ? "animate-dash" : ""}
        />
      </svg>
    </div>
  );
}

export default function AgentTrace({ trace }: { trace: TraceState }) {
  const gen: AgentId[] = ["doc", "mindmap", "quiz", "media"];
  const anyGen = useMemo(
    () => gen.some((g) => trace[g].status !== "idle"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trace],
  );
  const tutorMode = trace.tutor.status !== "idle" && !anyGen;
  const running = Object.values(trace).filter((n) => n.status === "running").length;
  const done = Object.values(trace).filter((n) => n.status === "done").length;

  return (
    <div className="telemetry rounded-xl border border-hairline bg-panel/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] tracking-[0.25em] text-spark">AGENT TRACE</span>
        <span className="font-mono text-[10px] text-muted">
          RUN {running} · DONE {done}
        </span>
      </div>

      <Node id="profile" n={trace.profile} />
      <Pipe active={trace.profile.status === "done" && trace.orchestrator.status !== "idle"} />
      <Node id="orchestrator" n={trace.orchestrator} />

      {tutorMode ? (
        <>
          <Pipe active={trace.tutor.status === "running"} />
          <Node id="tutor" n={trace.tutor} />
        </>
      ) : (
        <>
          <Pipe active={trace.planner.status !== "idle"} />
          <Node id="planner" n={trace.planner} />
          <Pipe active={trace.path.status !== "idle"} />
          <Node id="path" n={trace.path} />
          <Pipe active={anyGen} />
          <div className="grid grid-cols-2 gap-1.5">
            {gen.map((g) => (
              <Node key={g} id={g} n={trace[g]} small />
            ))}
          </div>
          <Pipe active={trace.eval.status !== "idle"} />
          <Node id="eval" n={trace.eval} />
        </>
      )}
    </div>
  );
}
