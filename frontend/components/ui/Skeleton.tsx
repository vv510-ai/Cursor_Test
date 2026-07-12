/** Phase D · 骨架屏:加载中的占位块。配合 globals.css 的 .skeleton 微光动画。 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`skeleton ${className}`} />;
}

/** 整块面板骨架:标题行 + 若干内容行。用于页面级 loading。 */
export function SkeletonPanel({
  lines = 4,
  className = "",
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-6 w-2/5" />
      <div className="mt-4 space-y-2.5">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className={`h-3.5 ${i % 3 === 2 ? "w-3/5" : "w-full"}`} />
        ))}
      </div>
    </div>
  );
}
