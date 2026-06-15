"""画像构建智能体(Profile Agent)。

职责:通过多轮自然语言对话 + 学习行为日志,调用星火 Lite/Ultra 抽取并动态更新
≥6 维学生画像,写入数据库,支持"随学随新"(每次交互后增量更新)。
"""
from __future__ import annotations

import logging

from ..llm.spark_client import llm_complete, parse_json
from ..services.profile_service import get_profile, merge_profile, recent_events
from .emitter import agent_end, agent_start, emit

log = logging.getLogger("sparklearn.profile")

_PROMPT = (
    "TASK=profile\n"
    "你是学生画像分析师。基于【对话】与【近期学习行为】,抽取可更新的画像字段;"
    "无法判断的字段不要输出。字段定义:\n"
    "cognitive_style: 视觉型|语言型|动手型\n"
    "goal: 应试|竞赛|工程实践|兴趣\n"
    "pace: {{\"daily_minutes\": int, \"frequency\": str, \"focus\": \"高|中|低\"}}\n"
    "difficulty_pref: 循序渐进|挑战式\n"
    "error_prone: [易错知识点或错误类型]\n"
    "resource_pref: {{\"doc\":0-1,\"video\":0-1,\"quiz\":0-1,\"mindmap\":0-1,\"code\":0-1}}\n"
    "metacognition: 0-1 浮点(自评准确度/求助合理性)\n"
    "evidence: 一句话说明依据\n"
    "只输出 JSON 对象。\n\n【对话】\n{dialog}\n\n【近期学习行为】\n{events}\n"
)


async def run(state: dict) -> dict:
    user_id = state.get("user_id", "demo_user")
    await agent_start("profile", "画像构建智能体", "对话+行为日志 → 增量更新 ≥6 维画像(星火 Lite)")

    dialog = "\n".join(f"{m.get('role')}: {m.get('content','')}"
                       for m in (state.get("messages") or [])[-6:]) or "(无新对话)"
    events = recent_events(user_id, limit=12)
    ev_text = "\n".join(f"- {e['etype']}: {e['payload']}" for e in events) or "(暂无行为日志)"

    patch: dict = {}
    try:
        raw = await llm_complete(_PROMPT.format(dialog=dialog, events=ev_text),
                                 role="lite", temperature=0.2, json_mode=True)
        patch = parse_json(raw)
        if not isinstance(patch, dict):
            patch = {}
    except Exception as e:  # noqa: BLE001
        log.warning("画像抽取失败,保持现状:%s", e)

    profile = merge_profile(user_id, patch) if patch else get_profile(user_id)
    await emit({"type": "profile", "profile": profile})
    dims = [k for k in ("knowledge_mastery", "cognitive_style", "error_prone", "goal",
                        "pace", "difficulty_pref", "resource_pref", "metacognition")
            if k in profile]
    changed = [k for k in patch.keys() if not k.startswith("_")]
    await agent_end("profile",
                    f"画像 v{profile.get('_version')}:{len(dims)} 维在线"
                    + (f",本轮更新 {', '.join(changed[:4])}" if changed else ",本轮无新证据"),
                    {"version": profile.get("_version")})
    return {"student_profile": profile}
