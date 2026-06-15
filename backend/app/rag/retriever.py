"""RAG 检索 + 重排序 + 引用组装(对应方案 retriever.py)。

召回 top_k=20 → bge-reranker-v2-m3 精排(不可用时退化为向量分)→ final_k=5,
        h["citation"] = f"《数据结构与算法》{h.get('chapter', '')} p.{h.get('page', '?')}"
"""
from __future__ import annotations

import logging
from functools import lru_cache

from .embedding import embed_texts
from .vector_store import get_store

log = logging.getLogger("sparklearn.retriever")


@lru_cache
def _reranker():
    try:
        from FlagEmbedding import FlagReranker
        r = FlagReranker("BAAI/bge-reranker-v2-m3", use_fp16=True)
        log.info("重排序:bge-reranker-v2-m3")
        return r
    except Exception as e:  # noqa: BLE001
        log.info("重排序模型不可用(%s),退化为向量相似度排序", e)
        return None


def retrieve(query: str, course: str = "ds_algo", top_k: int = 20, final_k: int = 5) -> list[dict]:
    store = get_store()
    qv = embed_texts([query])[0]
    hits = store.search(qv, top_k=top_k)
    if not hits:
        return []
    rr = _reranker()
    if rr is not None:
        pairs = [[query, h["text"]] for h in hits]
        scores = rr.compute_score(pairs, normalize=True)
        if not isinstance(scores, list):
            scores = [scores]
        ranked = sorted(zip(hits, scores), key=lambda x: x[1], reverse=True)[:final_k]
        hits = [{**h, "score": float(s)} for h, s in ranked]
    else:
        hits = hits[:final_k]
    for h in hits:
        h["citation"] = f"《数据结构与算法》{h.get('chapter', '')} p.{h.get('page', '?')}"
    return hits
