"""防幻觉第一层:答案-证据一致性校验(grounding check)。

用星火深度推理 X2 judge 答案中每个论断是否能在检索资料中找到出处,
输出 {grounded, unsupported[], verdict};不通过则 Doc/Tutor Agent 触发重写或加"待核实"标注。
"""
from __future__ import annotations

import logging

from ..llm.spark_client import llm_complete, parse_json

log = logging.getLogger("sparklearn.grounding")

_PROMPT = (
    "TASK=grounding\n"
    "你是教育内容事实核查员。基于以下【资料】判断【回答】是否完全有据可依:\n"
    "- 列出资料中找不到出处的句子(unsupported);\n"
    "- grounded=true 当且仅当所有关键论断均有出处;\n"
    "输出 JSON:{{\"grounded\": bool, \"unsupported\": [\"...\"], \"verdict\": \"一句话结论\"}}\n\n"
    "【资料】\n{ctx}\n\n【回答】\n{answer}\n"
)


async def grounding_check(answer: str, contexts: list[str]) -> dict:
    ctx = "\n---\n".join(contexts) if contexts else "(无)"
    try:
        raw = await llm_complete(_PROMPT.format(ctx=ctx, answer=answer),
                                 role="reasoner", temperature=0, json_mode=True)
        data = parse_json(raw)
        if isinstance(data, list):
            data = data[0] if data and isinstance(data[0], dict) else {}
        if not isinstance(data, dict):
            data = {}

        grounded = data.get("grounded", False)
        if isinstance(grounded, str):
            grounded = grounded.lower() in {"1", "true", "yes", "on"}

        unsupported = data.get("unsupported", [])
        if isinstance(unsupported, str):
            unsupported = [unsupported]
        if not isinstance(unsupported, list):
            unsupported = []

        return {"grounded": bool(grounded),
                "unsupported": unsupported[:5],
                "verdict": str(data.get("verdict", ""))}
    except Exception as e:  # noqa: BLE001
        log.warning("grounding 校验失败:%s", e)
        return {"grounded": False, "unsupported": [], "verdict": f"校验服务异常:{e}"}
