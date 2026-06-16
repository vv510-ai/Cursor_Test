from __future__ import annotations

import logging

from .embedding import embed_texts
from .reranker import rerank
from .vector_store import get_store

log = logging.getLogger("sparklearn.retriever")


def retrieve(query: str, course: str = "ds_algo", top_k: int = 20, final_k: int = 5) -> list[dict]:
    store = get_store()
    qv = embed_texts([query])[0]
    hits = store.search(qv, top_k=top_k)
    if not hits:
        return []

    hits, mode = rerank(query, hits, top_k=final_k)
    log.debug("RAG rerank mode=%s course=%s query=%s", mode, course, query[:80])

    for hit in hits:
        hit["citation"] = _format_citation(hit)
    return hits


def _format_citation(hit: dict) -> str:
    source = hit.get("source") or "未知来源"
    chapter = hit.get("chapter") or ""
    page = hit.get("page", "?")
    url = hit.get("url") or ""
    source_type = hit.get("source_type") or "lecture"

    if url:
        return f"{source} ({source_type}) {url}"
    if chapter:
        return f"{source} · {chapter} p.{page}"
    return f"{source} p.{page}"
