"""本地 OCR 提供器:使用 RapidOCR + ONNX Runtime 离线识别图片。"""
from __future__ import annotations

import importlib.util
import threading
from typing import Any

_engine: Any | None = None
_engine_lock = threading.Lock()
_run_lock = threading.Lock()


def available() -> bool:
    """依赖完整时才声明可用，避免导入失败影响主链路。"""
    return bool(
        importlib.util.find_spec("rapidocr")
        and importlib.util.find_spec("onnxruntime")
    )


def _get_engine() -> Any:
    global _engine
    if _engine is not None:
        return _engine
    with _engine_lock:
        if _engine is None:
            from rapidocr import RapidOCR

            _engine = RapidOCR()
    return _engine


def recognize(image_bytes: bytes, *, min_score: float = 0.45) -> dict[str, Any]:
    """识别图片并按阅读顺序返回文本、行数和平均置信度。"""
    if not image_bytes:
        raise ValueError("local OCR received an empty image")

    with _run_lock:
        output = _get_engine()(image_bytes)

    texts = tuple(getattr(output, "txts", ()) or ())
    scores = tuple(getattr(output, "scores", ()) or ())
    lines: list[str] = []
    kept_scores: list[float] = []
    for index, raw in enumerate(texts):
        text = str(raw or "").strip()
        score = float(scores[index]) if index < len(scores) else 1.0
        if text and score >= min_score:
            lines.append(text)
            kept_scores.append(score)

    if not lines:
        raise RuntimeError("local OCR found no readable text")
    return {
        "text": "\n".join(lines),
        "lines": len(lines),
        "confidence": round(sum(kept_scores) / len(kept_scores), 4),
        "engine": "rapidocr-onnx",
    }
