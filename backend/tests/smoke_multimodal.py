r"""真实多模态网关冒烟；不进入默认 pytest，不打印任何密钥。

示例:
  python tests/smoke_multimodal.py --image C:\path\to\lecture.png
  python tests/smoke_multimodal.py --image C:\path\to\lecture.png --video
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import is_demo  # noqa: E402
from app.llm import multimodal_gateway as gateway  # noqa: E402


def _summary(result: dict) -> dict:
    data = dict(result.get("data") or {})
    if "text" in data:
        data["text_preview"] = str(data.pop("text"))[:160]
    return {
        "ok": result.get("ok"),
        "degraded": result.get("degraded"),
        "capability": result.get("capability"),
        "elapsed_ms": result.get("elapsed_ms"),
        "error": result.get("error"),
        "data": data,
    }


async def main() -> None:
    parser = argparse.ArgumentParser(description="SparkLearn multimodal live smoke")
    parser.add_argument("--image", type=Path, help="OCR 测试图片路径")
    parser.add_argument("--video", action="store_true", help="创建并短时轮询真实 Seedance 任务")
    parser.add_argument("--video-budget", type=float, default=15, help="请求内视频等待预算(秒)")
    args = parser.parse_args()

    print(json.dumps({
        "demo_mode": is_demo(),
        "capabilities": gateway.capability_status(),
    }, ensure_ascii=False))

    if args.image:
        if not args.image.exists():
            raise SystemExit(f"image not found: {args.image}")
        ocr = await gateway.ocr_image(
            args.image.read_bytes(),
            hint="请完整转写讲义文字,保留公式和代码。",
            purpose="ingest",
            trace_id="smoke-ocr",
        )
        print("OCR", json.dumps(_summary(ocr), ensure_ascii=False))

    tts = await gateway.tts(
        "星火学伴多模态网关冒烟验证。",
        trace_id="smoke-tts",
    )
    print("TTS", json.dumps(_summary(tts), ensure_ascii=False))

    image = await gateway.text_to_image(
        "数据结构课程二叉树遍历教学插画,简洁白底示意图",
        trace_id="smoke-image",
    )
    print("IMAGE", json.dumps(_summary(image), ensure_ascii=False))

    if args.video:
        created = await gateway.video_create(
            "clean educational animation explaining binary tree traversal",
            trace_id="smoke-video-create",
        )
        print("VIDEO_CREATE", json.dumps(_summary(created), ensure_ascii=False))
        if created.get("ok"):
            waited = await gateway.video_wait(
                str(created["data"]["task_id"]),
                budget_s=args.video_budget,
                trace_id="smoke-video-wait",
            )
            print("VIDEO_WAIT", json.dumps(_summary(waited), ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
