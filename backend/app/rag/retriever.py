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

    for h in hits:
        chapter = h.get("chapter", "")
        page = h.get("page", "?")
        h["citation"] = f"《数据结构与算法》{chapter} p.{page}"
    return hits
