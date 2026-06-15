"use client";
/** PathDag —— 学习路径 DAG:
 *  客户端按最长路分层布局;节点按状态着色(done=薄荷 / ready=电光蓝 / locked=暗),
 *  推荐 next_kp 以星火橙描边呼吸;点击节点上抛详情。 */
import { useMemo } from "react";
import type { PathNode, PathPlan } from "@/lib/types";

const W = 980;
const NODE_W = 118;
const NODE_H = 46;
const GAP_Y = 76;

function layout(plan: PathPlan) {
  const layer: Record<string, number> = {};
  const ids = plan.nodes.map((n) => n.id);
  const indeg: Record<string, number> = Object.fromEntries(ids.map((i) => [i, 0]));
  const out: Record<string, string[]> = Object.fromEntries(ids.map((i) => [i, []]));
  for (const e of plan.edges) {
    out[e.from]?.push(e.to);
    if (e.to in indeg) indeg[e.to] += 1;
  }
  const q = ids.filter((i) => indeg[i] === 0);
  for (const i of q) layer[i] = 0;
  while (q.length) {
    const u = q.shift()!;
    for (const v of out[u] || []) {
      layer[v] = Math.max(layer[v] ?? 0, layer[u] + 1);
      if (--indeg[v] === 0) q.push(v);
    }
  }
  const byLayer: string[][] = [];
  for (const id of ids) (byLayer[layer[id] ?? 0] ||= []).push(id);
  const pos: Record<string, { x: number; y: number }> = {};
  byLayer.forEach((row, li) => {
    row.forEach((id, ri) => {
      const x = ((ri + 1) * W) / (row.length + 1);
      pos[id] = { x, y: 40 + li * GAP_Y };
    });
  });
  return { pos, height: 40 + byLayer.length * GAP_Y };
}

const FILL: Record<PathNode["status"], { bg: string; border: string; text: string }> = {
  done: { bg: "rgba(52,211,153,.12)", border: "#34d399", text: "#a7f3d0" },
  ready: { bg: "rgba(56,189,248,.12)", border: "#38bdf8", text: "#e7eefc" },
  locked: { bg: "rgba(17,26,46,.9)", border: "#1e2a45", text: "#5b6b8e" },
};

export default function PathDag({
  plan,
  selected,
  onSelect,
}: {
  plan: PathPlan;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const { pos, height } = useMemo(() => layout(plan), [plan]);
  const byId = useMemo(() => Object.fromEntries(plan.nodes.map((n) => [n.id, n])), [plan]);

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full">
      {plan.edges.map((e, i) => {
        const a = pos[e.from];
        const b = pos[e.to];
        if (!a || !b) return null;
        const unlocked = byId[e.from]?.status === "done";
        const midY = (a.y + b.y) / 2;
        return (
          <path
            key={i}
            d={`M ${a.x} ${a.y + NODE_H / 2} C ${a.x} ${midY}, ${b.x} ${midY}, ${b.x} ${b.y - NODE_H / 2}`}
            fill="none"
            stroke={unlocked ? "#38bdf8" : "#1e2a45"}
            strokeWidth={unlocked ? 1.6 : 1.2}
            strokeOpacity={unlocked ? 0.7 : 0.8}
            markerEnd="url(#arrow)"
          />
        );
      })}
      <defs>
        <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L8,4 L0,8 z" fill="#2a3a5e" />
        </marker>
      </defs>

      {plan.nodes.map((n) => {
        const p = pos[n.id];
        if (!p) return null;
        const f = FILL[n.status];
        const isNext = plan.next_kp === n.id;
        const isSel = selected === n.id;
        return (
          <g key={n.id} transform={`translate(${p.x - NODE_W / 2}, ${p.y - NODE_H / 2})`} className="cursor-pointer" onClick={() => onSelect(n.id)}>
            {isNext && (
              <rect x="-4" y="-4" width={NODE_W + 8} height={NODE_H + 8} rx="12" fill="none" stroke="#fb923c" strokeWidth="1.5" strokeDasharray="5 4" className="animate-breathe" />
            )}
            <rect width={NODE_W} height={NODE_H} rx="9" fill={f.bg} stroke={isSel ? "#fb923c" : f.border} strokeWidth={isSel ? 2 : 1.4} />
            <text x={NODE_W / 2} y={18} textAnchor="middle" fontSize="12.5" fontWeight={600} fill={f.text}>
              {n.name}
            </text>
            <rect x="12" y={NODE_H - 16} width={NODE_W - 24} height="4" rx="2" fill="#1e2a45" />
            <rect x="12" y={NODE_H - 16} width={(NODE_W - 24) * Math.min(1, n.mastery)} height="4" rx="2" fill={n.status === "done" ? "#34d399" : "#38bdf8"} />
            {n.order && (
              <g>
                <circle cx={NODE_W - 2} cy="2" r="9" fill="#fb923c" />
                <text x={NODE_W - 2} y="5.5" textAnchor="middle" fontSize="10" fontWeight={700} fill="#0b1020">
                  {n.order}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
