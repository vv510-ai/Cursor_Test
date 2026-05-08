# -*- coding: utf-8 -*-
"""
DeepSeek Chat Completions 流式接口探测：记录 chunk / delta 字段，供前后端对接参考。

测试阶段将 API Key 写在本文件中（请勿提交到公共仓库；测试后请轮换密钥）。

说明：
- OpenAI 官方 SDK 的 ChoiceDelta 类型未必声明 reasoning_content，但 DeepSeek 会在 SSE 的 JSON
  chunk 中附带 vendor 扩展字段；本脚本用 model_dump(mode="python") 观察实际键名。
- 若账户欠费，会收到 HTTP 402，本脚本仍会把 error 的 JSON 写入 logs/ 供联调错误态。
"""

from __future__ import annotations

import json
import sys
import traceback
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from openai import APIStatusError, OpenAI
from openai.types.chat.chat_completion_chunk import ChatCompletionChunk

# --- 测试用密钥（用完请轮换） ---
DEEPSEEK_API_KEY = "sk-bc3c5dcdfcc44a8d8b44250be8b66b06"
BASE_URL = "https://api.deepseek.com/v1"
MODEL_CHAT = "deepseek-chat"

LOG_DIR = Path(__file__).resolve().parent / "logs"


def _serialize_chunk(chunk: Any) -> dict[str, Any]:
    if hasattr(chunk, "model_dump"):
        return chunk.model_dump(mode="python")
    if hasattr(chunk, "dict"):
        return chunk.dict()  # type: ignore[no-untyped-call]
    return {"repr": repr(chunk)}


def _merge_field_paths(obj: Any, prefix: str = "") -> set[str]:
    paths: set[str] = set()
    if isinstance(obj, dict):
        for k, v in obj.items():
            p = f"{prefix}.{k}" if prefix else str(k)
            paths.add(p)
            paths |= _merge_field_paths(v, p)
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            p = f"{prefix}[{i}]"
            paths.add(p)
            paths |= _merge_field_paths(item, p)
    return paths


