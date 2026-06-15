"use client";
/** QuizPlayer —— 互动答题器:作答 → 本地判分 → POST /api/eval/submit
 *  (后端 BKT 更新掌握度 + 错因回写画像 + 路径重排)→ 展示评估报告与建议。 */
import { useMemo, useState } from "react";
import { USER_ID, apiPost } from "@/lib/api";
import type { QuizQuestion } from "@/lib/types";

interface Report {
  accuracy: number;
  per_kp: { name: string; mastery: number; level: string; right: number; n: number }[];
  suggestions: string[];
}

const TYPE_LABEL: Record<string, string> = {
  single: "单选", fill: "填空", judge: "判断", design: "简答", complexity: "复杂度",
};

function normalize(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, "").replace(/[()()]/g, "");
}

function isCorrect(q: QuizQuestion, ans: string): boolean {
  if (!ans) return false;
  if (q.type === "single" || q.type === "complexity")
    return normalize(ans)[0] === normalize(q.answer)[0];
  if (q.type === "judge") {
    const yes = ["对", "true", "t", "yes", "y", "√"];
    return yes.includes(normalize(ans)) === yes.includes(normalize(q.answer));
  }
  if (q.type === "fill") return normalize(ans) === normalize(q.answer);
  return ans.trim().length >= 8; // 简答:作答即给基础分,详解供自评
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
          <div key={q.id} className="rounded-lg border border-hairline bg-[#0d1530] p-3">
            <div className="mb-2 flex items-start gap-2 text-[13px] text-slate-100">
              <span className="font-mono text-[10px] leading-5 text-spark/70">Q{i + 1}</span>
              <span className="flex-1">{q.stem}</span>
              <span className="shrink-0 rounded border border-hairline px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-muted">
                {TYPE_LABEL[q.type] || q.type} · D{q.difficulty}
              </span>
            </div>

            {q.type === "single" || q.type === "complexity" ? (
              <div className="grid gap-1.5 sm:grid-cols-2">
                {q.options.map((op, j) => {
                  const tag = String.fromCharCode(65 + j);
                  const chosen = mine === tag;
                  const isAns = submitted && normalize(q.answer)[0] === tag.toLowerCase();
                  return (
                    <button
                      key={j}
                      onClick={() => set(q.id, tag)}
                      className={`rounded-md border px-2.5 py-1.5 text-left text-xs transition ${
                        isAns
                          ? "border-mint/60 bg-mint/10 text-mint"
                          : chosen
                            ? submitted
                              ? "border-rose-400/60 bg-rose-400/10 text-rose-300"
                              : "border-spark/60 bg-spark/10 text-slate-100"
                            : "border-hairline text-body hover:border-spark/40"
                      }`}
                    >
                      <span className="mr-1.5 font-mono text-[10px] text-spark/70">{tag}</span>
                      {op.replace(/^[A-D][.、::]\s*/, "")}
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
                      className={`rounded-md border px-4 py-1.5 text-xs ${
                        isAns
                          ? "border-mint/60 bg-mint/10 text-mint"
                          : chosen
                            ? submitted
                              ? "border-rose-400/60 bg-rose-400/10 text-rose-300"
                              : "border-spark/60 bg-spark/10 text-slate-100"
                            : "border-hairline text-body hover:border-spark/40"
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
                placeholder={q.type === "fill" ? "填写答案…" : "写下你的思路与答案…"}
                className="w-full resize-none rounded-md border border-hairline bg-ink/60 px-2.5 py-1.5 text-xs text-body outline-none focus:border-spark/60"
              />
            )}

            {submitted && (
              <div className={`mt-2 rounded-md border px-2.5 py-1.5 text-xs ${ok ? "border-mint/30 bg-mint/5 text-mint" : "border-ember/40 bg-ember/5 text-ember"}`}>
                {ok ? "✓ 回答正确" : `✗ 参考答案:${q.answer}`}
                {q.explain && <span className="mt-0.5 block text-muted">{q.explain}</span>}
                {!ok && q.error_tags?.length > 0 && (
                  <span className="mt-0.5 block font-mono text-[10px] text-ember/80">
                    错因标签 → {q.error_tags.join(" / ")}(已回写画像)
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
          className="w-full rounded-lg bg-ember/90 py-2 text-sm font-semibold text-ink transition hover:bg-ember disabled:cursor-not-allowed disabled:opacity-40"
        >
          提交并更新我的掌握度
        </button>
      ) : busy ? (
        <div className="text-center font-mono text-[11px] text-muted">评估智能体计算中…</div>
      ) : report ? (
        <div className="rounded-lg border border-spark/30 bg-spark/5 p-3 text-xs">
          <div className="mb-1 font-mono text-[10px] tracking-[0.2em] text-spark">EVAL REPORT</div>
          <div className="text-body">
            正确率 <span className="font-mono text-spark">{Math.round(report.accuracy * 100)}%</span>
            {report.per_kp.map((p) => (
              <span key={p.name} className="ml-3">
                {p.name} 掌握度 → <span className="font-mono text-mint">{Math.round(p.mastery * 100)}%</span>({p.level})
              </span>
            ))}
          </div>
          <ul className="mt-1.5 space-y-1 text-muted">
            {report.suggestions.map((s, i) => (
              <li key={i}>· {s}</li>
            ))}
          </ul>
          <div className="mt-1.5 font-mono text-[10px] text-muted">学习路径已按新掌握度自动重排 → 见「学习路径」页</div>
        </div>
      ) : (
        <div className="text-center text-xs text-muted">报告获取失败,可稍后在「学情评估」页查看。</div>
      )}
    </div>
  );
}
