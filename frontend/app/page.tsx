"use client";
/** 主页(学习对话):左侧对话流 + 右侧任务遥测面板。
 *  Chat 上抛的 SSE 事件同时驱动 AgentTrace(编排可视化)与 ProfileRadar(随学随新画像)。 */
import { useCallback, useEffect, useState } from "react";
import Chat from "@/components/chat/Chat";
import AgentTrace, { applyTraceEvent, emptyTrace, type TraceState } from "@/components/agent/AgentTrace";
import ProfileRadar from "@/components/profile/ProfileRadar";
import { USER_ID, apiGet } from "@/lib/api";
import type { SparkEvent, StudentProfile } from "@/lib/types";

export default function Home() {
  const [trace, setTrace] = useState<TraceState>(emptyTrace());
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [tab, setTab] = useState<"trace" | "profile">("trace");

  useEffect(() => {
    apiGet<StudentProfile>(`/profile/${USER_ID}`).then(setProfile).catch(() => {});
  }, []);

  const onEvent = useCallback((ev: SparkEvent) => {
    setTrace((t) => applyTraceEvent(t, ev));
    if (ev.type === "profile" && ev.profile) setProfile(ev.profile);
    if (ev.type === "agent_start" && ev.agent === "profile") setTrace((t) => ({ ...emptyTrace(), profile: t.profile }));
  }, []);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <Chat onEvent={onEvent} />

      <aside className="hidden lg:block">
        <div className="sticky top-[4.5rem] space-y-3">
          <div className="flex gap-1 rounded-lg border border-hairline bg-panel/40 p-1">
            {(
              [
                ["trace", "AGENT TRACE", "编排遥测"],
                ["profile", "PROFILE", "学生画像"],
              ] as const
            ).map(([key, code, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs transition ${
                  tab === key ? "bg-spark/15 text-slate-100" : "text-muted hover:text-body"
                }`}
              >
                <span className="mr-1.5 font-mono text-[9px] tracking-[0.18em] text-spark/70">{code}</span>
                {label}
              </button>
            ))}
          </div>
          {tab === "trace" ? <AgentTrace trace={trace} /> : <ProfileRadar profile={profile} />}
        </div>
      </aside>
    </div>
  );
}
