from __future__ import annotations

import datetime as dt
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

from .config import RUNS_DIR, get_settings


def _safe_name(value: Any) -> str:
    text = str(value or "item").strip()
    text = re.sub(r"[^A-Za-z0-9_.-]+", "_", text)
    return text.strip("_") or "item"


def _json_default(value: Any) -> str:
    if isinstance(value, (dt.datetime, dt.date)):
        return value.isoformat()
    return str(value)


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, default=_json_default),
        encoding="utf-8",
    )


class TraceRecorder:
    def __init__(self, state: dict[str, Any]) -> None:
        self.enabled = bool(get_settings().trace_enabled)
        self.session_id = _safe_name(state.get("session_id", "default"))
        self.run_dir = RUNS_DIR / self.session_id
        self.events: list[dict[str, Any]] = []
        self.counts: Counter[str] = Counter()
        self.resources: list[dict[str, Any]] = []
        self.agent_outputs: dict[str, dict[str, Any]] = {}
        if self.enabled:
            self.run_dir.mkdir(parents=True, exist_ok=True)
            _write_json(self.run_dir / "request.json", state)
            (self.run_dir / "events.jsonl").write_text("", encoding="utf-8")

    def record_event(self, event: dict[str, Any]) -> None:
        if not self.enabled:
            return
        event = dict(event)
        self.events.append(event)
        etype = str(event.get("type", "unknown"))
        self.counts[etype] += 1

        with (self.run_dir / "events.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False, default=_json_default) + "\n")

        if etype == "profile":
            _write_json(self.run_dir / "profile.output.json", event.get("profile", {}))
        elif etype == "path":
            _write_json(self.run_dir / "path.output.json", event.get("path", {}))
        elif etype == "resource":
            resource = event.get("resource") or {}
            self.resources.append(resource)
            kind = _safe_name(resource.get("kind", "resource"))
            rid = _safe_name(resource.get("id", len(self.resources)))
            _write_json(self.run_dir / "resources" / f"{kind}_{rid}.json", resource)
        elif etype == "agent_end":
            agent = _safe_name(event.get("agent", "agent"))
            self.agent_outputs[agent] = event
            _write_json(self.run_dir / "agent_end" / f"{agent}.json", event)
        elif etype == "summary":
            _write_json(self.run_dir / "eval.output.json", event)

    def record_final_state(self, state: dict[str, Any] | None) -> None:
        if not self.enabled or state is None:
            return
        _write_json(self.run_dir / "final_state.json", state)
        if state.get("plan"):
            _write_json(self.run_dir / "planner.output.json", state["plan"])
        if state.get("path_plan"):
            _write_json(self.run_dir / "path.output.json", state["path_plan"])
        resources = state.get("generated_resources") or {}
        if resources:
            _write_json(self.run_dir / "final.resources.json", resources)

    def record_error(self, detail: str) -> None:
        if self.enabled:
            _write_json(self.run_dir / "error.json", {"detail": detail})

    def finish(self) -> None:
        if not self.enabled:
            return
        _write_json(self.run_dir / "events.json", self.events)
        summary = {
            "session_id": self.session_id,
            "run_dir": str(self.run_dir),
            "captured_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "event_counts": dict(self.counts),
            "agents": sorted(self.agent_outputs),
            "resources": [
                {
                    "id": r.get("id"),
                    "kind": r.get("kind"),
                    "kp": r.get("kp"),
                    "title": r.get("title"),
                }
                for r in self.resources
            ],
            "files": {
                "request": "request.json",
                "events": "events.json",
                "events_jsonl": "events.jsonl",
                "profile": "profile.output.json",
                "planner": "planner.output.json",
                "path": "path.output.json",
                "resources": "resources/",
                "agent_end": "agent_end/",
                "final_state": "final_state.json",
            },
        }
        _write_json(self.run_dir / "summary.json", summary)

