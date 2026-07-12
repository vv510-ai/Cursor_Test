"""答疑导师智能体(Tutor Agent):多模态随问随答。
图片(拍照搜题)→ 讯飞 OCR 还原题面 → RAG 检索教材 → 流式逐 token 输出讲解
(启发式苏格拉底风格,先思路后答案)→ grounding 溯源 + 引用事件。"""
from __future__ import annotations

import asyncio
import base64

from ..llm import multimodal_gateway
from ..llm.spark_client import llm_stream
from ..rag.citation import build_context
from ..rag.retriever import retrieve
from ..safety.grounding import grounding_check
from ..safety.guard import safety_filter
from .emitter import agent_end, agent_start, agent_token, emit

_SYSTEM = (
    "你是《数据结构与算法》课程的 AI 导师「星火学伴」。回答要求:"
    "1) 先点拨思路再给完整解答,启发式而非直接灌答案;"
    "2) 依据给定参考资料作答,事实性表述标注 [^n];"
    "3) 适当使用类比,关键步骤给出代码或伪代码;"
    "4) 语气友好简洁,Markdown 排版。"
)

async def run(state: dict) -> dict:
    question = ""
    for m in reversed(state.get("messages") or []):
        if m.get("role") == "user":
            question = m.get("content", "")
            break
    extras = state.get("tutor_extras") or {}

    detail = "文本问答"
    if extras.get("image_base64"):                      # 拍照搜题
        try:
            img = base64.b64decode(extras["image_base64"].split(",")[-1])
            ocr = await multimodal_gateway.ocr_image(
                img,
                hint=question,
                purpose="tutor",
                trace_id=str(state.get("session_id", "")),
            )
            ocr_text = str(ocr["data"].get("text", ""))
            if ocr["ok"] and ocr_text:
                question = (question + "\n\n[图片题面] " + ocr_text).strip()
                detail = "OCR 识题 + 文本问答"
                await emit({"type": "progress", "agent": "tutor", "stage": "ocr",
                            "detail": "图片题面识别完成", "ocr": ocr_text[:120]})
            else:
                await emit({"type": "progress", "agent": "tutor", "stage": "ocr",
                            "percent": 100, "degraded": True,
                            "detail": "图片识别失败,已按文字问题继续作答"})
        except Exception as error:  # base64 输入异常也不得拖垮答疑
            await emit({"type": "progress", "agent": "tutor", "stage": "ocr",
                        "percent": 100, "degraded": True,
                        "detail": f"图片解析失败,已按文字问题继续作答:{str(error)[:80]}"})
    question = question or "请讲讲二叉树的中序遍历"
    await agent_start("tutor", "答疑导师智能体", detail)

    chunks = retrieve(question, final_k=4)
    ctx, citations = build_context(chunks)
    profile = state.get("student_profile") or {}
    prompt = (f"学生画像:认知风格={profile.get('cognitive_style', '视觉型')},"
              f"难度偏好={profile.get('difficulty_pref', '循序渐进')}\n"
              f"参考资料:\n{ctx}\n\n学生问题:{question}")

    parts: list[str] = []
    async for delta in llm_stream(prompt, role="ultra", system=_SYSTEM,
                                  temperature=0.6, max_tokens=1600):
        parts.append(delta)
        await agent_token("tutor", delta)
        await emit({"type": "token", "delta": delta})
    answer = "".join(parts)

    try:
        ground = await asyncio.wait_for(grounding_check(answer, [c["text"] for c in chunks]), timeout=8)
    except TimeoutError:
        ground = {"grounded": False, "unsupported": [], "verdict": "grounding 校验超时,已标记待复核"}
    safety = safety_filter(answer)
    flags = []
    if not ground.get("grounded", True):
        flags.append({"agent": "tutor", "type": "grounding", "detail": ground.get("verdict", "")})
        await emit({"type": "safety", "level": "warn",
                    "detail": "部分表述未命中教材依据,已提示复核"})
    if not safety.get("safe", True):
        flags.append({"agent": "tutor", "type": "safety", "detail": safety.get("hits", [])})

    cites = [c["citation"] for c in citations]
    await emit({"type": "citations", "agent": "tutor", "items": cites})
    await agent_end("tutor", f"已作答(约 {len(answer)} 字),引用教材 {len(cites)} 处,"
                             f"{'溯源通过' if ground.get('grounded', True) else '溯源提示复核'}")
    return {"answer": answer, "citations": cites, "safety_flags": flags,
            "messages": [{"role": "assistant", "content": answer}]}
