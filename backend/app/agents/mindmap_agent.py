"""思维导图智能体(Mindmap Agent):知识点 → markmap Markdown 层级语法,
前端 markmap-view 渲染交互式脑图;同时附 Mermaid mindmap 备选语法。"""
from __future__ import annotations

import uuid

from ..llm.spark_client import llm_complete
from ..rag.retriever import retrieve
from ..services.knowledge_graph import kp_name
from .emitter import agent_end, agent_start, emit

_PROMPT = (
    "TASK=mindmap\n"
    "把知识点「{kp}」整理为思维导图,使用 Markdown 标题层级(# ## ### ####),"
    "覆盖:基本概念/性质/操作或算法/复杂度/易错点;每个叶子≤12字;"
    "结合参考资料,只输出 Markdown,不要解释。\n\n参考资料:\n{ctx}\n"
)


async def run(state: dict) -> dict:
    kp = (state.get("knowledge_points") or ["binary_tree"])[0]
    name = kp_name(kp)
    await agent_start("mindmap", "思维导图智能体", f"「{name}」→ markmap 交互脑图")
    chunks = retrieve(f"{name} 概念 性质 操作 易错点", final_k=3)
    ctx = "\n---\n".join(c["text"][:300] for c in chunks) or "(无)"
    md = await llm_complete(_PROMPT.format(kp=name, ctx=ctx), role="ultra", temperature=0.4)
    if not md.strip().startswith("#"):
        md = f"# {name}\n" + md
    rid = uuid.uuid4().hex[:12]
    resource = {"id": rid, "kind": "mindmap", "kp": kp,
                "title": f"{name}·思维导图",
                "payload": {"markmap": md},
                "citations": [c.get("citation", "") for c in chunks]}
    await emit({"type": "resource", "resource": resource})
    await agent_end("mindmap", f"脑图节点 {md.count(chr(10)) + 1} 行,已推送卡片", {"id": rid})
    return {"generated_resources": {rid: resource}}
