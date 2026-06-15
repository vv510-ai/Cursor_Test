"use client";
/** ProfileRadar —— 学生画像面板:
 *  掌握度雷达(取最薄弱/代表性的 6 个知识点,零依赖手写 SVG)+ 八维画像摘要。 */
import { useMemo } from "react";
import type { StudentProfile } from "@/lib/types";

const KP_NAME: Record<string, string> = {
  complexity: "复杂度", array: "数组", linked_list: "链表", stack: "栈",
  queue: "队列", recursion: "递归", sorting_basic: "基础排序", sorting_adv: "高级排序",
  binary_tree: "二叉树", bst: "BST", heap: "堆", hash: "哈希",
  graph_basic: "图基础", graph_traverse: "图遍历", shortest_path: "最短路", dp: "动态规划",
};

function Radar({ data }: { data: { name: string; v: number }[] }) {
  const size = 220, cx = size / 2, cy = size / 2, R = 78;
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
          fill="none" stroke="#1e2a45" strokeWidth="1"
        />
      ))}
      {data.map((_, i) => {
        const [x, y] = pt(i, R);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#1e2a45" strokeWidth="1" />;
      })}
      <polygon points={poly} fill="rgba(56,189,248,.18)" stroke="#38bdf8" strokeWidth="1.5" />
      {data.map((d, i) => {
        const [x, y] = pt(i, R * Math.max(0.04, d.v));
        return <circle key={i} cx={x} cy={y} r="2.5" fill={d.v >= 0.8 ? "#34d399" : d.v >= 0.5 ? "#38bdf8" : "#fb923c"} />;
      })}
      {data.map((d, i) => {
        const [x, y] = pt(i, R + 18);
        return (
          <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="middle"
            fontSize="10" fill="#7c8db0">
            {d.name}
          </text>
        );
      })}
    </svg>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-hairline/60 py-1.5 last:border-0">
      <span className="shrink-0 font-mono text-[10px] tracking-[0.15em] text-muted">{k}</span>
      <span className="truncate text-right text-xs text-body">{v}</span>
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

  if (!profile)
    return (
      <div className="rounded-xl border border-hairline bg-panel/40 p-4 text-center text-xs text-muted">
        与学伴对话或生成资源后,画像将在此实时构建。
      </div>
    );

  const pref = Object.entries(profile.resource_pref || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k]) => ({ doc: "图文", video: "视频", quiz: "习题", mindmap: "脑图", code: "代码" }[k] || k))
    .join(" / ");

  return (
    <div className="rounded-xl border border-hairline bg-panel/40 p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[10px] tracking-[0.25em] text-spark">PROFILE v{profile.version ?? 0}</span>
        <span className="font-mono text-[10px] text-muted">薄弱知识点雷达</span>
      </div>
      <Radar data={radar.length ? radar : [{ name: "—", v: 0.1 }, { name: "—", v: 0.1 }, { name: "—", v: 0.1 }]} />
      <div className="mt-1">
        <Row k="STYLE" v={profile.cognitive_style || "未知"} />
        <Row k="GOAL" v={profile.goal || "未设定"} />
        <Row k="PACE" v={profile.pace || "常规"} />
        <Row k="DIFF" v={profile.difficulty_pref || "循序渐进"} />
        <Row k="PREF" v={pref || "—"} />
        <Row
          k="ERROR"
          v={
            profile.error_prone?.length ? (
              <span className="text-ember">{profile.error_prone.slice(0, 3).join("、")}</span>
            ) : (
              "暂无记录"
            )
          }
        />
      </div>
    </div>
  );
}
