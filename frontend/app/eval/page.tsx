"use client";

import { useEffect, useState } from "react";
import ProfileRadar from "@/components/profile/ProfileRadar";
import { USER_ID, apiGet } from "@/lib/api";
import type { StudentProfile } from "@/lib/types";

interface Report {
  profile: StudentProfile;
  radar: { kp: string; name: string; mastery: number }[];
  weakest: { name: string; mastery: number }[];
  strongest: { name: string; mastery: number }[];
  attempts: { total: number; accuracy: number | null };
  events: { etype: string; payload: Record<string, unknown>; ts: string }[];
}

const ETYPE: Record<string, string> = {
  generate_done: "资源生成完成",
  quiz_eval: "完成一次答题评估",
  path_replan: "学习路径重排",
  chat: "学习对话",
};

function pct(value?: number | null) {
  return value == null ? "-" : `${Math.round(value * 100)}%`;
}

export default function EvalPage() {
  const [rep, setRep] = useState<Report | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    apiGet<Report>(`/eval/report?user_id=${USER_ID}`)
      .then(setRep)
      .catch(() => setErr("还没有学情数据。先去对话或答题，评估智能体会自动建档。"));
  }, []);

  if (err) return <div className="rounded-xl border border-dashed border-slate-300 bg-white/70 p-12 text-center text-sm text-slate-500">{err}</div>;
  if (!rep) return <div className="py-20 text-center font-mono text-xs text-slate-500">LOADING REPORT...</div>;

  const acc = rep.attempts.accuracy;
  const binaryTree = rep.radar.find((r) => r.kp === "binary_tree");
  const sortingAdv = rep.radar.find((r) => r.kp === "sorting_adv");
  const errorTags = rep.profile.error_prone?.slice(0, 3) || [];

  return (
    <div className="grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
      <div className="space-y-4">
        <ProfileRadar profile={rep.profile} />
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
            <div className="font-mono text-[10px] tracking-[0.2em] text-slate-500">QUIZ ROUNDS</div>
            <div className="mt-1 text-3xl font-black text-slate-950">{rep.attempts.total}</div>
            <div className="text-xs text-slate-500">累计答题轮次</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
            <div className="font-mono text-[10px] tracking-[0.2em] text-slate-500">ACCURACY</div>
            <div className={`mt-1 text-3xl font-black ${acc == null ? "text-slate-400" : acc >= 0.7 ? "text-emerald-600" : "text-orange-600"}`}>
              {acc == null ? "-" : `${Math.round(acc * 100)}%`}
            </div>
            <div className="text-xs text-slate-500">近 100 轮平均正确率</div>
          </div>
        </div>
      </div>

      <div className="space-y-5">
        <section className="rounded-xl border border-orange-200 bg-orange-50 p-5 shadow-sm">
          <div className="font-mono text-[10px] tracking-[0.24em] text-orange-600">DEMO CAUSAL CHAIN</div>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">做题后画像怎么变</h1>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-white/70 bg-white px-3 py-3">
              <div className="text-xs font-bold text-slate-500">综合正确率</div>
              <div className={`mt-1 text-3xl font-black ${acc == null ? "text-slate-400" : acc >= 0.7 ? "text-emerald-600" : "text-orange-600"}`}>
                {pct(acc)}
              </div>
              <div className="mt-1 text-xs text-slate-500">两组题真实提交后的平均</div>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-white px-3 py-3">
              <div className="text-xs font-bold text-emerald-700">二叉树答对</div>
              <div className="mt-1 text-3xl font-black text-emerald-600">{pct(binaryTree?.mastery)}</div>
              <div className="mt-1 text-xs text-slate-500">掌握度上升，进入已掌握</div>
            </div>
            <div className="rounded-lg border border-orange-200 bg-white px-3 py-3">
              <div className="text-xs font-bold text-orange-700">高级排序答错</div>
              <div className="mt-1 text-3xl font-black text-orange-600">{pct(sortingAdv?.mastery)}</div>
              <div className="mt-1 text-xs text-slate-500">掌握度下降，错因回写画像</div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {errorTags.length > 0 ? (
              errorTags.map((tag) => (
                <span key={tag} className="rounded-full border border-orange-200 bg-white px-3 py-1 text-xs font-bold text-orange-700">
                  {tag}
                </span>
              ))
            ) : (
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500">暂无错因标签</span>
            )}
          </div>
        </section>

        <section className="glass-panel rounded-xl p-5">
          <div className="font-mono text-[10px] tracking-[0.24em] text-blue-600">MASTERY PANORAMA</div>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">知识点掌握全景</h1>
          <div className="mt-4 space-y-2">
            {rep.radar.map((r) => (
              <div key={r.kp} className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-right text-sm font-medium text-slate-700">{r.name}</span>
                <div className="h-2.5 flex-1 rounded-full bg-slate-200">
                  <div
                    className={`h-2.5 rounded-full ${r.mastery >= 0.8 ? "bg-emerald-500" : r.mastery >= 0.5 ? "bg-blue-600" : "bg-orange-500"}`}
                    style={{ width: `${Math.max(3, Math.round(r.mastery * 100))}%` }}
                  />
                </div>
                <span className="w-12 shrink-0 font-mono text-xs text-slate-500">{Math.round(r.mastery * 100)}%</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            <span className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-orange-700">
              优先补强：{rep.weakest.map((w) => w.name).join(" / ") || "暂无"}
            </span>
            <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-700">
              优势区：{rep.strongest.map((s) => s.name).join(" / ") || "暂无"}
            </span>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="font-mono text-[10px] tracking-[0.24em] text-orange-600">ACTIVITY LOG</div>
          <h2 className="mt-1 text-lg font-black text-slate-950">近期学习事件</h2>
          <div className="mt-3 space-y-2">
            {rep.events.map((e, i) => (
              <div key={i} className="flex items-baseline gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <span className="shrink-0 font-mono text-[10px] text-slate-500">{e.ts?.slice(11, 19) || "-"}</span>
                <span className="font-semibold text-slate-800">{ETYPE[e.etype] || e.etype}</span>
                <span className="ml-auto truncate font-mono text-[10px] text-slate-500">
                  {e.etype === "quiz_eval" && e.payload?.errors
                    ? `错因：${Object.keys(e.payload.errors as object).slice(0, 2).join(" / ") || "无"}`
                    : e.etype === "generate_done"
                      ? `${(e.payload?.n as number) ?? "?"} 个 · ${((e.payload?.kinds as string[]) || []).join("/")}`
                      : ""}
                </span>
              </div>
            ))}
            {rep.events.length === 0 && <div className="text-sm text-slate-500">暂无事件。学习行为会自动记录在这里。</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
