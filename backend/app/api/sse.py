"""SSE 公共封装:把异步事件字典流包装为 text/event-stream(手写协议,零额外依赖)。"""
from __future__ import annotations

import json
from typing import AsyncIterator

from fastapi.responses import StreamingResponse

HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no",
           "Connection": "keep-alive"}


async def _wrap(gen: AsyncIterator[dict]):
    async for ev in gen:
        yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"


def sse_response(gen: AsyncIterator[dict]) -> StreamingResponse:
    return StreamingResponse(_wrap(gen), media_type="text/event-stream", headers=HEADERS)
