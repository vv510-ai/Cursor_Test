"""真实评估闭环冒烟：仅通过现有 /api/eval/submit 提交答案。

运行前要求 demo_user 处于画像治理后的干净状态：
  - quiz_attempts = 0
  - binary_tree / sorting_adv 掌握度均为 0.3
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.models.db import session
from app.models.entities import EventLog, PathPlan, Profile, QuizAttempt, Resource

API_URL = "http://127.0.0.1:8010/api/eval/submit"
USER_ID = "demo_user"
BINARY_QUIZ_ID = "d7115055f70b"
SORTING_QUIZ_ID = "c8ff83c4ecd5"


def _resource(resource_id: str) -> Resource:
    with session() as s:
        row = s.get(Resource, resource_id)
        if row is None:
            raise RuntimeError(f"题组不存在：{resource_id}")
        s.expunge(row)
        return row


def _profile_data() -> tuple[int, dict]:
    with session() as s:
        row = s.get(Profile, USER_ID)
        if row is None:
            raise RuntimeError("demo_user 画像不存在")
        return int(row.version or 0), dict(row.data or {})


def _path_data() -> dict | None:
    with session() as s:
        row = s.get(PathPlan, USER_ID)
        return dict(row.data) if row else None


def _node(path: dict | None, kp: str) -> dict | None:
    return next((n for n in (path or {}).get("nodes", []) if n.get("id") == kp), None)


def _score_rank(path: dict | None, kp: str) -> int | None:
    nodes = sorted(
        (path or {}).get("nodes", []),
        key=lambda n: (-float(n.get("score", 0)), str(n.get("id", ""))),
    )
    for index, node in enumerate(nodes, start=1):
        if node.get("id") == kp:
            return index
    return None


def _snapshot() -> dict:
    version, profile = _profile_data()
    path = _path_data()
    with session() as s:
        attempts = s.query(QuizAttempt).filter(QuizAttempt.user_id == USER_ID).count()
        events = s.query(EventLog).filter(EventLog.user_id == USER_ID).count()
    return {
        "attempts": attempts,
        "events": events,
        "profile_version": version,
        "mastery": {
            "binary_tree": profile.get("knowledge_mastery", {}).get("binary_tree"),
            "sorting_adv": profile.get("knowledge_mastery", {}).get("sorting_adv"),
        },
        "error_prone": list(profile.get("error_prone") or []),
        "path": {
            "next_kp": (path or {}).get("next_kp"),
            "ready_order": [
                {"id": n.get("id"), "order": n.get("order"), "score": n.get("score")}
                for n in (path or {}).get("nodes", [])
                if n.get("order")
            ],
            "binary_tree": _node(path, "binary_tree"),
            "bst": _node(path, "bst"),
            "heap": _node(path, "heap"),
            "graph_basic": _node(path, "graph_basic"),
            "sorting_adv": _node(path, "sorting_adv"),
            "sorting_adv_score_rank": _score_rank(path, "sorting_adv"),
        },
    }


def _questions(resource: Resource) -> list[dict]:
    payload = resource.payload if isinstance(resource.payload, dict) else {}
    questions = payload.get("questions")
    if not isinstance(questions, list):
        raise RuntimeError(f"题组 {resource.id} questions 字段无效")
    return questions


def _post(resource: Resource, answers: list[dict]) -> dict:
    body = {
        "user_id": USER_ID,
        "quiz_resource_id": resource.id,
        "kp": resource.kp,
        "answers": [
            {
                "question_id": item["question_id"],
                "answer": item["answer"],
                "correct": False,
                "seconds": 0,
            }
            for item in answers
        ],
        "behavior": {},
    }
    request = urllib.request.Request(
        API_URL,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"POST {API_URL} -> {exc.code}: {detail}") from exc


def main() -> None:
    binary = _resource(BINARY_QUIZ_ID)
    sorting = _resource(SORTING_QUIZ_ID)
    binary_questions = _questions(binary)
    sorting_questions = _questions(sorting)

    binary_answers = [
        {"question_id": binary_questions[0]["id"], "answer": binary_questions[0]["answer"]},
        {"question_id": binary_questions[1]["id"], "answer": binary_questions[1]["answer"]},
    ]
    wrong_question = sorting_questions[0]
    wrong_tags = [
        str(tag).strip() for tag in (wrong_question.get("error_tags") or [])
        if len(str(tag).strip()) >= 2
    ]
    if wrong_question.get("type") != "single" or not wrong_tags:
        raise RuntimeError("高级排序预检失败：第一道题不是带合法错因标签的单选题")
    wrong_answer = next(
        letter for letter in ("A", "B", "C", "D")
        if letter != str(wrong_question.get("answer", "")).strip().upper()
    )

    before = _snapshot()
    if before["attempts"] != 0:
        raise RuntimeError(f"要求干净基线 attempts=0，实际为 {before['attempts']}")
    if before["mastery"] != {"binary_tree": 0.3, "sorting_adv": 0.3}:
        raise RuntimeError(f"要求掌握度基线均为 0.3，实际为 {before['mastery']}")

    binary_report = _post(binary, binary_answers)
    sorting_report = _post(
        sorting,
        [{"question_id": wrong_question["id"], "answer": wrong_answer}],
    )
    after = _snapshot()

    binary_before = float(before["mastery"]["binary_tree"])
    binary_after = float(after["mastery"]["binary_tree"])
    sorting_before = float(before["mastery"]["sorting_adv"])
    sorting_after = float(after["mastery"]["sorting_adv"])

    assert after["attempts"] == before["attempts"] + 2
    assert binary_after > binary_before
    assert sorting_after < sorting_before
    assert set(wrong_tags).issubset(set(after["error_prone"]))
    assert all(len(tag) >= 2 and tag != "未归因" for tag in wrong_tags)
    assert after["path"]["bst"]["status"] == "ready"
    assert after["path"]["heap"]["status"] == "ready"
    assert after["path"]["graph_basic"]["status"] == "locked"
    assert float(after["path"]["sorting_adv"]["score"]) > float(
        before["path"]["sorting_adv"]["score"]
    )
    assert after["path"]["sorting_adv_score_rank"] < before["path"]["sorting_adv_score_rank"]
    assert after["profile_version"] > before["profile_version"]

    output = {
        "prechecks": {
            "wrong_quiz": {
                "resource_id": sorting.id,
                "question_id": wrong_question["id"],
                "expected": wrong_question["answer"],
                "submitted": wrong_answer,
                "error_tags": wrong_tags,
            },
            "binary_tree_downstream": {
                "direct": ["bst", "heap", "graph_basic"],
                "expected_unlocked": ["bst", "heap"],
                "still_locked_due_other_prerequisite": ["graph_basic"],
            },
        },
        "before": before,
        "submissions": {
            "binary_tree": {
                "accuracy": binary_report.get("accuracy"),
                "per_kp": binary_report.get("per_kp"),
                "profile_version": binary_report.get("profile_version"),
            },
            "sorting_adv": {
                "accuracy": sorting_report.get("accuracy"),
                "per_kp": sorting_report.get("per_kp"),
                "error_tags": sorting_report.get("error_tags"),
                "profile_version": sorting_report.get("profile_version"),
            },
        },
        "after": after,
        "checks": {
            "attempts_increased_by": after["attempts"] - before["attempts"],
            "binary_tree_mastery": [binary_before, binary_after],
            "sorting_adv_mastery": [sorting_before, sorting_after],
            "valid_error_tags_written": wrong_tags,
            "unlocked": {
                "bst": after["path"]["bst"]["status"],
                "heap": after["path"]["heap"]["status"],
                "graph_basic": after["path"]["graph_basic"]["status"],
            },
            "sorting_adv_priority": {
                "score": [
                    before["path"]["sorting_adv"]["score"],
                    after["path"]["sorting_adv"]["score"],
                ],
                "score_rank": [
                    before["path"]["sorting_adv_score_rank"],
                    after["path"]["sorting_adv_score_rank"],
                ],
                "status": after["path"]["sorting_adv"]["status"],
            },
            "profile_version": [before["profile_version"], after["profile_version"]],
        },
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))
    print("CLOSED_LOOP_SMOKE: PASS")


if __name__ == "__main__":
    main()
