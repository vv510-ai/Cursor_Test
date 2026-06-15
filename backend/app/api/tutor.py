"""POST /api/tutor —— 多模态答疑(SSE)。支持 image_base64 拍照搜题(讯飞 OCR),
intent 固定 tutor,直达 Tutor Agent,逐 token 流式 + Mermaid 图解 + 引用溯源。"""
from __future__ import annotations

import uuid

from fastapi import APIRouter

from ..agents.graph import run_with_events
from ..schemas.core import TutorRequest
from ..services.profile_service import ensure_user
from .sse import sse_response

router = APIRouter(prefix="/api", tags=["tutor"])


@router.post("/tutor")
async def tutor(req: TutorRequest):
    ensure_user(req.user_id)
    state = {
        "user_id": req.user_id,
        "session_id": uuid.uuid4().hex[:8],
        "messages": [{"role": "user", "content": req.question or "请讲讲这道题"}],
        "intent": "tutor",
        "tutor_extras": {"image_base64": req.image_base64, "want": req.want},
    }
    return sse_response(run_with_events(state))
