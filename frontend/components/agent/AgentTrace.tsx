"use client";

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

const AGENT_META: Record<string, { name: string; code: string; group: string }> = {
  profile: { name: "画像建模", code: "PRF", group: "理解学生" },
  orchestrator: { name: "任务编排", code: "ORC", group: "判断意图" },
  planner: { name: "资源规划", code: "PLN", group: "拆解任务" },
  path: { name: "路径规划", code: "PTH", group: "安排顺序" },
  doc: { name: "图文教程", code: "DOC", group: "并行生成" },
  mindmap: { name: "思维导图", code: "MAP", group: "并行生成" },
  quiz: { name: "智能题组", code: "QUZ", group: "并行生成" },
  media: { name: "讲解视频", code: "MED", group: "并行生成" },
  tutor: { name: "答疑导师", code: "TUT", group: "即时辅导" },
  eval: { name: "质量评估", code: "EVL", group: "闭环检查" },
};

export function emptyTrace(): TraceState {
  const t: TraceState = {};
  for (const k of Object.keys(AGENT_META)) {
    t[k] = { status: "idle", label: AGENT_META[k].name, detail: "", summary: "" };
  }
  return t;
}

export function applyTraceEvent(prev: TraceState, ev: SparkEvent): TraceState {
  const a = ev.agent as string | undefined;
  if (!a || !(a in prev)) {
    if (ev.type === "error") {
      const t = { ...prev };
      for (const k of Object.keys(t)) {
        if (t[k].status === "running") t[k] = { ...t[k], status: "error", detail: ev.detail || "" };
      }
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
      return { ...prev, [a]: { ...node, detail: `安全检查：${ev.detail || ""}` } };
    default:
      return prev;
  }
}

const DOT: Record<NodeStatus, string> = {
  idle: "bg-slate-300",
  running: "bg-blue-500 shadow-[0_0_0_4px_rgba(37,99,235,.14)] animate-breathe",
  done: "bg-emerald-500",
  error: "bg-rose-500",
};

function Node({ id, n }: { id: string; n: TraceNode }) {
  const meta = AGENT_META[id];
  const active = n.status === "running";
  const done = n.status === "done";
  const error = n.status === "error";

  return (
    <div
      className={`rounded-lg border px-3 py-2.5 transition ${
        active
          ? "border-blue-300 bg-blue-50"
          : done
            ? "border-emerald-200 bg-emerald-50/70"
            : error
              ? "border-rose-200 bg-rose-50"
              : "border-slate-200 bg-white/70"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[n.status]}`} />
        <span className="font-mono text-[10px] tracking-[0.18em] text-blue-600">{meta.code}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{meta.name}</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">{meta.group}</span>
      </div>
      {(n.status === "running" && n.detail) || (n.status === "done" && n.summary) || error ? (
        <div className="mt-1.5 truncate pl-5 text-xs leading-5 text-slate-500">
          {done ? n.summary : n.detail}
        </div>
      ) : null}
    </div>
  );
}

function StepLine({ active }: { active: boolean }) {
  return <div className={`mx-4 h-3 border-l ${active ? "border-blue-300" : "border-slate-200"}`} />;
}

export default function AgentTrace({ trace }: { trace: TraceState }) {
  const gen: AgentId[] = ["doc", "mindmap", "quiz", "media"];
  const anyGen = useMemo(() => gen.some((g) => trace[g].status !== "idle"), [trace]);
  const tutorMode = trace.tutor.status !== "idle" && !anyGen;
  const running = Object.values(trace).filter((n) => n.status === "running").length;
  const done = Object.values(trace).filter((n) => n.status === "done").length;

  return (
    <div className="telemetry rounded-xl border border-slate-200 bg-white/80 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="font-mono text-[10px] tracking-[0.24em] text-blue-600">AGENT TRACE</div>
          <div className="mt-1 text-sm font-bold text-slate-950">多智能体协作链路</div>
          <div className="mt-0.5 text-[11px] text-slate-500">只点亮本次实际运行的智能体，未选资源保持空闲。</div>
        </div>
        <div className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-mono text-[10px] text-slate-500">
          RUN {running} / DONE {done}
        </div>
      </div>

      <Node id="profile" n={trace.profile} />
      <StepLine active={trace.profile.status === "done" && trace.orchestrator.status !== "idle"} />
      <Node id="orchestrator" n={trace.orchestrator} />

      {tutorMode ? (
        <>
          <StepLine active={trace.tutor.status === "running"} />
          <Node id="tutor" n={trace.tutor} />
        </>
      ) : (
        <>
          <StepLine active={trace.planner.status !== "idle"} />
          <Node id="planner" n={trace.planner} />
          <StepLine active={trace.path.status !== "idle"} />
          <Node id="path" n={trace.path} />
          <StepLine active={anyGen} />
          <div className="grid grid-cols-2 gap-2">
            {gen.map((g) => (
              <Node key={g} id={g} n={trace[g]} />
            ))}
          </div>
          <StepLine active={trace.eval.status !== "idle"} />
          <Node id="eval" n={trace.eval} />
        </>
      )}
    </div>
  );
}
