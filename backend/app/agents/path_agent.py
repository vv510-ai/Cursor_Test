"""路径规划智能体(Path Agent):知识图谱依赖 + BKT 掌握度 → 动态个性化学习路径(DAG),
随评估结果重排(闭环);算法详见 services/path_service.plan_path。"""
from __future__ import annotations

from ..services.path_service import plan_path, save_path
from ..services.knowledge_graph import kp_name
from .emitter import agent_end, agent_start, emit


async def run(state: dict) -> dict:
    await agent_start("path", "路径规划智能体", "BKT 掌握度 × 图谱依赖 × 难度偏好 → 路径 DAG")
    profile = state.get("student_profile", {})
    goal_kps = state.get("knowledge_points") or []
    path = plan_path(profile, goal_kps=goal_kps, generated_by="path_agent")
    save_path(state.get("user_id", "demo_user"), path)
    await emit({"type": "path", "path": path})
    nxt = path.get("next_kp")
    ready = [n for n in path["nodes"] if n["status"] == "ready"]
    nxt_name = kp_name(nxt) if nxt else "-"
    await agent_end("path",
                    f"{len(path['nodes'])} 个知识点入图,{len(ready)} 个就绪,"
                    f"下一步推荐「{nxt_name}」",
                    {"next_kp": nxt})
    return {"path_plan": path}
