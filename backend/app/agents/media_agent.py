"""媒体智能体(Media Agent):
1) 星火生成分镜视频脚本(video_script JSON);
2) 首选火山方舟 Seedance 文生视频(异步任务 + progress 事件轮询);
3) 无 Seedance 密钥时优雅降级:生成 Manim 动画场景代码(可本地渲染)+ 讯飞 TTS 旁白音频;
4) 讯飞文生图生成课程封面(可选)。"""
from __future__ import annotations

import asyncio
import uuid

from ..llm import multimodal_gateway
from ..llm.spark_client import llm_complete, parse_json
from ..services.knowledge_graph import kp_name
from .emitter import agent_end, agent_start, emit

_SCRIPT_PROMPT = (
    "TASK=video_script\n"
    "请为知识点「{kp}」设计一段 60 秒讲解短视频的分镜脚本,只输出 JSON:\n"
    '{{"title":"...","narration":"完整旁白(180字内,口语化)",'
    '"scenes":[{{"t":"0-10s","visual":"画面描述","caption":"屏幕字幕"}}],'
    '"video_prompt":"给文生视频模型的一句英文 prompt(教学动画风格)"}}'
)

_MANIM_PROMPT = (
    "TASK=doc\n"
    "请用 Manim Community v0.18 写一个 Python 场景类,可视化「{kp}」的核心过程"
    "(如指针移动/节点插入/递归展开),类名 {cls},≤60 行,只输出 Python 代码块。"
)


async def run(state: dict) -> dict:
    requested = state.get("kinds") or []
    if requested and not any(k in requested for k in ("video", "audio", "image")):
        return {}
    kp = (state.get("knowledge_points") or ["binary_tree"])[0]
    name = kp_name(kp)
    await agent_start("media", "媒体智能体", f"「{name}」分镜脚本 → 文生视频/动画 + TTS")

    raw = await llm_complete(_SCRIPT_PROMPT.format(kp=name), role="ultra",
                             temperature=0.7, max_tokens=1200)
    script = parse_json(raw)
    if not isinstance(script, dict) or not script.get("narration"):
        script = {"title": f"{name} 60 秒讲透", "narration": f"本节用一分钟讲清{name}的核心思想与典型操作。",
                  "scenes": [{"t": "0-60s", "visual": f"{name} 演示动画", "caption": name}],
                  "video_prompt": f"educational 2D animation explaining {kp}, clean diagram style"}
    await emit({"type": "progress", "agent": "media", "stage": "script", "percent": 25,
                "detail": f"分镜脚本就绪,共 {len(script.get('scenes', []))} 个镜头"})

    payload: dict = {"script": script}
    trace_id = str(state.get("session_id", ""))

    async def on_progress(p: dict):
        await emit({"type": "progress", "agent": "media", "stage": "video",
                    "percent": 25 + int(p.get("percent", 0) * 0.6),
                    "detail": p.get("detail", "视频生成中…"), "task_id": p.get("task_id")})

    mode = "manim"
    created = await multimodal_gateway.video_create(
        script.get("video_prompt", name), trace_id=trace_id,
    )
    if created["ok"]:
        task_id = str(created["data"]["task_id"])
        waited = await multimodal_gateway.video_wait(
            task_id,
            on_progress=on_progress,
            trace_id=trace_id,
        )
        payload["video"] = waited["data"]
        if waited["ok"]:
            mode = "seedance"
    elif created["data"]:
        payload["video"] = created["data"]

    if mode == "manim":                                            # 降级链路
        cls = "Scene" + kp.title().replace("_", "")
        code = await llm_complete(_MANIM_PROMPT.format(kp=name, cls=cls),
                                  role="ultra", temperature=0.3, max_tokens=1400)
        payload["manim_code"] = code
        await emit({"type": "progress", "agent": "media", "stage": "manim", "percent": 70,
                    "detail": "Seedance 未配置/失败,已降级为 Manim 动画代码(可本地渲染)"})

    audio, cover = await asyncio.gather(
        multimodal_gateway.tts(script["narration"][:260], trace_id=trace_id),
        multimodal_gateway.text_to_image(
            f"数据结构教学插画:{name},蓝橙科技风,简洁示意图",
            trace_id=trace_id,
        ),
    )
    if audio["ok"]:
        payload["audio_url"] = audio["data"]["audio_url"]
    if cover["ok"]:
        payload["cover_url"] = cover["data"]["image_url"]
    await emit({"type": "progress", "agent": "media", "stage": "post", "percent": 100,
                "detail": "旁白与封面处理完成"
                if audio["ok"] or cover["ok"] else "旁白与封面不可用,已保留讲解脚本"})

    rid = uuid.uuid4().hex[:12]
    resource = {"id": rid, "kind": "video", "kp": kp,
                "title": script.get("title", f"{name}·讲解视频"),
                "payload": payload, "citations": []}
    await emit({"type": "resource", "resource": resource})
    await agent_end("media", "Seedance 视频任务已提交" if mode == "seedance"
                    else "已产出 Manim 动画代码 + 旁白脚本(降级模式)", {"id": rid, "mode": mode})
    return {"generated_resources": {rid: resource},
            "progress_events": [{"agent": "media", "mode": mode}]}
