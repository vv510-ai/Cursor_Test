from __future__ import annotations

import logging
from typing import Any

import requests

from ..config import get_settings

log = logging.getLogger("sparklearn.reranker")


def _api_rerank(query: str, docs: list[dict], top_k: int) -> tuple[list[dict], str] | None:
    s = get_settings()
    if not s.rerank_api_url:
        return None
    headers = {"Content-Type": "application/json"}
    if s.rerank_api_key:
        headers["Authorization"] = f"Bearer {s.rerank_api_key}"
    payload = {
        "query": query,
        "documents": [d.get("text", "") for d in docs],
        "top_k": top_k,
    }
    try:
        res = requests.post(s.rerank_api_url, headers=headers, json=payload, timeout=20)
        res.raise_for_status()
        data = res.json()
        ranked = _parse_api_response(data, docs)
        if ranked:
            return ranked[:top_k], "api"
    except Exception as exc:  # noqa: BLE001
        log.warning("Rerank API failed, keeping vector order: %s", exc)
    return None


def _parse_api_response(data: Any, docs: list[dict]) -> list[dict]:
    if isinstance(data, dict) and isinstance(data.get("results"), list):
        rows = data["results"]
        ranked = []
        for row in rows:
            idx = int(row.get("index", row.get("document_index", -1)))
            if 0 <= idx < len(docs):
                ranked.append({**docs[idx], "score": float(row.get("score", docs[idx].get("score", 0.0)))})
        return ranked
    if isinstance(data, dict) and isinstance(data.get("scores"), list):
        scores = data["scores"]
        ranked = sorted(
            ({**doc, "score": float(scores[i])} for i, doc in enumerate(docs[:len(scores)])),
            key=lambda item: item.get("score", 0.0),
            reverse=True,
        )
        return ranked
    if isinstance(data, list):
        ranked = []
        for row in data:
            if not isinstance(row, dict):
                continue
            idx = int(row.get("index", row.get("document_index", -1)))
            if 0 <= idx < len(docs):
                ranked.append({**docs[idx], "score": float(row.get("score", docs[idx].get("score", 0.0)))})
        return ranked
    return []


def rerank(query: str, docs: list[dict], top_k: int | None = None) -> tuple[list[dict], str]:
    if not docs:
        return [], "none"
    s = get_settings()
    limit = int(top_k or s.rerank_top_k or 5)
    api_result = _api_rerank(query, docs, limit)
    if api_result is not None:
        ranked, mode = api_result
    else:
        ranked, mode = docs[:limit], "vector"
    return [{**doc, "rerank_mode": mode} for doc in ranked], mode

