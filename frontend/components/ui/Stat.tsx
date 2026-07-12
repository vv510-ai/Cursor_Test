import type { ReactNode } from "react";

export type StatTone = "neutral" | "muted" | "action" | "success" | "warn" | "danger";

const VALUE_TONE: Record<StatTone, string> = {
  neutral: "text-slate-950",
  muted: "text-slate-500",
  action: "text-emerald-600",
  success: "text-emerald-600",
  warn: "text-orange-600",
  danger: "text-rose-600",
};

/** 掌握度阈值 → 语义:>=0.8 优势(绿)/ >=0.5 进行中(蓝)/ <0.5 薄弱(橙)。全站统一。 */
export function masteryTone(mastery: number): StatTone {
  if (mastery >= 0.8) return "success";
  if (mastery >= 0.5) return "action";
  return "warn";
}

/** 掌握度阈值 → 文本颜色 class(用于行内数字着色)。 */
export function masteryTextClass(mastery: number): string {
  const t = masteryTone(mastery);
  if (t === "success") return "text-emerald-600";
  if (t === "action") return "text-emerald-600";
  return "text-orange-600";
}

/**
 * Phase 0 · Δ 标签:>0 绿升 / <0 橙降;0 或无值不渲染。
 * Phase C 的"前后对比"统一走这里。
 */
export function DeltaTag({
  delta,
  unit = "",
  className = "",
}: {
  delta?: number | null;
  unit?: string;
  className?: string;
}) {
  if (delta == null || delta === 0 || Number.isNaN(delta)) return null;
  const up = delta > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold ${
        up ? "bg-emerald-50 text-emerald-600" : "bg-orange-50 text-orange-600"
      } ${className}`}
    >
      {up ? "↑ +" : "↓ "}
      {delta}
      {unit}
    </span>
  );
}

/** Phase 0 · 统一数值卡:标签 + 大数值 + 可选 Δ + 说明。 */
export function Stat({
  label,
  value,
  sub,
  delta,
  deltaUnit,
  tone = "neutral",
  className = "",
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  delta?: number | null;
  deltaUnit?: string;
  tone?: StatTone;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-xs font-bold text-slate-500">{label}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-2">
        <span className={`text-3xl font-black tracking-tight ${VALUE_TONE[tone]}`}>{value}</span>
        <DeltaTag delta={delta} unit={deltaUnit} />
      </div>
      {sub != null && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

