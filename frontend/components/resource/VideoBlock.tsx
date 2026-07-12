"use client";

import { useEffect, useState } from "react";
import { Notice } from "@/components/ui";
import { apiGet } from "@/lib/api";
import type { ResourceItem } from "@/lib/types";

export default function VideoBlock({ payload }: { payload: ResourceItem["payload"] }) {
  const [video, setVideo] = useState(payload.video);
  const [polling, setPolling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pollError, setPollError] = useState("");
  const script = payload.script;
  const scenes = script?.scenes || [];

  useEffect(() => {
    setVideo(payload.video);
  }, [payload.video]);

  async function poll() {
    if (!video?.task_id) return;
    setPolling(true);
    setPollError("");
    try {
      const r = await apiGet<{ status: string; url?: string }>(`/resources/video/task/${video.task_id}`);
      setVideo((v) => ({ ...v, ...r }));
    } catch {
      setPollError("状态查询失败,稍后再试。");
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

  if (!video && !script && !payload.manim_code && !payload.audio_url && !payload.cover_url) {
    return (
      <Notice
        tone="warn"
        title="讲解资源为空"
        desc="没有视频任务、分镜脚本、旁白或降级动画代码。可重新生成该类型资源。"
      />
    );
  }

  return (
    <div className="space-y-3">
      {video?.url ? (
        <video src={video.url} controls poster={payload.cover_url} className="w-full rounded-xl border border-slate-200 bg-black" />
      ) : video?.task_id ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs">
          <span className="min-w-0 text-slate-700">
            视频云端生成中,可先阅读下方分镜脚本
            <span className="ml-2 font-mono text-[10px] text-slate-500">任务 {video.task_id.slice(0, 10)}...</span>
          </span>
          <button
            onClick={poll}
            disabled={polling}
            className="shrink-0 rounded-md border border-emerald-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50"
          >
            {polling ? "查询中..." : "刷新状态"}
          </button>
        </div>
      ) : video?.status === "failed" || video?.status === "timeout" ? (
        <Notice
          tone="error"
          title={`视频生成${video.status === "timeout" ? "超时" : "失败"}`}
          desc={`${video.error || video.reason || "请查看后端任务日志"}。下方分镜脚本与动画代码不受影响,可直接用于讲解。`}
        />
      ) : video?.status === "degraded" ? (
        <Notice
          tone="info"
          title="已按预案切换为脚本讲解"
          desc="真实视频服务当前未接入,系统自动改为交付分镜脚本 + Manim 动画代码,讲解内容完整可用。"
        />
      ) : payload.cover_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={payload.cover_url} alt="视频封面" className="w-full rounded-xl border border-slate-200" />
      ) : null}

      {pollError && <Notice tone="error" title={pollError} />}

      {script && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-mono text-[11px] tracking-[0.18em] text-emerald-600">STORYBOARD · 分镜脚本</span>
            {script.title && <span className="text-xs font-semibold text-slate-700">{script.title}</span>}
          </div>
          {scenes.length > 0 ? (
            scenes.map((s, i) => (
              <div key={i} className="flex gap-3 border-b border-slate-200 py-2 text-xs last:border-0">
                <span className="w-14 shrink-0 font-mono text-[10px] text-slate-500">{s.t}</span>
                <span className="flex-1 text-slate-700">{s.visual}</span>
                {s.caption && <span className="shrink-0 text-slate-500">「{s.caption}」</span>}
              </div>
            ))
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
              本条没有分镜列表,以下为完整旁白。
            </div>
          )}
          {script.narration && <p className="mt-2 text-xs leading-6 text-slate-600">旁白:{script.narration}</p>}
        </div>
      )}

      {payload.audio_url && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 font-mono text-[11px] tracking-[0.18em] text-emerald-600">TTS · 讲解旁白音频</div>
          <audio src={payload.audio_url} controls className="w-full" />
        </div>
      )}

      {payload.manim_code && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-950">
          <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
            <span className="font-mono text-[10px] tracking-[0.18em] text-slate-300">MANIM · 降级动画代码(可直接渲染)</span>
            <button
              onClick={copyManim}
              className="rounded-md border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-300 transition hover:border-emerald-400 hover:text-emerald-300"
            >
              {copied ? "已复制" : "复制代码"}
            </button>
          </div>
          <pre className="max-h-64 overflow-auto p-3 text-[11px] leading-5 text-slate-100">{payload.manim_code}</pre>
        </div>
      )}
    </div>
  );
}
