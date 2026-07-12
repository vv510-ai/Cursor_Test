import type { ReactNode } from "react";

export function CausalStrip({
  title,
  desc,
  steps,
  active,
  right,
  className = "",
}: {
  title: ReactNode;
  desc?: ReactNode;
  steps: string[];
  active: number;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-[14px] border border-[#E5E9E3] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(18,30,22,0.05),0_6px_20px_rgba(18,30,22,0.05)] ${className}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold tracking-[0.18em] text-emerald-700">学习流程</div>
          <div className="mt-1 text-sm font-bold text-[#182119]">{title}</div>
          {desc != null && <div className="mt-0.5 text-xs leading-5 text-[#57635A]">{desc}</div>}
        </div>
        {right != null && <div className="shrink-0">{right}</div>}
      </div>

      <ol className="mt-3 grid gap-2 md:grid-cols-5">
        {steps.map((step, i) => {
          const done = i < active;
          const now = i === active;
          return (
            <li
              key={step}
              className={`rounded-[10px] border px-3 py-2 ${
                now
                  ? "border-[#0E1411] bg-[#0E1411] text-white shadow-sm"
                  : done
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-[#E5E9E3] bg-[#FBFCFA]"
              }`}
            >
              <div
                className={`font-mono text-[11px] font-black ${
                  now ? "text-white/65" : done ? "text-emerald-700" : "text-[#8B958D]"
                }`}
              >
                {String(i + 1).padStart(2, "0")}
              </div>
              <div className={`mt-0.5 text-xs font-bold ${now ? "text-white" : "text-[#57635A]"}`}>
                {step}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

