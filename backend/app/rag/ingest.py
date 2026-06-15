"""知识库构建:解析 seed_corpus 下 Markdown 讲义 → 标题层级+语义混合切片 → 向量化入库。

切片策略(对应方案):chunk 300-500 字、重叠 50 字;代码块作为整体单独成块;
所有 chunk 携带 source/chapter/page/kp 元数据用于引用溯源。
PDF/PPT 语料可先用 PyMuPDF/Unstructured 转 Markdown 后放入 seed_corpus(见 docs/环境搭建指南)。
"""
from __future__ import annotations

import logging
import re
from pathlib import Path

from ..config import CORPUS_DIR
from .embedding import embed_texts
from .vector_store import get_store

log = logging.getLogger("sparklearn.ingest")
CHUNK, OVERLAP = 420, 50


def _front_matter(text: str) -> tuple[dict, str]:
    meta = {"source": "未知讲义", "chapter": "", "kp": "", "license": ""}
    m = re.match(r"^---\n(.*?)\n---\n", text, flags=re.S)
    if m:
        for line in m.group(1).splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip()
        text = text[m.end():]
    return meta, text


def _split(text: str) -> list[str]:
    """按 ## 标题切大段,代码块保护,再按长度滑窗。"""
    protected: list[str] = []

    def _hold(m: re.Match) -> str:
        protected.append(m.group(0))
        return f"\x00CODE{len(protected) - 1}\x00"

    text = re.sub(r"```.*?```", _hold, text, flags=re.S)
    sections = re.split(r"(?=^##\s)", text, flags=re.M)
    chunks: list[str] = []
    for sec in sections:
        sec = sec.strip()
        if not sec:
            continue
        if len(sec) <= CHUNK:
            chunks.append(sec)
        else:
            i = 0
            while i < len(sec):
                chunks.append(sec[i:i + CHUNK])
                i += CHUNK - OVERLAP
    out: list[str] = []
    for c in chunks:
        def _restore(m: re.Match) -> str:
            return protected[int(m.group(1))]
        out.append(re.sub(r"\x00CODE(\d+)\x00", _restore, c).strip())
    return [c for c in out if len(c) > 30]


def ingest_corpus(force: bool = False) -> int:
    """幂等构建:库非空且未 force 则跳过。返回库内 chunk 总数。"""
    store = get_store()
    if store.count() > 0 and not force:
        log.info("知识库已存在(%d chunks),跳过构建", store.count())
        return store.count()
    files = sorted(Path(CORPUS_DIR).glob("*.md"))
    all_chunks: list[dict] = []
    for f in files:
        meta, body = _front_matter(f.read_text(encoding="utf-8"))
        for page, piece in enumerate(_split(body), start=1):
            all_chunks.append({
                "text": piece,
                "source": meta.get("source") or f.stem,
                "chapter": meta.get("chapter") or f.stem,
                "kp": meta.get("kp", ""),
                "page": page,
            })
    if not all_chunks:
        log.warning("seed_corpus 为空,知识库未构建")
        return 0
    vecs = embed_texts([c["text"] for c in all_chunks])
    store.upsert(all_chunks, vecs)
    log.info("知识库构建完成:%d 文件 → %d chunks", len(files), len(all_chunks))
    return store.count()
