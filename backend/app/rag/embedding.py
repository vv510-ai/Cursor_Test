"""向量化后端(对应方案"无 GPU 时 Embedding 可改用讯飞 Embedding API"的降级链)。

优先级:bge-m3(本地 FlagEmbedding,1024 维,中文多粒度强)
      → iflytek(讯飞 MaaS OpenAI 兼容 /embeddings)
      → hash(零依赖 char n-gram hashing,保证离线演示检索可用)

统一对外:embed_texts(list[str]) -> np.ndarray[float32, (n, dim)],已 L2 归一化。
"""
from __future__ import annotations

import hashlib
import logging
from functools import lru_cache

import numpy as np

from ..config import get_settings

log = logging.getLogger("sparklearn.embedding")
HASH_DIM = 512


class _BGEBackend:
    name, dim = "bge-m3", 1024

    def __init__(self) -> None:
        from FlagEmbedding import BGEM3FlagModel  # 重依赖,惰性导入
        self.model = BGEM3FlagModel("BAAI/bge-m3", use_fp16=True)

    def embed(self, texts: list[str]) -> np.ndarray:
        out = self.model.encode(texts)["dense_vecs"]
        return np.asarray(out, dtype=np.float32)


class _IflytekBackend:
    name, dim = "iflytek", 1024  # 新版 MaaS OpenAI 兼容(旧版 WebSocket 为 2560 维)

    def __init__(self) -> None:
        from openai import OpenAI
        s = get_settings()
        if not s.spark_api_password:
            raise RuntimeError("无 SPARK_API_PASSWORD")
        self.client = OpenAI(api_key=s.spark_api_password, base_url=s.spark_base_url)

    def embed(self, texts: list[str]) -> np.ndarray:
        resp = self.client.embeddings.create(model="embedding", input=texts)
        return np.asarray([d.embedding for d in resp.data], dtype=np.float32)


class _HashBackend:
    """字符 2/3-gram hashing 向量:无任何模型依赖,中文检索效果可用于演示。"""

    name, dim = "hash", HASH_DIM

    def embed(self, texts: list[str]) -> np.ndarray:
        mat = np.zeros((len(texts), HASH_DIM), dtype=np.float32)
        for i, t in enumerate(texts):
            t = t.lower()
            grams = [t[j:j + n] for n in (2, 3) for j in range(max(0, len(t) - n + 1))]
            for g in grams:
                h = int(hashlib.md5(g.encode("utf-8")).hexdigest()[:8], 16)
                mat[i, h % HASH_DIM] += 1.0
        return mat


def _l2(mat: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(mat, axis=1, keepdims=True)
    norm[norm == 0] = 1.0
    return mat / norm


@lru_cache
def get_backend():
    pref = (get_settings().embedding_backend or "auto").lower()
    order = {
        "bge-m3": [_BGEBackend], "iflytek": [_IflytekBackend], "hash": [_HashBackend],
        "auto": [_BGEBackend, _IflytekBackend, _HashBackend],
    }.get(pref, [_HashBackend])
    for cls in order:
        try:
            backend = cls()
            log.info("Embedding 后端:%s (dim=%d)", backend.name, backend.dim)
            return backend
        except Exception as e:  # noqa: BLE001
            log.info("Embedding 后端 %s 不可用(%s),尝试下一级", cls.__name__, e)
    return _HashBackend()


def embed_texts(texts: list[str]) -> np.ndarray:
    return _l2(get_backend().embed(texts))


def embedding_dim() -> int:
    return get_backend().dim
