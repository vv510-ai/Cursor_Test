"""评估闭环 API:
POST /api/eval/submit —— 提交答题:逐题比对 → BKT 更新掌握度 → 错因标签回写画像
                          → 路径重排 → 返回评估报告(学习闭环核心);
GET  /api/eval/report —— 学情报告(画像 + 掌握度雷达数据 + 近期事件)。"""
from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Query

from ..agents.eval_agent import evaluate_answers
from ..models.db import session
from ..models.entities import QuizAttempt, Resource
from ..schemas.core import EvalSubmit
from ..services.knowledge_graph import kp_name
from ..services.profile_service import ensure_user, get_profile, recent_events

router = APIRouter(prefix="/api/eval", tags=["eval"])


@router.post("/submit")
async def submit(req: EvalSubmit):
    ensure_user(req.user_id)
    # 从题组资源还原每题的 kp / error_tags / 参考答案
    qmap: dict[str, dict] = {}
    with session() as s:
        r = s.get(Resource, req.quiz_resource_id)
        if r:
            payload = r.payload if isinstance(r.payload, dict) else json.loads(r.payload or "{}")
            qmap = {q["id"]: q for q in payload.get("questions", []) if q.get("id")}

    enriched = []
    for a in req.answers:
        q = qmap.get(a.question_id, {})
        correct = bool(a.correct)
        enriched.append({"question_id": a.question_id,
                         "kp": q.get("kp", req.kp or ""),
                         "correct": correct,
                         "error_tags": q.get("error_tags", []) if not correct else []})
    n = len(enriched) or 1
    score = sum(e["correct"] for e in enriched) / n
    with session() as s:
        s.add(QuizAttempt(user_id=req.user_id, quiz_resource_id=req.quiz_resource_id,
                          kp=req.kp or (enriched[0]["kp"] if enriched else ""),
                          score=round(score, 3),
                          detail={"answers": [a.model_dump() for a in req.answers],
                                  "behavior": req.behavior}))
        s.commit()

    report = evaluate_answers(req.user_id, enriched)
    report["behavior"] = req.behavior
    return report


@router.get("/report")
async def report(user_id: str = Query("demo_user")):
    ensure_user(user_id)
    profile = get_profile(user_id)
    mastery = profile.get("knowledge_mastery") or {}
    radar = [{"kp": k, "name": kp_name(k), "mastery": round(float(v), 3)}
             for k, v in mastery.items()]
    radar.sort(key=lambda d: d["mastery"])
    with session() as s:
        attempts = (s.query(QuizAttempt).filter(QuizAttempt.user_id == user_id)
                    .order_by(QuizAttempt.id.desc()).limit(100).all())
    n_attempt = len(attempts)
    avg_score = round(sum(a.score for a in attempts) / n_attempt, 3) if n_attempt else None
    if not radar:
        raise HTTPException(404, "profile not found")
    return {"profile": profile, "radar": radar,
            "weakest": radar[:3], "strongest": radar[-3:][::-1],
            "attempts": {"total": n_attempt, "accuracy": avg_score},
            "events": recent_events(user_id, 20)}
