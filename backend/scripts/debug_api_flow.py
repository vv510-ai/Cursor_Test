"""Debug the SparkLearn generation flow.

This script follows the course advice: verify the real running fields instead
of trusting guessed contracts. It can run in-process for quick backend checks,
or against a live backend/frontend proxy URL for API/SSE integration checks.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

try:
    from tests._stubs import install

    install()
except Exception:
    pass


DEFAULT_USER = "debug_user"
DEFAULT_KP = "binary_tree"
DEFAULT_KINDS = ["doc", "mindmap", "quiz", "video"]


def _payload(session_id: str) -> dict[str, Any]:
    return {
        "user_id": DEFAULT_USER,
        "goal": "联调验证：请生成二叉树学习资源，并检查 SSE 事件和引用字段",
        "knowledge_points": [DEFAULT_KP],
        "kinds": DEFAULT_KINDS,
        "session_id": session_id,
    }


def _state(session_id: str) -> dict[str, Any]:
    payload = _payload(session_id)
    return {
        "user_id": payload["user_id"],
        "session_id": session_id,
        "messages": [{"role": "user", "content": payload["goal"]}],
        "learning_goal": payload["goal"],
        "knowledge_points": payload["knowledge_points"],
        "kinds": payload["kinds"],
        "intent": "generate",
    }


def _request_json(url: str, timeout: float) -> dict[str, Any]:
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        data = resp.read().decode("utf-8")
    return json.loads(data)


def _post_sse(url: str, payload: dict[str, Any], timeout: float) -> list[dict[str, Any]]:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
        method="POST",
    )
    events: list[dict[str, Any]] = []
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        for raw in resp:
            line = raw.decode("utf-8").strip()
            if not line.startswith("data:"):
                continue
            event = json.loads(line[5:].strip())
            events.append(event)
            _print_event(event)
            if event.get("type") == "done":
                break
    return events


def _print_event(event: dict[str, Any]) -> None:
    etype = event.get("type")
    if etype == "agent_start":
        print(f"  agent_start  {event.get('agent')}")
    elif etype == "agent_end":
        print(f"  agent_end    {event.get('agent')}: {event.get('summary', '')[:70]}")
    elif etype == "resource":
        resource = event.get("resource") or {}
        print(f"  resource     {resource.get('kind')} | {resource.get('title')}")
    elif etype in {"path", "profile", "summary", "done", "error"}:
        print(f"  {etype}")


async def _run_inprocess(session_id: str) -> tuple[int, list[dict[str, Any]], Path]:
    from app.agents.graph import run_with_events
    from app.config import RUNS_DIR
    from app.models.db import init_db
    from app.rag.ingest import ingest_corpus
    from app.services.profile_service import ensure_user

    init_db()
    chunk_count = ingest_corpus()
    ensure_user(DEFAULT_USER)

    events: list[dict[str, Any]] = []
    async for event in run_with_events(_state(session_id)):
        events.append(event)
        _print_event(event)
    return chunk_count, events, RUNS_DIR / session_id


def _summarize(events: list[dict[str, Any]]) -> None:
    counts = Counter(str(e.get("type")) for e in events)
    route = [e.get("agent") for e in events if e.get("type") == "agent_start"]
    resources = [e.get("resource") or {} for e in events if e.get("type") == "resource"]
    print("\nSummary")
    print(f"  events: {len(events)} {dict(counts)}")
    print(f"  route: {' -> '.join(str(x) for x in route)}")
    print(f"  resources: {[r.get('kind') for r in resources]}")


def _validate(events: list[dict[str, Any]]) -> None:
    if not events:
        raise AssertionError("No events captured")
    if events[-1].get("type") != "done":
        raise AssertionError(f"Last event should be done, got {events[-1]}")
    errors = [e for e in events if e.get("type") == "error"]
    if errors:
        raise AssertionError(f"Error events found: {errors}")

    route = {e.get("agent") for e in events if e.get("type") == "agent_start"}
    for agent in ("profile", "orchestrator", "planner", "path", "doc", "mindmap", "quiz", "media", "eval"):
        if agent not in route:
            raise AssertionError(f"Missing agent_start: {agent}")

    resources = [e.get("resource") or {} for e in events if e.get("type") == "resource"]
    kinds = {r.get("kind") for r in resources}
    missing = set(DEFAULT_KINDS) - kinds
    if missing:
        raise AssertionError(f"Missing resources: {sorted(missing)}")

    doc = next((r for r in resources if r.get("kind") == "doc"), None)
    if not doc or not doc.get("citations"):
        raise AssertionError("Doc resource should include citations")


def run_live(base_url: str, timeout: float, session_id: str) -> list[dict[str, Any]]:
    base_url = base_url.rstrip("/")
    print(f"Live API: {base_url}")
    print("Health")
    print(" ", _request_json(f"{base_url}/api/health", timeout))
    print("Knowledge graph")
    kg = _request_json(f"{base_url}/api/kg", timeout)
    print(f"  course={kg.get('course')} nodes={len(kg.get('nodes') or [])} edges={len(kg.get('edges') or [])}")
    print("Generate SSE")
    return _post_sse(f"{base_url}/api/resources/generate", _payload(session_id), timeout)


def main() -> None:
    parser = argparse.ArgumentParser(description="Debug SparkLearn backend/API generation flow")
    parser.add_argument("--base-url", help="Live API base URL, for example http://127.0.0.1:8000")
    parser.add_argument("--timeout", type=float, default=90.0)
    args = parser.parse_args()

    session_id = f"debug-{int(time.time())}"
    try:
        if args.base_url:
            chunk_count = None
            events = run_live(args.base_url, args.timeout, session_id)
            run_dir = None
        else:
            chunk_count, events, run_dir = asyncio.run(_run_inprocess(session_id))

        _summarize(events)
        _validate(events)

        print("\nOK")
        if chunk_count is not None:
            print(f"  chunks: {chunk_count}")
        if run_dir is not None:
            print(f"  trace: {run_dir}")
    except (AssertionError, urllib.error.URLError, TimeoutError) as exc:
        print("\nFAILED")
        print(f"  {exc}")
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
