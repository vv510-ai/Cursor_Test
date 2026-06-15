"use client";

import { useMemo } from "react";
import type { PathNode, PathPlan } from "@/lib/types";

const W = 980;
const NODE_W = 122;
const NODE_H = 50;
const GAP_Y = 80;

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
      pos[id] = { x, y: 42 + li * GAP_Y };
    });
  });
  return { pos, height: 56 + byLayer.length * GAP_Y };
}

const FILL: Record<PathNode["status"], { bg: string; border: string; text: string; bar: string }> = {
  done: { bg: "#ecfdf5", border: "#34d399", text: "#047857", bar: "#059669" },
  ready: { bg: "#eff6ff", border: "#60a5fa", text: "#1d4ed8", bar: "#2563eb" },
  locked: { bg: "#f8fafc", border: "#cbd5e1", text: "#64748b", bar: "#94a3b8" },
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
      <defs>
        <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L8,4 L0,8 z" fill="#94a3b8" />
        </marker>
      </defs>

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
            stroke={unlocked ? "#2563eb" : "#cbd5e1"}
            strokeWidth={unlocked ? 1.8 : 1.2}
            strokeOpacity={unlocked ? 0.7 : 0.95}
            markerEnd="url(#arrow)"
          />
        );
      })}

      {plan.nodes.map((n) => {
        const p = pos[n.id];
        if (!p) return null;
        const f = FILL[n.status];
        const isNext = plan.next_kp === n.id;
        const isSel = selected === n.id;
        return (
          <g key={n.id} transform={`translate(${p.x - NODE_W / 2}, ${p.y - NODE_H / 2})`} className="cursor-pointer" onClick={() => onSelect(n.id)}>
            {isNext && (
              <rect x="-5" y="-5" width={NODE_W + 10} height={NODE_H + 10} rx="14" fill="none" stroke="#f97316" strokeWidth="1.6" strokeDasharray="5 4" className="animate-breathe" />
            )}
            <rect width={NODE_W} height={NODE_H} rx="12" fill={f.bg} stroke={isSel ? "#f97316" : f.border} strokeWidth={isSel ? 2.2 : 1.5} />
            <text x={NODE_W / 2} y={19} textAnchor="middle" fontSize="12.5" fontWeight={700} fill={f.text}>
              {n.name}
            </text>
            <rect x="14" y={NODE_H - 16} width={NODE_W - 28} height="5" rx="2.5" fill="#e2e8f0" />
            <rect x="14" y={NODE_H - 16} width={(NODE_W - 28) * Math.min(1, n.mastery)} height="5" rx="2.5" fill={f.bar} />
            {n.order && (
              <g>
                <circle cx={NODE_W - 3} cy="3" r="10" fill="#f97316" />
                <text x={NODE_W - 3} y="6.5" textAnchor="middle" fontSize="10" fontWeight={800} fill="#fff">
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
