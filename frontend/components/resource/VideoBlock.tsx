"use client";
/** VideoBlock —— 媒体资源呈现:
 *  有视频 URL 时直接播放;Seedance 任务进行中可轮询;降级模式展示分镜脚本 +
 *  Manim 场景代码(可复制本地渲染)+ TTS 旁白音频。 */
import { useState } from "react";
import { apiGet } from "@/lib/api";
import type { ResourceItem } from "@/lib/types";

export default function VideoBlock({ payload }: { payload: ResourceItem["payload"] }) {
  const [video, setVideo] = useState(payload.video);
  const [polling, setPolling] = useState(false);
  const [copied, setCopied] = useState(false);
  const script = payload.script;

  async function poll() {
    if (!video?.task_id) return;
    setPolling(true);
    try {
      const r = await apiGet<{ status: string; url?: string }>(`/resources/video/task/${video.task_id}`);
      setVideo((v) => ({ ...v, ...r }));
    } finally {
      setPolling(false);
    }
  }

  function copyManim() {
    if (!payload.manim_code) return;
    navigator.clipboard?.writeText(payload.manim_code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  }

  return (
    <div className="space-y-3">
      {video?.url ? (
        <video src={video.url} controls poster={payload.cover_url} className="w-full rounded-lg border border-hairline bg-black" />
      ) : video?.task_id ? (
        <div className="flex items-center justify-between rounded-lg border border-spark/40 bg-spark/5 px-3 py-2 text-xs">
          <span className="text-body">
            Seedance 视频生成中 <span className="font-mono text-[10px] text-muted">task={video.task_id.slice(0, 10)}…</span>
          </span>
          <button onClick={poll} disabled={polling} className="rounded border border-spark/50 px-2 py-1 font-mono text-[10px] text-spark hover:bg-spark/10 disabled:opacity-50">
            {polling ? "查询中…" : "刷新状态"}
          </button>
        </div>
      ) : payload.cover_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={payload.cover_url} alt="封面" className="w-full rounded-lg border border-hairline" />
      ) : null}

      {script && (
        <div className="rounded-lg border border-hairline bg-[#0d1530] p-3">
          <div className="mb-1.5 font-mono text-[10px] tracking-[0.2em] text-spark">STORYBOARD · {script.title}</div>
          {script.scenes?.map((s, i) => (
            <div key={i} className="flex gap-2 border-b border-hairline/50 py-1.5 text-xs last:border-0">
              <span className="w-14 shrink-0 font-mono text-[10px] text-ember">{s.t}</span>
              <span className="flex-1 text-body">{s.visual}</span>
              {s.caption && <span className="shrink-0 text-muted">「{s.caption}」</span>}
            </div>
          ))}
          {script.narration && <p className="mt-2 text-xs leading-6 text-muted">旁白:{script.narration}</p>}
        </div>
      )}

      {payload.audio_url && <audio src={payload.audio_url} controls className="w-full" />}

      {payload.manim_code && (
        <div className="rounded-lg border border-hairline bg-[#0a0f22]">
          <div className="flex items-center justify-between border-b border-hairline px-3 py-1.5">
            <span className="font-mono text-[10px] tracking-[0.2em] text-ember">MANIM 降级动画代码(本地 manim 渲染)</span>
            <button onClick={copyManim} className="rounded border border-hairline px-2 py-0.5 font-mono text-[10px] text-muted hover:border-spark/50 hover:text-spark">
              {copied ? "已复制 ✓" : "复制"}
            </button>
          </div>
          <pre className="max-h-64 overflow-auto p-3 text-[11px] leading-5 text-[#c8e6ff]">{payload.manim_code}</pre>
        </div>
      )}
    </div>
  );
}
