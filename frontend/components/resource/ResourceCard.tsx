"use client";
/** ResourceCard —— 资源统一卡片:
 *  doc/code/reading → Markdown(含 [^n] 引用);mindmap → Markmap 交互脑图;
 *  quiz → QuizPlayer 答题闭环;video → VideoBlock。页脚展示引用溯源与防幻觉标记。 */
import { useState } from "react";
import type { ResourceItem } from "@/lib/types";
import Markdown from "@/components/chat/Markdown";
import Markmap from "./Markmap";
import QuizPlayer from "./QuizPlayer";
import VideoBlock from "./VideoBlock";

const KIND_META: Record<string, { label: string; code: string; tone: string }> = {
  doc: { label: "图文教程", code: "DOC", tone: "text-spark border-spark/40" },
  code: { label: "代码示例", code: "CODE", tone: "text-mint border-mint/40" },
  reading: { label: "拓展阅读", code: "READ", tone: "text-body border-hairline" },
  mindmap: { label: "思维导图", code: "MAP", tone: "text-spark border-spark/40" },
  quiz: { label: "智能题组", code: "QUIZ", tone: "text-ember border-ember/40" },
  video: { label: "讲解视频", code: "VID", tone: "text-ember border-ember/40" },
};

export default function ResourceCard({ r, defaultOpen = false }: { r: ResourceItem; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const meta = KIND_META[r.kind] || { label: r.kind, code: r.kind.toUpperCase(), tone: "text-body border-hairline" };
  const grounded = r.payload?.grounded;

  return (
    <div className="animate-rise rounded-xl border border-hairline bg-panel/60">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left"
      >
        <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] tracking-[0.18em] ${meta.tone}`}>
          {meta.code}
        </span>
        <span className="flex-1 truncate text-[13px] font-medium text-slate-100">{r.title}</span>
        {grounded === false && (
          <span className="rounded border border-ember/50 bg-ember/10 px-1.5 py-0.5 font-mono text-[9px] text-ember">
            溯源复核
          </span>
        )}
        <span className="font-mono text-[10px] text-muted">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="border-t border-hairline px-3.5 py-3">
          {r.kind === "mindmap" && r.payload.markmap ? (
            <Markmap markdown={r.payload.markmap} />
          ) : r.kind === "quiz" && r.payload.questions ? (
            <QuizPlayer resourceId={r.id} questions={r.payload.questions} />
          ) : r.kind === "video" ? (
            <VideoBlock payload={r.payload} />
          ) : r.payload.markdown ? (
            <Markdown text={r.payload.markdown} />
          ) : (
            <pre className="overflow-auto text-xs text-muted">{JSON.stringify(r.payload, null, 2)}</pre>
          )}

          {r.citations?.length > 0 && (
            <div className="mt-3 rounded-lg border border-hairline/70 bg-ink/40 px-3 py-2">
              <div className="mb-1 font-mono text-[9px] tracking-[0.2em] text-muted">CITATIONS · 引用溯源</div>
              {r.citations.map((c, i) => (
                <div key={i} className="text-[11px] leading-5 text-muted">
                  <span className="font-mono text-ember/80">[{i + 1}]</span> {c}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
