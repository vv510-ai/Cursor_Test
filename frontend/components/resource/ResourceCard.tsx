"use client";

import { useState } from "react";
import type { ResourceItem } from "@/lib/types";
import Markdown from "@/components/chat/Markdown";
import Markmap from "./Markmap";
import QuizPlayer from "./QuizPlayer";
import VideoBlock from "./VideoBlock";

const KIND_META: Record<string, { label: string; code: string; tone: string }> = {
  doc: { label: "图文教程", code: "DOC", tone: "border-blue-200 bg-blue-50 text-blue-700" },
  code: { label: "代码示例", code: "CODE", tone: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  reading: { label: "拓展阅读", code: "READ", tone: "border-slate-200 bg-slate-50 text-slate-600" },
  mindmap: { label: "思维导图", code: "MAP", tone: "border-cyan-200 bg-cyan-50 text-cyan-700" },
  quiz: { label: "智能题组", code: "QUIZ", tone: "border-orange-200 bg-orange-50 text-orange-700" },
  video: { label: "讲解视频", code: "VID", tone: "border-amber-200 bg-amber-50 text-amber-700" },
};

const TEXT_KINDS = new Set(["doc", "code", "reading"]);

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function resourceIssue(r: ResourceItem): string {
  const payload = r.payload || {};
  if (TEXT_KINDS.has(r.kind) && !hasText(payload.markdown)) return "文本内容为空";
  if (r.kind === "mindmap" && !hasText(payload.markmap)) return "脑图内容为空";
  if (r.kind === "quiz" && (!Array.isArray(payload.questions) || payload.questions.length === 0)) return "题组为空";
  if (
    r.kind === "video" &&
    !payload.script &&
    !payload.video &&
    !payload.manim_code &&
    !payload.audio_url &&
    !payload.cover_url
  ) {
    return "讲解资源为空";
  }
  return "";
}

function ResourceNotice({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="border-y border-orange-200 bg-orange-50 px-3 py-3 text-sm text-orange-800">
      <div className="font-bold">{title}</div>
      {detail && <div className="mt-1 text-xs leading-5 text-orange-700">{detail}</div>}
    </div>
  );
}

export default function ResourceCard({ r, defaultOpen = false }: { r: ResourceItem; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const meta = KIND_META[r.kind] || { label: r.kind, code: r.kind.toUpperCase(), tone: "border-slate-200 bg-slate-50 text-slate-600" };
  const grounded = r.payload?.grounded;
  const issue = resourceIssue(r);
  const payload = r.payload || {};

  return (
    <article className="animate-rise overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
      >
        <span className={`rounded-md border px-2 py-1 font-mono text-[10px] tracking-[0.16em] ${meta.tone}`}>
          {meta.code}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-slate-950">{r.title}</span>
          <span className="mt-0.5 block text-xs text-slate-500">{meta.label} · {r.kp}</span>
        </span>
        {grounded === false && (
          <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-1 text-[10px] font-medium text-orange-700">
            待复核
          </span>
        )}
        {issue && (
          <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-medium text-rose-700">
            缺字段
          </span>
        )}
        <span className="rounded-full border border-slate-200 px-2 py-1 font-mono text-xs text-slate-500">
          {open ? "-" : "+"}
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-200 px-4 py-4">
          {issue ? (
            <ResourceNotice title={issue} detail="该资源已保留在资源库中，但当前 payload 缺少前端展示所需字段。" />
          ) : r.kind === "mindmap" && payload.markmap ? (
            <Markmap markdown={payload.markmap} />
          ) : r.kind === "quiz" && payload.questions ? (
            <QuizPlayer resourceId={r.id} questions={payload.questions} />
          ) : r.kind === "video" ? (
            <VideoBlock payload={payload} />
          ) : payload.markdown ? (
            <Markdown text={payload.markdown} />
          ) : (
            <div className="space-y-2">
              <ResourceNotice title="暂未支持的资源类型" detail={`kind=${r.kind}`} />
              <pre className="max-h-72 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
                {JSON.stringify(payload, null, 2)}
              </pre>
            </div>
          )}

          {r.citations?.length > 0 && (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="mb-1 font-mono text-[10px] tracking-[0.18em] text-slate-500">CITATIONS · 引用来源</div>
              {r.citations.map((c, i) => (
                <div key={i} className="text-xs leading-5 text-slate-600">
                  <span className="font-mono text-orange-600">[{i + 1}]</span> {c}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
