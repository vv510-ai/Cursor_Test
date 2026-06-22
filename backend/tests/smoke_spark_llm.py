"""Manual smoke test for the real Spark text LLM.

Run from the repository root after creating .env with SPARK_API_PASSWORD:

    backend\\.venv\\Scripts\\python.exe backend\\tests\\smoke_spark_llm.py

This script is intentionally not named test_*.py so the default offline pytest
suite does not make real network calls.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"
os.chdir(REPO_ROOT)
sys.path.insert(0, str(BACKEND_DIR))

from app.config import get_settings, is_demo  # noqa: E402
from app.llm.spark_client import llm_complete, llm_stream  # noqa: E402


def _mask(value: str) -> str:
    if not value:
        return "<empty>"
    if len(value) <= 8:
        return "<set>"
    return f"{value[:4]}...{value[-4:]}"


async def _collect_stream() -> str:
    chunks: list[str] = []
    stream = llm_stream(
        "请用一句话解释队列的 FIFO 特性。",
        role="lite",
        temperature=0.2,
        max_tokens=120,
    )
    while len(chunks) < 60:
        try:
            chunk = await asyncio.wait_for(anext(stream), timeout=60)
        except StopAsyncIteration:
            break
        chunks.append(chunk)
    return "".join(chunks).strip()


async def main() -> int:
    settings = get_settings()
    print("SparkLearn Spark LLM smoke")
    print(f"DEMO_MODE={settings.demo_mode}")
    print(f"is_demo={is_demo()}")
    print(f"SPARK_API_PASSWORD={_mask(settings.spark_api_password)}")
    print(f"SPARK_BASE_URL={settings.spark_base_url}")
    print(f"SPARK_X2_BASE_URL={settings.spark_x2_base_url}")

    if is_demo():
        print(
            "SKIP: 当前仍是 demo 模式。请在仓库根目录 .env 填入 "
            "SPARK_API_PASSWORD,并保持 DEMO_MODE=auto 或设为 false 后重试。"
        )
        return 2

    if not settings.spark_api_password:
        print("FAIL: is_demo=False 但 SPARK_API_PASSWORD 为空,真实调用必然失败。")
        return 2

    complete_text = await asyncio.wait_for(
        llm_complete(
            "请用一句话回答: 二叉树中序遍历的访问顺序是什么?",
            role="ultra",
            temperature=0.2,
            max_tokens=120,
        ),
        timeout=90,
    )
    complete_text = complete_text.strip()
    if not complete_text or "演示模式" in complete_text or "MockEngine" in complete_text:
        print(f"FAIL: 非流式返回疑似为空或仍是 Mock: {complete_text!r}")
        return 1
    print("PASS complete ultra:", complete_text[:160])

    reasoner_text = await asyncio.wait_for(
        llm_complete(
            '请判断"1+1=2"是否正确,只输出 {"ok": true, "reason": "..."}。',
            role="reasoner",
            temperature=0,
            json_mode=True,
            max_tokens=120,
        ),
        timeout=120,
    )
    reasoner_text = reasoner_text.strip()
    if not reasoner_text or "演示模式" in reasoner_text or "MockEngine" in reasoner_text:
        print(f"FAIL: reasoner 返回疑似为空或仍是 Mock: {reasoner_text!r}")
        return 1
    print("PASS complete reasoner:", reasoner_text[:160])

    stream_text = await _collect_stream()
    if not stream_text or "演示模式" in stream_text or "MockEngine" in stream_text:
        print(f"FAIL: 流式返回疑似为空或仍是 Mock: {stream_text!r}")
        return 1
    print("PASS stream lite:", stream_text[:160])
    print("ALL SPARK LLM SMOKE CHECKS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
