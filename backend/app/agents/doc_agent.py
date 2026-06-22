"""文档智能体(Doc Agent):基于 RAG 的图文教程生成,带 [^n] 引用溯源,
经 grounding_check(X2 答案-证据一致性)与 safety_filter 双层防幻觉校验。
泛化承担三类文本资源:doc(图文教程)/ code(代码示例)/ reading(拓展阅读)。"""
from __future__ import annotations

import uuid

from ..llm.spark_client import llm_complete
from ..rag.citation import build_context, used_indices
from ..rag.retriever import retrieve
from ..safety.grounding import grounding_check
from ..safety.guard import safety_filter
from ..services.knowledge_graph import kp_name
from .emitter import agent_end, agent_start, emit

_STYLE = {
    "doc": ("图文教程", "TASK=doc\n请为知识点「{kp}」写一篇结构化图文教程(Markdown):"
            "## 引入(生活类比)/## 核心概念/## 操作与算法(配 mermaid 图解)/"
            "## 复杂度分析/## 易错点与对策/## 小结。"
            "正文中的事实性表述用脚注 [^n] 标注来源编号(n 对应参考资料编号),"
            "结合学生画像调整深浅:{persona}。"),
    "code": ("代码示例", "TASK=doc\n请为知识点「{kp}」编写可运行的 Python 代码教学示例(Markdown):"
             "完整代码块(含详细中文注释)+ 逐段讲解 + 一个典型错误写法对比 + 复杂度说明,"
             "事实性表述用 [^n] 标注来源;贴合画像:{persona}。"),
    "reading": ("拓展阅读", "TASK=doc\n请为知识点「{kp}」写一篇拓展阅读(Markdown):"
                "工程实战应用 / 历史与典故 / 与相邻知识点的联系 / 进阶方向,"
                "事实性表述用 [^n] 标注来源;贴合画像:{persona}。"),
}


def _persona(profile: dict) -> str:
    return (f"认知风格={profile.get('cognitive_style', '视觉型')},"
            f"难度偏好={profile.get('difficulty_pref', '循序渐进')},"
            f"节奏={profile.get('pace', '常规')}")


async def _gen_one(kind: str, kp: str, profile: dict, *, source_ids: list[str], goal: str) -> dict:
    name = kp_name(kp)
    label, tpl = _STYLE.get(kind, _STYLE["doc"])
    chunks = retrieve(
        f"{name} 概念 操作 复杂度 易错点 {goal}",
        final_k=5,
        source_ids=source_ids,
        kp=kp,
    )
    ctx, citations = build_context(chunks)
    prompt = (tpl.format(kp=name, persona=_persona(profile))
              + f"\n\n参考资料(回答只可依据这些;引用其编号):\n{ctx}")
    md = await llm_complete(prompt, role="ultra", temperature=0.5, max_tokens=2200)

    # 防幻觉第一层:答案-证据一致性(X2 深度推理)
    ground = await grounding_check(md, [c["text"] for c in chunks])
    # 防幻觉第二层:内容安全过滤(本地词表 + 讯飞审核挂接)
    safety = safety_filter(md)
    flags = []
    if not ground.get("grounded", True):
        flags.append({"agent": "doc", "kind": kind, "type": "grounding",
                      "detail": ground.get("verdict", ""), "unsupported": ground.get("unsupported", [])})
        md += "\n\n> ⚠️ 溯源提示:以上个别表述未在教材语料中找到直接依据,已标记供复核。"
    if not safety.get("safe", True):
        flags.append({"agent": "doc", "kind": kind, "type": "safety", "detail": safety.get("hits", [])})

    used = used_indices(md, len(citations))
    cite_used = [citations[i - 1] for i in used if 0 < i <= len(citations)] or citations[:3]
    rid = uuid.uuid4().hex[:12]
    resource = {"id": rid, "kind": kind, "kp": kp,
                "title": f"{name}·{label}",
                "payload": {"markdown": md, "grounded": ground.get("grounded", True)},
                "citations": [c["citation"] for c in cite_used]}
    await emit({"type": "resource", "resource": resource})
    await emit({"type": "citations", "agent": "doc", "items": resource["citations"]})
    return {"resource": resource, "flags": flags}


async def run(state: dict) -> dict:
    kps = state.get("knowledge_points") or ["binary_tree"]
    requested = state.get("kinds") or []
    kinds = [k for k in requested if k in _STYLE]
    if requested and not kinds:
        return {}
    kinds = kinds or ["doc"]
    profile = state.get("student_profile") or {}
    source_ids = [str(x) for x in (state.get("source_ids") or []) if str(x).strip()]
    goal = state.get("learning_goal") or ""
    await agent_start("doc", "文档智能体",
                      f"RAG 检索→引用生成→双层防幻觉校验({'/'.join(kinds)})")
    resources, flags = {}, []
    for kind in kinds:
        out = await _gen_one(kind, kps[0], profile, source_ids=source_ids, goal=goal)
        resources[out["resource"]["id"]] = out["resource"]
        flags += out["flags"]
    n_cite = sum(len(r["citations"]) for r in resources.values())
    await agent_end("doc", f"产出 {len(resources)} 份文本资源,共 {n_cite} 条引用,"
                           f"{'校验通过' if not flags else f'{len(flags)} 处待复核'}")
    return {"generated_resources": resources, "safety_flags": flags,
            "citations": [c for r in resources.values() for c in r["citations"]]}
