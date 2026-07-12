import type { ReactNode } from "react";

type NoticeVariant = "info" | "warn" | "error" | "success";

const VARIANT: Record<NoticeVariant, { box: string; dot: string }> = {
  info: { box: "border-emerald-200 bg-emerald-50 text-emerald-900", dot: "bg-emerald-500" },
  warn: { box: "border-orange-200 bg-orange-50 text-orange-900", dot: "bg-orange-500" },
  error: { box: "border-rose-200 bg-rose-50 text-rose-900", dot: "bg-rose-500" },
  success: { box: "border-emerald-200 bg-emerald-50 text-emerald-900", dot: "bg-emerald-500" },
};

export function Notice({
  variant = "info",
  tone,
  title,
  desc,
  children,
  action,
  className = "",
}: {
  variant?: NoticeVariant;
  tone?: NoticeVariant;
  title?: ReactNode;
  desc?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const v = VARIANT[tone || variant];
  const body = children ?? desc;
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${v.box} ${className}`}>
      <div className="flex items-start gap-2">
        <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${v.dot}`} />
        <div className="min-w-0 flex-1 text-sm">
          {title != null && <div className="font-bold">{title}</div>}
          {body != null && <div className={`${title != null ? "mt-0.5 " : ""}text-xs leading-5 opacity-90`}>{body}</div>}
        </div>
        {action != null && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}

