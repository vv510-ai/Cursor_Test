"""事件总线:per-request contextvar,智能体内 await emit({...}) 即向前端 SSE 推送
agent_start/agent_token/agent_end/resource/progress/... 事件 —— AgentTrace 面板的数据源。

不把回调放进 State,保证 State 可被 LangGraph checkpointer 序列化。"""
from __future__ import annotations

import asyncio
import contextvars
import datetime as dt
from typing import Any, Awaitable, Callable

_EMITTER: contextvars.ContextVar[Callable[[dict], Awaitable[None]] | None] = \
    contextvars.ContextVar("sparklearn_emitter", default=None)


def set_emitter(fn: Callable[[dict], Awaitable[None]]):
    return _EMITTER.set(fn)


def reset_emitter(token) -> None:
    _EMITTER.reset(token)


async def emit(event: dict[str, Any]) -> None:
    fn = _EMITTER.get()
    if fn is None:
        return
    event.setdefault("ts", dt.datetime.now(dt.timezone.utc).strftime("%H:%M:%S.%f")[:-3])
    await fn(event)


async def agent_start(agent: str, label: str, detail: str = "") -> None:
    await emit({"type": "agent_start", "agent": agent, "label": label, "detail": detail})


async def agent_end(agent: str, summary: str = "", output: dict | None = None) -> None:
    await emit({"type": "agent_end", "agent": agent, "summary": summary, "output": output or {}})


async def agent_token(agent: str, delta: str) -> None:
    await emit({"type": "agent_token", "agent": agent, "delta": delta})
