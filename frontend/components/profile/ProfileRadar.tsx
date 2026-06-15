"use client";

import { useMemo } from "react";
import type { StudentProfile } from "@/lib/types";

const KP_NAME: Record<string, string> = {
  complexity: "复杂度",
  array: "数组",
  linked_list: "链表",
  stack: "栈",
  queue: "队列",
  recursion: "递归",
  sorting_basic: "基础排序",
  sorting_adv: "高级排序",
  binary_tree: "二叉树",
  bst: "BST",
  heap: "堆",
  hash: "哈希",
  graph_basic: "图基础",
  graph_traverse: "图遍历",
  shortest_path: "最短路",
  dp: "动态规划",
};

function asText(v: unknown, fallback = "未记录") {
  if (v == null || v === "") return fallback;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function Radar({ data }: { data: { name: string; v: number }[] }) {
  const size = 220;
  const cx = size / 2;
  const cy = size / 2;
  const R = 78;
  const n = data.length;
  const pt = (i: number, r: number) => {
    const ang = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)] as const;
  };
  const poly = data.map((d, i) => pt(i, R * Math.max(0.04, d.v)).join(",")).join(" ");
  const rings = [0.33, 0.66, 1];

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto block w-full max-w-[240px]">
      {rings.map((r) => (
        <polygon
          key={r}
          points={data.map((_, i) => pt(i, R * r).join(",")).join(" ")}
          fill="none"
          stroke="#dbe3ee"
          strokeWidth="1"
        />
      ))}
      {data.map((_, i) => {
        const [x, y] = pt(i, R);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#dbe3ee" strokeWidth="1" />;
      })}
      <polygon points={poly} fill="rgba(37,99,235,.16)" stroke="#2563eb" strokeWidth="1.8" />
      {data.map((d, i) => {
        const [x, y] = pt(i, R * Math.max(0.04, d.v));
        return <circle key={i} cx={x} cy={y} r="3" fill={d.v >= 0.8 ? "#059669" : d.v >= 0.5 ? "#2563eb" : "#f97316"} />;
      })}
      {data.map((d, i) => {
        const [x, y] = pt(i, R + 20);
        return (
          <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize="10.5" fill="#64748b">
            {d.name}
          </text>
        );
      })}
    </svg>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-200 py-2 last:border-0">
      <span className="shrink-0 font-mono text-[10px] tracking-[0.14em] text-slate-400">{k}</span>
      <span className="truncate text-right text-xs font-medium text-slate-700">{v}</span>
    </div>
  );
}

export default function ProfileRadar({ profile }: { profile: StudentProfile | null }) {
  const radar = useMemo(() => {
    const m = profile?.knowledge_mastery || {};
    return Object.entries(m)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 6)
      .map(([k, v]) => ({ name: KP_NAME[k] || k, v: Number(v) }));
  }, [profile]);

  if (!profile) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 text-center text-sm text-slate-500 shadow-sm">
        对话或生成资源后，学生画像会在这里实时更新。
      </div>
    );
  }

  const pref = Object.entries(profile.resource_pref || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k]) => ({ doc: "图文", video: "视频", quiz: "习题", mindmap: "脑图", code: "代码" }[k] || k))
    .join(" / ");

  const fallbackRadar =
    radar.length > 0
      ? radar
      : [
          { name: "目标", v: 0.25 },
          { name: "节奏", v: 0.25 },
          { name: "偏好", v: 0.25 },
        ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-1 flex items-center justify-between">
        <div>
          <div className="font-mono text-[10px] tracking-[0.22em] text-blue-600">PROFILE v{profile.version ?? 0}</div>
          <div className="mt-1 text-sm font-bold text-slate-950">学生画像</div>
        </div>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-500">薄弱知识点</span>
      </div>
      <Radar data={fallbackRadar} />
      <div className="mt-2">
        <Row k="STYLE" v={asText(profile.cognitive_style)} />
        <Row k="GOAL" v={asText(profile.goal)} />
        <Row k="PACE" v={asText(profile.pace, "常规节奏")} />
        <Row k="DIFF" v={asText(profile.difficulty_pref, "循序渐进")} />
        <Row k="PREF" v={pref || "未记录"} />
        <Row
          k="ERROR"
          v={
            profile.error_prone?.length ? (
              <span className="text-orange-700">{profile.error_prone.slice(0, 3).join(" / ")}</span>
            ) : (
              "暂无错因"
            )
          }
        />
      </div>
    </div>
  );
}
