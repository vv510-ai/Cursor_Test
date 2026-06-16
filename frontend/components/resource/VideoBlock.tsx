"use client";

import { useEffect, useState } from "react";
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
      setPollError("状态查询失败，稍后再试。");
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
      <div className="border-y border-orange-200 bg-orange-50 px-3 py-3 text-sm text-orange-800">
        <div className="font-bold">讲解资源为空</div>
        <div className="mt-1 text-xs leading-5 text-orange-700">没有视频任务、分镜脚本、旁白或降级动画代码。</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {video?.url ? (
        <video src={video.url} controls poster={payload.cover_url} className="w-full rounded-xl border border-slate-200 bg-black" />
      ) : video?.task_id ? (
        <div className="flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs">
          <span className="text-slate-700">
            Seedance 视频生成中 <span className="font-mono text-[10px] text-slate-500">task={video.task_id.slice(0, 10)}...</span>
          </span>
          <button onClick={poll} disabled={polling} className="rounded-md border border-blue-300 bg-white px-2 py-1 font-mono text-[10px] text-blue-700 hover:bg-blue-50 disabled:opacity-50">
            {polling ? "查询中..." : "刷新状态"}
          </button>
        </div>
      ) : video?.status === "failed" || video?.status === "timeout" ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          视频生成{video.status === "timeout" ? "超时" : "失败"}：{video.error || video.reason || "请查看后端任务日志"}
        </div>
      ) : video?.status === "degraded" ? (
        <div className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-700">
          视频服务已降级，当前展示分镜脚本和 Manim 动画代码。
        </div>
      ) : payload.cover_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={payload.cover_url} alt="视频封面" className="w-full rounded-xl border border-slate-200" />
      ) : null}

      {pollError && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{pollError}</div>}

      {script && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 font-mono text-[10px] tracking-[0.18em] text-blue-600">STORYBOARD · {script.title}</div>
          {scenes.length > 0 ? (
            scenes.map((s, i) => (
              <div key={i} className="flex gap-3 border-b border-slate-200 py-2 text-xs last:border-0">
                <span className="w-14 shrink-0 font-mono text-[10px] text-orange-600">{s.t}</span>
                <span className="flex-1 text-slate-700">{s.visual}</span>
                {s.caption && <span className="shrink-0 text-slate-500">《{s.caption}》</span>}
              </div>
            ))
          ) : (
            <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-700">
              分镜为空，当前仅展示旁白。
            </div>
          )}
          {script.narration && <p className="mt-2 text-xs leading-6 text-slate-600">旁白：{script.narration}</p>}
        </div>
      )}

      {payload.audio_url && <audio src={payload.audio_url} controls className="w-full" />}

      {payload.manim_code && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-950">
          <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
            <span className="font-mono text-[10px] tracking-[0.18em] text-orange-300">MANIM 降级动画代码</span>
            <button onClick={copyManim} className="rounded-md border border-slate-700 px-2 py-1 font-mono text-[10px] text-slate-300 hover:border-blue-400 hover:text-blue-300">
              {copied ? "已复制" : "复制"}
            </button>
          </div>
          <pre className="max-h-64 overflow-auto p-3 text-[11px] leading-5 text-slate-100">{payload.manim_code}</pre>
        </div>
      )}
    </div>
  );
}
