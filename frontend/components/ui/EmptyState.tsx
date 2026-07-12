import type { ReactNode } from "react";

/**
 * Phase 0 · 统一空态。只陈述现状 + 给出可执行动作,不用假数据填充。
 */
export function EmptyState({
  icon,
  title,
  desc,
  action,
  className = "",
}: {
  icon?: ReactNode;
  title: ReactNode;
  desc?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-dashed border-slate-300 bg-white/70 px-6 py-10 text-center ${className}`}
    >
      {icon != null && <div className="mb-3 flex justify-center text-slate-400">{icon}</div>}
      <div className="text-sm font-bold text-slate-700">{title}</div>
      {desc != null && (
        <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-slate-500">{desc}</p>
      )}
      {action != null && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
