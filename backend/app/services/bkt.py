"""BKT 贝叶斯知识追踪:每个知识点维护掌握概率 p(L),按答题对错贝叶斯更新。

参数:p_init 先验掌握、p_learn 练习后习得、p_slip 会而做错、p_guess 不会蒙对。
公式(标准 BKT):
  先验 p = p(L_t)
  答对: p_obs = p(1-slip) / [p(1-slip) + (1-p)guess]
  答错: p_obs = p·slip / [p·slip + (1-p)(1-guess)]
  更新: p(L_{t+1}) = p_obs + (1-p_obs)·p_learn
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class BKTParams:
    p_init: float = 0.30
    p_learn: float = 0.20
    p_slip: float = 0.10
    p_guess: float = 0.20


def bkt_update(p_mastery: float, correct: bool, params: BKTParams | None = None) -> float:
    pm = params or BKTParams()
    p = min(max(p_mastery, 1e-6), 1 - 1e-6)
    if correct:
        num = p * (1 - pm.p_slip)
        den = num + (1 - p) * pm.p_guess
    else:
        num = p * pm.p_slip
        den = num + (1 - p) * (1 - pm.p_guess)
    p_obs = num / den if den > 0 else p
    return round(p_obs + (1 - p_obs) * pm.p_learn, 4)


def mastery_level(p: float) -> str:
    if p >= 0.8:
        return "掌握"
    if p >= 0.5:
        return "进行中"
    return "薄弱"
