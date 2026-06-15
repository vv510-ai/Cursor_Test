"""画像服务:≥6 维动态学生画像的持久化与"随学随新"增量更新。

8 个维度(超出赛题 ≥6 维要求):
1 knowledge_mastery  各知识点掌握度 0-1(BKT 更新)
2 cognitive_style    认知风格:视觉型/语言型/动手型
3 error_prone        易错点偏好(高频错误知识点与错误类型)
4 goal               学习目标/动机:应试/竞赛/工程实践/兴趣
5 pace               学习节奏与投入(时长/频率/专注度)
6 difficulty_pref    难度偏好:循序渐进 vs 挑战式
7 resource_pref      资源类型偏好(各类点击/完成率)
8 metacognition      元认知水平(自评准确度、求助频率)
"""
from __future__ import annotations

import datetime as dt
from typing import Any

from sqlalchemy import select

from ..models.db import init_db, session
from ..models.entities import EventLog, Profile, User
from ..services.bkt import bkt_update
from ..services.knowledge_graph import all_kp_ids


def default_profile() -> dict:
    return {
        "knowledge_mastery": {kp: 0.30 for kp in all_kp_ids()},
        "cognitive_style": "未知",
        "error_prone": [],
        "goal": "未知",
        "pace": {"daily_minutes": 30, "frequency": "未知", "focus": "中"},
        "difficulty_pref": "循序渐进",
        "resource_pref": {"doc": 0.2, "video": 0.2, "quiz": 0.2, "mindmap": 0.2, "code": 0.2},
        "metacognition": 0.5,
        "evidence": "冷启动默认画像(8-10 题诊断问卷或首次对话后更新)",
    }


def ensure_user(user_id: str, name: str = "同学") -> None:
    init_db()
    with session() as s:
        if not s.get(User, user_id):
            s.add(User(id=user_id, name=name))
            s.commit()


def get_profile(user_id: str) -> dict:
    ensure_user(user_id)
    with session() as s:
        p = s.get(Profile, user_id)
        if p is None:
            p = Profile(user_id=user_id, data=default_profile(), version=1)
            s.add(p)
            s.commit()
        data = dict(p.data)
        data["_version"] = p.version
        data["_updated_at"] = (p.updated_at or dt.datetime.now(dt.timezone.utc)).isoformat()
        return data


def merge_profile(user_id: str, patch: dict[str, Any]) -> dict:
    """浅合并 + 字典维度深合并;version 自增,实现"随学随新"。"""
    ensure_user(user_id)
    with session() as s:
        p = s.get(Profile, user_id)
        if p is None:
            p = Profile(user_id=user_id, data=default_profile(), version=0)
            s.add(p)
        data = dict(p.data or default_profile())
        for k, v in patch.items():
            if k.startswith("_"):
                continue
            if isinstance(v, dict) and isinstance(data.get(k), dict):
                merged = dict(data[k])
                merged.update(v)
                data[k] = merged
            elif k == "error_prone" and isinstance(v, list):
                data[k] = list(dict.fromkeys([*data.get(k, []), *v]))[:8]
            elif v not in (None, "", "未知"):
                data[k] = v
        p.data = data
        p.version = (p.version or 0) + 1
        s.commit()
        return get_profile(user_id)


def update_mastery(user_id: str, kp: str, correct: bool) -> float:
    prof = get_profile(user_id)
    cur = float(prof["knowledge_mastery"].get(kp, 0.3))
    new = bkt_update(cur, correct)
    merge_profile(user_id, {"knowledge_mastery": {kp: new}})
    return new


def log_event(user_id: str, etype: str, payload: dict) -> None:
    ensure_user(user_id)
    with session() as s:
        s.add(EventLog(user_id=user_id, etype=etype, payload=payload))
        s.commit()


def recent_events(user_id: str, limit: int = 30) -> list[dict]:
    with session() as s:
        rows = s.execute(
            select(EventLog).where(EventLog.user_id == user_id)
            .order_by(EventLog.id.desc()).limit(limit)
        ).scalars().all()
        return [{"etype": r.etype, "payload": r.payload,
                 "ts": r.created_at.isoformat() if r.created_at else ""} for r in rows]
