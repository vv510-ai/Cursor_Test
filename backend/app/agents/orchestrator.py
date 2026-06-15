"""编排智能体(Orchestrator/Supervisor):星火 X2 意图识别 + 任务规划,
决定调用哪些下游智能体、串行还是并行;路由结果写入 state.intent 供条件边分发。"""
from __future__ import annotations

import logging

from ..llm.spark_client import llm_complete, parse_json
from .emitter import agent_end, agent_start

log = logging.getLogger("sparklearn.orchestrator")

_PROMPT = (
    "TASK=intent\n"
    "你是学习系统的编排器。判断用户最新消息的意图,intent 取值:\n"
    "- generate:想要生成学习资源/学习计划/出题/做思维导图/讲解视频\n"
    "- tutor:具体提问/答疑/讲解某个概念或题目\n"
    "- eval:想测试自己/检验学习效果/查看学习报告\n"
    "- chat:寒暄或与学习无关\n"
    "输出 JSON:{{\"intent\": \"...\", \"reason\": \"...\"}}\n\n"
    "用户消息:{msg}\n学习目标(可能为空):{goal}\n"
)
_VALID = {"generate", "tutor", "eval", "chat"}


async def run(state: dict) -> dict:
    await agent_start("orchestrator", "编排智能体", "意图识别与任务分发(星火 X2)")
    msg = (state.get("messages") or [{}])[-1].get("content", "") or state.get("learning_goal", "")
    intent = state.get("intent") or ""
    reason = "调用方显式指定"
    if intent not in _VALID:
        try:
            raw = await llm_complete(_PROMPT.format(msg=msg, goal=state.get("learning_goal", "")),
                                     role="reasoner", temperature=0, json_mode=True)
            data = parse_json(raw)
            intent = str(data.get("intent", "chat"))
            reason = str(data.get("reason", ""))
        except Exception as e:  # noqa: BLE001
            log.warning("意图识别失败,回退 chat:%s", e)
            intent, reason = "chat", f"识别异常回退:{e}"
        if intent not in _VALID:
            intent = "chat"
    plan_hint = {"generate": "并行 fan-out:Doc/Mindmap/Quiz/Media → Eval 质检汇总",
                 "tutor": "Tutor Agent 多模态答疑", "eval": "Eval Agent 学习效果评估",
                 "chat": "轻量对话"}[intent]
    await agent_end("orchestrator", f"意图={intent}({reason})→ {plan_hint}",
                    {"intent": intent})
    return {"intent": intent}


def route_task(state: dict) -> str:
    """LangGraph 条件边函数:按 intent 分发。chat 并入 tutor 轻量直答。"""
    intent = state.get("intent", "chat")
    return {"generate": "generate", "tutor": "tutor", "eval": "eval", "chat": "tutor"}[intent]
