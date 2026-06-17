"""Knowledge source APIs for upload, indexing, and retrieval checks."""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile

from ..config import UPLOAD_SOURCES_DIR
from ..rag.ingest import (
    chunks_for_source,
    ingest_corpus,
    load_all_chunks,
    supported_upload_suffixes,
    upload_meta_path,
)
from ..rag.retriever import retrieve
from ..services.profile_service import ensure_user

router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])

MAX_UPLOAD_BYTES = 8 * 1024 * 1024


def _safe_stem(name: str) -> str:
    stem = Path(name or "source").stem.lower()
    stem = re.sub(r"[^a-z0-9_-]+", "-", stem).strip("-")
    return stem[:40] or "source"


def _read_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _write_json(path: Path, data: dict[str, Any]) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _source_response(meta: dict[str, Any], chunk_count: int) -> dict[str, Any]:
    return {
        "id": meta.get("id", ""),
        "user_id": meta.get("user_id", ""),
        "title": meta.get("title", ""),
        "filename": meta.get("filename", ""),
        "kp": meta.get("kp", ""),
        "source_type": meta.get("source_type", ""),
        "bytes": meta.get("bytes", 0),
        "chunk_count": chunk_count,
        "status": "indexed" if chunk_count else "empty",
        "created_at": meta.get("created_at", ""),
    }


def _uploaded_metas() -> list[tuple[Path, dict[str, Any]]]:
    if not UPLOAD_SOURCES_DIR.exists():
        return []
    rows: list[tuple[Path, dict[str, Any]]] = []
    for path in sorted(UPLOAD_SOURCES_DIR.glob("*.meta.json")):
        meta = _read_json(path)
        if meta.get("id"):
            rows.append((path, meta))
    return rows


def _chunk_counts() -> dict[str, int]:
    counts: dict[str, int] = {}
    for chunk in load_all_chunks():
        source_id = str(chunk.get("source_id") or "")
        if source_id:
            counts[source_id] = counts.get(source_id, 0) + 1
    return counts


@router.post("/upload")
async def upload_source(
    file: UploadFile = File(...),
    user_id: str = Form("demo_user"),
    kp: str = Form(""),
    title: str = Form(""),
):
    ensure_user(user_id)
    filename = file.filename or "source.txt"
    suffix = Path(filename).suffix.lower()
    if suffix not in supported_upload_suffixes():
        allowed = ", ".join(sorted(supported_upload_suffixes()))
        raise HTTPException(400, f"unsupported file type, allowed: {allowed}")

    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "file too large, max 8MB")
    if not data:
        raise HTTPException(400, "empty file")

    UPLOAD_SOURCES_DIR.mkdir(parents=True, exist_ok=True)
    source_id = f"{user_id}_{uuid.uuid4().hex[:8]}_{_safe_stem(filename)}"
    stored = UPLOAD_SOURCES_DIR / f"{source_id}{suffix}"
    stored.write_bytes(data)

    meta = {
        "id": source_id,
        "user_id": user_id,
        "title": (title or Path(filename).stem).strip(),
        "filename": filename,
        "kp": kp,
        "source_type": "uploaded_pdf" if suffix == ".pdf" else "uploaded_text",
        "bytes": len(data),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    meta_path = upload_meta_path(stored)
    _write_json(meta_path, meta)

    try:
        vector_count = ingest_corpus(force=True)
        chunks = chunks_for_source(source_id)
        if not chunks:
            stored.unlink(missing_ok=True)
            meta_path.unlink(missing_ok=True)
            ingest_corpus(force=True)
            raise HTTPException(400, "no readable text extracted from file")
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        stored.unlink(missing_ok=True)
        meta_path.unlink(missing_ok=True)
        ingest_corpus(force=True)
        raise HTTPException(400, f"indexing failed: {exc}") from exc

    sample = [
        {
            "text": c.get("text", "")[:240],
            "citation": c.get("citation") or f"{meta['title']} p.{c.get('page', '?')}",
        }
        for c in chunks[:3]
    ]
    return {
        "source": _source_response(meta, len(chunks)),
        "vector_count": vector_count,
        "sample": sample,
    }


@router.get("/sources")
async def list_sources(user_id: str = Query("demo_user")):
    counts = _chunk_counts()
    items = []
    for _, meta in _uploaded_metas():
        if user_id and meta.get("user_id") != user_id:
            continue
        source_id = str(meta.get("id") or "")
        items.append(_source_response(meta, counts.get(source_id, 0)))
    items.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return {"items": items}


@router.get("/search")
async def search_knowledge(
    query: str = Query(..., min_length=1),
    kp: str | None = None,
    limit: int = Query(5, ge=1, le=20),
):
    ingest_corpus()
    hits = retrieve(query, top_k=max(20, limit * 4), final_k=max(limit * 2, limit))
    if kp:
        hits = [hit for hit in hits if hit.get("kp") == kp]
    return {
        "items": [
            {
                "text": hit.get("text", "")[:480],
                "citation": hit.get("citation", ""),
                "source": hit.get("source", ""),
                "source_id": hit.get("source_id", ""),
                "source_type": hit.get("source_type", ""),
                "kp": hit.get("kp", ""),
                "score": hit.get("score", 0),
            }
            for hit in hits[:limit]
        ]
    }
