"use client";

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
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <Chat onEvent={onEvent} />

      <aside className="hidden lg:block">
        <div className="sticky top-[5.5rem] space-y-3">
          <div className="grid grid-cols-2 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
            {(
              [
                ["trace", "编排追踪"],
                ["profile", "学生画像"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  tab === key ? "bg-blue-600 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
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
