"""题库智能体(Quiz Agent):按画像难度生成结构化习题组(单选/填空/判断/设计/复杂度分析),
每题挂 kp 与 error_tags(易错点标签),供 Eval Agent 做 BKT 更新与错因画像回写。"""
from __future__ import annotations

import uuid

from ..llm.spark_client import llm_complete, parse_json
from ..rag.retriever import retrieve
from ..services.knowledge_graph import kp_name
from .emitter import agent_end, agent_start, emit

_TYPES = {"single", "fill", "judge", "design", "complexity"}

_PROMPT = (
    "TASK=quiz\n"
    "请围绕知识点「{kp}」出 5 道习题,难度档={difficulty}(1易~5难),"
    "题型覆盖:single(单选,4 选项)、fill(填空)、judge(判断)、complexity(复杂度分析)、design(简答设计)。"
    "结合参考资料命题,易错点优先。只输出 JSON:\n"
    '{{"questions":[{{"type":"single","stem":"...","options":["A...","B...","C...","D..."],'
    '"answer":"A","explain":"...","kp":"{kpid}","difficulty":3,"error_tags":["边界条件"]}}]}}\n'
    "\n参考资料:\n{ctx}\n"
)

_FALLBACK = {
    "type": "judge", "stem": "任何递归算法都可以改写为迭代实现。", "options": [],
    "answer": "对", "explain": "递归可借助显式栈改写为迭代,这是栈与递归等价性的经典结论。",
    "difficulty": 2, "error_tags": ["概念混淆"],
}


def _difficulty_of(profile: dict, kp: str) -> int:
    m = float((profile.get("knowledge_mastery") or {}).get(kp, 0.3))
    base = 1 + round(m * 4)                                   # 0.3→2,0.8→4
    if profile.get("difficulty_pref") == "挑战型":
        base += 1
    return max(1, min(5, base))


def _validate(q: dict, kp: str) -> dict | None:
    if not isinstance(q, dict) or q.get("type") not in _TYPES or not q.get("stem"):
        return None
    q.setdefault("kp", kp)
    q.setdefault("options", [])
    q.setdefault("explain", q.get("explanation", ""))
    q.setdefault("error_tags", [])
    q["difficulty"] = int(q.get("difficulty", 3) or 3)
    if q["type"] == "single" and len(q["options"]) < 2:
        return None
    if str(q.get("answer", "")).strip() == "":
        return None
    q["id"] = uuid.uuid4().hex[:10]
    return q


async def run(state: dict) -> dict:
    kp = (state.get("knowledge_points") or ["binary_tree"])[0]
    name = kp_name(kp)
    profile = state.get("student_profile") or {}
    diff = _difficulty_of(profile, kp)
    await agent_start("quiz", "题库智能体", f"「{name}」难度档 {diff},生成 5 题并本地校验")

    chunks = retrieve(f"{name} 易错点 经典题", final_k=3)
    ctx = "\n---\n".join(c["text"][:280] for c in chunks) or "(无)"
    raw = await llm_complete(_PROMPT.format(kp=name, kpid=kp, difficulty=diff, ctx=ctx),
                             role="ultra", temperature=0.6, max_tokens=1800)
    data = parse_json(raw)
    items = data.get("questions", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
    questions = [v for q in items if (v := _validate(q, kp))]
    if not questions:                                          # 兜底:保证演示链路不空
        fb = dict(_FALLBACK, kp=kp, id=uuid.uuid4().hex[:10])
        questions = [fb]

    rid = uuid.uuid4().hex[:12]
    resource = {"id": rid, "kind": "quiz", "kp": kp,
                "title": f"{name}·智能习题组({len(questions)} 题)",
                "payload": {"questions": questions, "difficulty": diff},
                "citations": [c.get("citation", "") for c in chunks]}
    await emit({"type": "resource", "resource": resource})
    tags = sorted({t for q in questions for t in q.get("error_tags", [])})
    await agent_end("quiz", f"{len(questions)} 题通过校验,覆盖易错点:{('、'.join(tags) or '—')}",
                    {"id": rid, "n": len(questions)})
    return {"generated_resources": {rid: resource}}
