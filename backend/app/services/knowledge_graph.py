"""《数据结构与算法》知识图谱:手工构建的知识点节点 + 先修依赖边(DAG)。

用途:① Path Agent 拓扑排序生成个性化路径;② 画像 knowledge_mastery 的键空间;
③ 前端 /path 页面可视化。数据文件 data/knowledge_graph.json 可由教研侧维护。
"""
from __future__ import annotations

import json
from functools import lru_cache

from ..config import DATA_DIR

KG_FILE = DATA_DIR / "knowledge_graph.json"


@lru_cache
def load_kg() -> dict:
    data = json.loads(KG_FILE.read_text(encoding="utf-8"))
    nodes = {n["id"]: n for n in data["nodes"]}
    indeg = {nid: 0 for nid in nodes}
    adj: dict[str, list[str]] = {nid: [] for nid in nodes}
    for e in data["edges"]:
        adj[e["from"]].append(e["to"])
        indeg[e["to"]] += 1
    return {"nodes": nodes, "edges": data["edges"], "adj": adj, "indeg": indeg}


def all_kp_ids() -> list[str]:
    return list(load_kg()["nodes"].keys())


def kp_name(kp_id: str) -> str:
    return load_kg()["nodes"].get(kp_id, {}).get("name", kp_id)


def prerequisites(kp_id: str) -> list[str]:
    kg = load_kg()
    return [e["from"] for e in kg["edges"] if e["to"] == kp_id]


def topological_order() -> list[str]:
    """Kahn 拓扑排序;同层按 difficulty 升序,保证"循序渐进"默认顺序。"""
    kg = load_kg()
    indeg = dict(kg["indeg"])
    ready = sorted([n for n, d in indeg.items() if d == 0],
                   key=lambda x: kg["nodes"][x].get("difficulty", 1))
    order: list[str] = []
    while ready:
        cur = ready.pop(0)
        order.append(cur)
        for nxt in kg["adj"][cur]:
            indeg[nxt] -= 1
            if indeg[nxt] == 0:
                ready.append(nxt)
        ready.sort(key=lambda x: kg["nodes"][x].get("difficulty", 1))
    return order


def unlockable(mastery: dict[str, float], threshold: float = 0.6) -> list[str]:
    """先修均达标即解锁(供路径规划筛选 ready 节点)。"""
    out = []
    for kp in all_kp_ids():
        pres = prerequisites(kp)
        if all(mastery.get(p, 0.0) >= threshold for p in pres):
            out.append(kp)
    return out
