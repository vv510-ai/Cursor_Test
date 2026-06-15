"""单元测试:BKT / 知识图谱 / 路径规划(离线可跑,无外部依赖)。"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from tests._stubs import install  # noqa: E402

install()

from app.services.bkt import bkt_update, mastery_level  # noqa: E402
from app.services.knowledge_graph import (all_kp_ids, prerequisites,  # noqa: E402
                                          topological_order, unlockable)
from app.services.path_service import plan_path  # noqa: E402
from app.services.profile_service import default_profile  # noqa: E402


def test_bkt_monotonic():
    p = 0.3
    for _ in range(6):
        p2 = bkt_update(p, True)
        assert p2 > p, "连续答对掌握度应单调上升"
        p = p2
    assert p > 0.8 and mastery_level(p) == "掌握"
    q = bkt_update(0.9, False)
    assert q < 0.9, "答错应下降"
    assert 0.0 <= q <= 1.0


def test_kg_topology():
    ids = all_kp_ids()
    assert len(ids) >= 12
    order = topological_order()
    pos = {kp: i for i, kp in enumerate(order)}
    for kp in ids:
        for pre in prerequisites(kp):
            assert pos[pre] < pos[kp], f"先修 {pre} 必须排在 {kp} 之前"
    # complexity 无先修,任何画像下都应可解锁
    mastery = {k: 0.0 for k in ids}
    assert "complexity" in unlockable(mastery)


def test_plan_path_thresholds():
    prof = default_profile()
    prof["knowledge_mastery"]["complexity"] = 0.95          # 已掌握
    prof["knowledge_mastery"]["array"] = 0.65               # 先修达标
    path = plan_path(prof, goal_kps=["binary_tree"])
    by = {n["id"]: n for n in path["nodes"]}
    assert by["complexity"]["status"] == "done"
    assert by["array"]["status"] in ("ready", "done")
    assert path.get("next_kp") in by, "应推荐一个存在的下一知识点"
    assert by[path["next_kp"]]["status"] == "ready"
    # 边与节点一致
    kp_set = set(by)
    for e in path["edges"]:
        assert e["from"] in kp_set and e["to"] in kp_set


if __name__ == "__main__":
    for fn in (test_bkt_monotonic, test_kg_topology, test_plan_path_thresholds):
        fn()
        print(f"{fn.__name__} ... ok")
    print("ALL SERVICE TESTS PASSED")
