export type DotStatus = "idle" | "running" | "done" | "error";

const DOT: Record<DotStatus, string> = {
  idle: "bg-slate-300",
  running: "bg-emerald-500 animate-pulse",
  done: "bg-emerald-500",
  error: "bg-rose-500",
};

/**
 * Phase 0 · 统一状态点:idle 灰 / running 松绿(呼吸)/ done 绿 / error 玫红。
 * 注:状态点属于"点",不在徽章禁用 rounded-full 的范围内。
 */
export function StatusDot({
  status,
  className = "",
}: {
  status: DotStatus;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT[status]} ${className}`}
    />
  );
}