def dump_openai_chunk_schema(path: Path) -> None:
    """导出 SDK 中 ChatCompletionChunk 的 JSON Schema（不含 DeepSeek 专有字段）。"""
    schema = ChatCompletionChunk.model_json_schema()
    path.write_text(json.dumps(schema, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote OpenAI SDK ChatCompletionChunk schema: {path}")


def write_api_error(case: str, err: APIStatusError, path: Path) -> None:
    body: dict[str, Any] = {
        "case": case,
        "http_status": getattr(err.response, "status_code", None),
        "error_type": type(err).__name__,
        "message": str(err),
    }
    try:
        if err.response is not None:
            body["response_json"] = err.response.json()
            body["response_text"] = getattr(err.response, "text", "")[:4000]
    except Exception:
        body["response_parse_error"] = traceback.format_exc()
    path.write_text(json.dumps(body, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"API error logged: {path}")


def run_stream_case(
    *,
    name: str,
    messages: list[dict[str, Any]],
    model: str,
    reasoning_effort: str | None,
    extra_body: dict[str, Any] | None,
) -> dict[str, Any]:
    client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url=BASE_URL)

    kwargs: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": True,
    }
    if reasoning_effort is not None:
        kwargs["reasoning_effort"] = reasoning_effort
    if extra_body is not None:
        kwargs["extra_body"] = extra_body

    print(f"\n=== Case: {name} ===")
    print(
        "Request kwargs:",
        json.dumps({k: v for k, v in kwargs.items()}, ensure_ascii=False, indent=2),
    )

    field_paths: set[str] = set()
    delta_keys: set[str] = set()
    raw_chunks: list[dict[str, Any]] = []
    reasoning_acc = ""
    content_acc = ""

    try:
        stream = client.chat.completions.create(**kwargs)
    except APIStatusError as e:
        write_api_error(name, e, LOG_DIR / f"error_{name}.json")
        raise

    for chunk in stream:
        d = _serialize_chunk(chunk)
        raw_chunks.append(d)
        field_paths |= _merge_field_paths(d)
        ch0 = (d.get("choices") or [{}])[0]
        delta = ch0.get("delta") or {}
        if isinstance(delta, dict):
            delta_keys |= set(delta.keys())
        rc = delta.get("reasoning_content")
        ct = delta.get("content")
        if isinstance(rc, str) and rc:
            reasoning_acc += rc
        if isinstance(ct, str) and ct:
            content_acc += ct

    n = len(raw_chunks)
    sample_idx = sorted({0, n // 3, n // 2, n - 1} & {i for i in [0, n // 3, n // 2, n - 1] if 0 <= i < n})
    sample = [raw_chunks[i] for i in sample_idx]

    summary: dict[str, Any] = {
        "case": name,
        "model": model,
        "base_url": BASE_URL,
        "chunk_count": n,
        "field_paths_sorted": sorted(field_paths),
        "delta_keys_observed": sorted(delta_keys),
        "reasoning_chars": len(reasoning_acc),
        "content_chars": len(content_acc),
        "reasoning_preview": reasoning_acc[:800],
        "content_preview": content_acc[:800],
        "sample_chunks": sample,
    }
    (LOG_DIR / f"probe_{name}.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Saved: {LOG_DIR / f'probe_{name}.json'}")
    print("Delta keys (union):", ", ".join(summary["delta_keys_observed"]) or "(none)")
    print(
        f"Chunks: {n}, reasoning_chars: {summary['reasoning_chars']}, content_chars: {summary['content_chars']}"
    )
    return summary


def run_multiturn_case() -> None:
    client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url=BASE_URL)
    messages: list[dict[str, Any]] = [
        {"role": "user", "content": "9.11 and 9.8, which is greater? One word answer."}
    ]
    kwargs1: dict[str, Any] = {
        "model": MODEL_CHAT,
        "messages": messages,
        "stream": True,
        "reasoning_effort": "high",
        "extra_body": {"thinking": {"type": "enabled"}},
    }
    print("\n=== Case: multiturn_turn1 ===")
    reasoning_content = ""
    content = ""
    t1_chunks: list[dict[str, Any]] = []
    try:
        for chunk in client.chat.completions.create(**kwargs1):
            d = _serialize_chunk(chunk)
            t1_chunks.append(d)
            ch0 = (d.get("choices") or [{}])[0]
            delta = ch0.get("delta") or {}
            rc = delta.get("reasoning_content")
            ct = delta.get("content")
            if isinstance(rc, str) and rc:
                reasoning_content += rc
            elif isinstance(ct, str) and ct:
                content += ct
    except APIStatusError as e:
        write_api_error("multiturn_turn1", e, LOG_DIR / "error_multiturn_turn1.json")
        raise

    messages.append(
        {
            "role": "assistant",
            "content": content,
            **({"reasoning_content": reasoning_content} if reasoning_content else {}),
        }
    )
    messages.append(
        {
            "role": "user",
            "content": "How many letter r in 'strawberry'? Digits only.",
        }
    )
    kwargs2: dict[str, Any] = {
        "model": MODEL_CHAT,
        "messages": messages,
        "stream": True,
        "reasoning_effort": "high",
        "extra_body": {"thinking": {"type": "enabled"}},
    }
    print("\n=== Case: multiturn_turn2 ===")
    print("assistant message keys:", list(messages[1].keys()))
    t2_chunks: list[dict[str, Any]] = []
    try:
        for chunk in client.chat.completions.create(**kwargs2):
            t2_chunks.append(_serialize_chunk(chunk))
    except APIStatusError as e:
        write_api_error("multiturn_turn2", e, LOG_DIR / "error_multiturn_turn2.json")
        raise

    n1, n2 = len(t1_chunks), len(t2_chunks)
    rep = {
        "turn1_chunk_count": n1,
        "turn2_chunk_count": n2,
        "turn1_reasoning_chars": len(reasoning_content),
        "turn1_content_chars": len(content),
        "assistant_message_for_turn2": messages[1],
        "turn1_sample": [t1_chunks[i] for i in {0, n1 // 2, n1 - 1} if t1_chunks and 0 <= i < n1],
        "turn2_sample": [t2_chunks[i] for i in {0, n2 // 2, n2 - 1} if t2_chunks and 0 <= i < n2],
    }
    (LOG_DIR / "probe_multiturn_chat_thinking.json").write_text(
        json.dumps(rep, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Saved: {LOG_DIR / 'probe_multiturn_chat_thinking.json'}")


def main() -> int:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    dump_openai_chunk_schema(LOG_DIR / "openai_ChatCompletionChunk_schema.json")

    index: dict[str, Any] = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "base_url": BASE_URL,
        "model": MODEL_CHAT,
        "note": "DeepSeek 可能在 choices[0].delta 中增加官方 schema 未列出的键（如 reasoning_content）。以 probe 样例中的 delta_keys_observed 为准。",
    }

    # Case A: deepseek-chat + thinking enabled
    try:
        index["case_chat_thinking_high"] = run_stream_case(
            name="chat_thinking_high",
            messages=[
                {
                    "role": "user",
                    "content": "In one sentence, what fields may appear in streaming delta for a chat API?",
                }
            ],
            model=MODEL_CHAT,
            reasoning_effort="high",
            extra_body={"thinking": {"type": "enabled"}},
        )
    except APIStatusError as e:
        index["case_chat_thinking_high"] = {"error": str(e), "status": getattr(e.response, "status_code", None)}

    # Case B: thinking disabled (control)
    try:
        index["case_chat_thinking_disabled"] = run_stream_case(
            name="chat_thinking_disabled",
            messages=[{"role": "user", "content": "Reply with only: 1+1=?"}],
            model=MODEL_CHAT,
            reasoning_effort="high",
            extra_body={"thinking": {"type": "disabled"}},
        )
    except APIStatusError as e:
        index["case_chat_thinking_disabled"] = {
            "error": str(e),
            "status": getattr(e.response, "status_code", None),
        }

    try:
        run_multiturn_case()
        index["multiturn"] = "ok"
    except APIStatusError:
        index["multiturn"] = "failed_see_error_json"

    (LOG_DIR / "probe_index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\nIndex: {LOG_DIR / 'probe_index.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
