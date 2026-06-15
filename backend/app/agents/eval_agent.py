"""评估智能体(Eval Agent):并行 fan-in 汇聚点。
1) 汇总各生成节点的 safety_flags 做整体质检结论;
2) 资源批量落库(Resource 表),记录 EventLog;
3) 产出本轮生成总结(emit summary),为前端 done 事件提供收尾文案。
(答题评估→BKT→路径重排的"学习闭环"在 /api/eval/submit 中复用本模块的 evaluate_answers。)"""
from __future__ import annotations



from ..models.db import session
from ..models.entities import Resource
from ..services.bkt import mastery_level
from ..services.knowledge_graph import kp_name
from ..services.path_service import plan_path, save_path
from ..services.profile_service import get_profile, log_event, update_mastery
from .emitter import agent_end, agent_start, emit


async def run(state: dict) -> dict:
    resources: dict = state.get("generated_resources") or {}
    flags: list = state.get("safety_flags") or []
    user_id = state.get("user_id", "demo_user")
    await agent_start("eval", "评估智能体", f"质检 {len(resources)} 份资源并落库")

    with session() as s:
        for rid, r in resources.items():
            s.merge(Resource(id=rid, user_id=user_id, kind=r.get("kind", "doc"),
                             kp=r.get("kp", ""), title=r.get("title", ""),
                             payload=r.get("payload", {}) or {},
                             citations=r.get("citations", []) or [],
                             safety={"flags": [f for f in flags
                                               if f.get("agent") == r.get("kind")
                                               or f.get("kind") == r.get("kind")]}))
        s.commit()
    log_event(user_id, "generate_done",
              {"n": len(resources), "kinds": sorted({r.get("kind") for r in resources.values()})})

    kinds = "、".join(sorted({r.get("kind", "?") for r in resources.values()})) or "—"
    verdict = "全部通过双层校验" if not flags else f"{len(flags)} 处标记待复核(已在卡片内提示)"
    summary = (f"本轮共生成 {len(resources)} 份个性化资源(类型:{kinds}),{verdict};"
               f"资源已入库并同步到学习路径。")
    await emit({"type": "summary", "agent": "eval", "text": summary,
                "n_resources": len(resources), "n_flags": len(flags)})
    await agent_end("eval", summary)
    return {"progress_events": [{"agent": "eval", "summary": summary}]}


def evaluate_answers(user_id: str, answers: list[dict]) -> dict:
    """答题闭环:BKT 逐题更新掌握度 → 错因标签回写画像 → 路径重排 → 评估报告。
    answers: [{question_id, kp, correct, error_tags?, type?, difficulty?}]"""
    per_kp: dict[str, dict] = {}
    error_counter: dict[str, int] = {}
    for a in answers:
        kp, correct = a.get("kp", ""), bool(a.get("correct"))
        if not kp:
            continue
        new_m = update_mastery(user_id, kp, correct)
        d = per_kp.setdefault(kp, {"kp": kp, "name": kp_name(kp), "n": 0, "right": 0})
        d["n"] += 1
        d["right"] += int(correct)
        d["mastery"] = round(new_m, 3)
        d["level"] = mastery_level(new_m)
        if not correct:
            for t in a.get("error_tags") or ["未归因"]:
                error_counter[t] = error_counter.get(t, 0) + 1

    profile = get_profile(user_id)
    if error_counter:                                    # 错因画像回写(取频次最高的前 3)
        top = sorted(error_counter.items(), key=lambda x: -x[1])[:3]
        merged = list(dict.fromkeys((profile.get("error_prone") or []) + [t for t, _ in top]))[:6]
        from ..services.profile_service import merge_profile
        profile = merge_profile(user_id, {"error_prone": merged})

    path = plan_path(profile)                            # 据新掌握度重排路径
    save_path(user_id, path)
    log_event(user_id, "quiz_eval", {"per_kp": per_kp, "errors": error_counter})

    total = sum(d["n"] for d in per_kp.values()) or 1
    right = sum(d["right"] for d in per_kp.values())
    weakest = min(per_kp.values(), key=lambda d: d.get("mastery", 1.0)) if per_kp else None
    suggestions = []
    if weakest and weakest.get("mastery", 1) < 0.6:
        suggestions.append(f"「{weakest['name']}」掌握度 {weakest['mastery']:.0%},"
                           f"建议回看图文教程并重练易错题。")
    for t, _ in sorted(error_counter.items(), key=lambda x: -x[1])[:2]:
        suggestions.append(f"错因「{t}」出现较多,已加入你的易错画像,后续出题将针对强化。")
    if not suggestions:
        suggestions.append("正确率良好,可沿路径解锁下一知识点,尝试挑战难度 +1。")
    return {"accuracy": round(right / total, 3), "per_kp": list(per_kp.values()),
            "error_tags": error_counter, "suggestions": suggestions,
            "path": path, "profile_version": profile.get("version")}
