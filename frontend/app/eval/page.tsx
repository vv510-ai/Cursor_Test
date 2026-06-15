"use client";
/** 学情评估页:GET /api/eval/report —— 画像雷达 + 掌握度全景条形 +
 *  答题正确率 + 薄弱/强项 + 近期学习事件流(评估闭环的可视化出口)。 */
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
  path_replan: "路径重排",
  chat: "学习对话",
};

export default function EvalPage() {
  const [rep, setRep] = useState<Report | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    apiGet<Report>(`/eval/report?user_id=${USER_ID}`)
      .then(setRep)
      .catch(() => setErr("还没有学情数据 —— 先去对话或答题,评估智能体会自动建档。"));
  }, []);

  if (err) return <div className="rounded-xl border border-dashed border-hairline p-12 text-center text-xs text-muted">{err}</div>;
  if (!rep) return <div className="py-20 text-center font-mono text-xs text-muted">LOADING REPORT …</div>;

  const acc = rep.attempts.accuracy;

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <div className="space-y-3">
        <ProfileRadar profile={rep.profile} />
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-hairline bg-panel/40 p-3 text-center">
            <div className="font-mono text-[9px] tracking-[0.2em] text-muted">QUIZ ROUNDS</div>
            <div className="mt-1 text-2xl font-bold text-slate-100">{rep.attempts.total}</div>
            <div className="text-[10px] text-muted">累计答题轮次</div>
          </div>
          <div className="rounded-xl border border-hairline bg-panel/40 p-3 text-center">
            <div className="font-mono text-[9px] tracking-[0.2em] text-muted">ACCURACY</div>
            <div className={`mt-1 text-2xl font-bold ${acc == null ? "text-muted" : acc >= 0.7 ? "text-mint" : "text-ember"}`}>
              {acc == null ? "—" : `${Math.round(acc * 100)}%`}
            </div>
            <div className="text-[10px] text-muted">近 100 轮平均正确率</div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <section className="rounded-xl border border-hairline bg-panel/40 p-4">
          <div className="font-mono text-[10px] tracking-[0.25em] text-spark">MASTERY PANORAMA</div>
          <h2 className="mb-3 mt-1 text-lg font-bold text-slate-100">16 个知识点掌握全景</h2>
          <div className="space-y-1.5">
            {rep.radar.map((r) => (
              <div key={r.kp} className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-right text-xs text-body">{r.name}</span>
                <div className="h-2 flex-1 rounded bg-hairline/70">
                  <div
                    className={`h-2 rounded ${r.mastery >= 0.8 ? "bg-mint" : r.mastery >= 0.5 ? "bg-spark" : "bg-ember"}`}
                    style={{ width: `${Math.max(3, Math.round(r.mastery * 100))}%` }}
                  />
                </div>
                <span className="w-10 shrink-0 font-mono text-[10px] text-muted">{Math.round(r.mastery * 100)}%</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px]">
            <span className="text-muted">
              优先补强:{rep.weakest.map((w) => <b key={w.name} className="mx-0.5 font-medium text-ember">{w.name}</b>)}
            </span>
            <span className="text-muted">
              优势区:{rep.strongest.map((s) => <b key={s.name} className="mx-0.5 font-medium text-mint">{s.name}</b>)}
            </span>
          </div>
        </section>

        <section className="rounded-xl border border-hairline bg-panel/40 p-4">
          <div className="font-mono text-[10px] tracking-[0.25em] text-ember">ACTIVITY LOG · 近期学习事件</div>
          <div className="mt-2 space-y-1.5">
            {rep.events.map((e, i) => (
              <div key={i} className="flex items-baseline gap-3 border-b border-hairline/50 pb-1.5 text-xs last:border-0">
                <span className="shrink-0 font-mono text-[10px] text-muted">{e.ts?.slice(11, 19) || "—"}</span>
                <span className="text-body">{ETYPE[e.etype] || e.etype}</span>
                <span className="ml-auto truncate font-mono text-[10px] text-muted">
                  {e.etype === "quiz_eval" && e.payload?.errors
                    ? `错因:${Object.keys(e.payload.errors as object).slice(0, 2).join("、") || "无"}`
                    : e.etype === "generate_done"
                      ? `${(e.payload?.n as number) ?? "?"} 份 · ${((e.payload?.kinds as string[]) || []).join("/")}`
                      : ""}
                </span>
              </div>
            ))}
            {rep.events.length === 0 && <div className="text-xs text-muted">暂无事件 —— 学习行为会自动记录于此。</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
