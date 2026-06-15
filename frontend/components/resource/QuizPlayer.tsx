"use client";

import { useMemo, useState } from "react";
import { USER_ID, apiPost } from "@/lib/api";
import type { QuizQuestion } from "@/lib/types";

interface Report {
  accuracy: number;
  per_kp: { name: string; mastery: number; level: string; right: number; n: number }[];
  suggestions: string[];
}

const TYPE_LABEL: Record<string, string> = {
  single: "单选",
  fill: "填空",
  judge: "判断",
  design: "简答",
  complexity: "复杂度",
};

function normalize(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, "").replace(/[()（）]/g, "");
}

function isCorrect(q: QuizQuestion, ans: string): boolean {
  if (!ans) return false;
  if (q.type === "single" || q.type === "complexity") return normalize(ans)[0] === normalize(q.answer)[0];
  if (q.type === "judge") {
    const yes = ["对", "true", "t", "yes", "y", "正确"];
    return yes.includes(normalize(ans)) === yes.includes(normalize(q.answer));
  }
  if (q.type === "fill") return normalize(ans) === normalize(q.answer);
  return ans.trim().length >= 8;
}

export default function QuizPlayer({ resourceId, questions }: { resourceId: string; questions: QuizQuestion[] }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);

  const results = useMemo(
    () => Object.fromEntries(questions.map((q) => [q.id, isCorrect(q, answers[q.id] || "")])),
    [questions, answers],
  );
  const set = (id: string, v: string) => !submitted && setAnswers((a) => ({ ...a, [id]: v }));

  async function submit() {
    setBusy(true);
    setSubmitted(true);
    try {
      const rep = await apiPost<Report>("/eval/submit", {
        user_id: USER_ID,
        quiz_resource_id: resourceId,
        kp: questions[0]?.kp || "",
        answers: questions.map((q) => ({
          question_id: q.id,
          answer: answers[q.id] || "",
          correct: results[q.id],
          seconds: 0,
        })),
        behavior: {},
      });
      setReport(rep);
    } catch {
      setReport(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {questions.map((q, i) => {
        const mine = answers[q.id] || "";
        const ok = results[q.id];
        return (
          <div key={q.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 flex items-start gap-2 text-sm text-slate-900">
              <span className="font-mono text-[10px] leading-5 text-blue-600">Q{i + 1}</span>
              <span className="flex-1 font-medium">{q.stem}</span>
              <span className="shrink-0 rounded-full border border-slate-200 bg-white px-2 py-1 font-mono text-[10px] text-slate-500">
                {TYPE_LABEL[q.type] || q.type} · D{q.difficulty}
              </span>
            </div>

            {q.type === "single" || q.type === "complexity" ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {q.options.map((op, j) => {
                  const tag = String.fromCharCode(65 + j);
                  const chosen = mine === tag;
                  const isAns = submitted && normalize(q.answer)[0] === tag.toLowerCase();
                  return (
                    <button
                      key={j}
                      onClick={() => set(q.id, tag)}
                      className={`rounded-lg border px-3 py-2 text-left text-xs transition ${
                        isAns
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : chosen
                            ? submitted
                              ? "border-rose-300 bg-rose-50 text-rose-700"
                              : "border-blue-300 bg-blue-50 text-blue-700"
                            : "border-slate-200 bg-white text-slate-700 hover:border-blue-200"
                      }`}
                    >
                      <span className="mr-2 font-mono text-[10px] text-blue-600">{tag}</span>
                      {op.replace(/^[A-D][.、:：]\s*/, "")}
                    </button>
                  );
                })}
              </div>
            ) : q.type === "judge" ? (
              <div className="flex gap-2">
                {["对", "错"].map((v) => {
                  const chosen = mine === v;
                  const isAns = submitted && normalize(q.answer) === normalize(v);
                  return (
                    <button
                      key={v}
                      onClick={() => set(q.id, v)}
                      className={`rounded-lg border px-4 py-2 text-xs ${
                        isAns
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : chosen
                            ? submitted
                              ? "border-rose-300 bg-rose-50 text-rose-700"
                              : "border-blue-300 bg-blue-50 text-blue-700"
                            : "border-slate-200 bg-white text-slate-700 hover:border-blue-200"
                      }`}
                    >
                      {v}
                    </button>
                  );
                })}
              </div>
            ) : (
              <textarea
                value={mine}
                onChange={(e) => set(q.id, e.target.value)}
                rows={q.type === "fill" ? 1 : 3}
                placeholder={q.type === "fill" ? "填写答案" : "写下你的思路与答案"}
                className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
              />
            )}

            {submitted && (
              <div className={`mt-2 rounded-lg border px-3 py-2 text-xs ${ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-orange-200 bg-orange-50 text-orange-700"}`}>
                {ok ? "回答正确" : `参考答案：${q.answer}`}
                {q.explain && <span className="mt-1 block text-slate-600">{q.explain}</span>}
                {!ok && q.error_tags?.length > 0 && (
                  <span className="mt-1 block font-mono text-[10px] text-orange-700">
                    错因标签：{q.error_tags.join(" / ")}，已回写画像
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}

      {!submitted ? (
        <button
          onClick={submit}
          disabled={Object.keys(answers).length === 0}
          className="w-full rounded-lg bg-orange-500 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          提交并更新掌握度
        </button>
      ) : busy ? (
        <div className="text-center font-mono text-xs text-slate-500">评估智能体计算中...</div>
      ) : report ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs">
          <div className="mb-1 font-mono text-[10px] tracking-[0.18em] text-blue-600">EVAL REPORT</div>
          <div className="text-slate-700">
            正确率 <span className="font-mono text-blue-700">{Math.round(report.accuracy * 100)}%</span>
            {report.per_kp.map((p) => (
              <span key={p.name} className="ml-3">
                {p.name} 掌握度 <span className="font-mono text-emerald-700">{Math.round(p.mastery * 100)}%</span>({p.level})
              </span>
            ))}
          </div>
          <ul className="mt-2 space-y-1 text-slate-600">
            {report.suggestions.map((s, i) => (
              <li key={i}>· {s}</li>
            ))}
          </ul>
          <div className="mt-2 font-mono text-[10px] text-slate-500">学习路径已按新掌握度自动重排</div>
        </div>
      ) : (
        <div className="text-center text-xs text-slate-500">报告获取失败，可稍后在“学情评估”页查看。</div>
      )}
    </div>
  );
}
