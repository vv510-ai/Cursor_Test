"""全局配置:读取环境变量,集中管理密钥占位与运行模式。

设计原则(对应赛题"可演示性"硬指标):
- 任何外部密钥缺失都不应让系统崩溃,而是逐级降级(真实 API → 讯飞备选 → 本地模拟);
- DEMO_MODE=auto 时,只要未配置 SPARK_API_PASSWORD 就进入演示模式,
  全链路(画像→规划→并行生成→质检→评估)仍可离线跑通,便于评委一键体验。
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

try:  # pydantic-settings 可用时走标准路径
    from pydantic_settings import BaseSettings, SettingsConfigDict

    class Settings(BaseSettings):
        model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

        # 讯飞星火 OpenAI 兼容
        spark_api_password: str = ""
        spark_base_url: str = "https://spark-api-open.xf-yun.com/v1/"
        spark_x2_base_url: str = "https://spark-api-open.xf-yun.com/x2/"

        # 讯飞三元组(WebSocket/HTTP 旧鉴权:TTS、文生图、OCR)
        spark_appid: str = ""
        spark_api_key: str = ""
        spark_api_secret: str = ""

        # 火山方舟 Seedance
        ark_api_key: str = ""
        ark_base_url: str = "https://ark.cn-beijing.volces.com/api/v3"
        seedance_model: str = ""

        # 存储
        database_url: str = ""
        milvus_uri: str = ""
        redis_url: str = ""

        embedding_backend: str = "auto"  # auto | bge-m3 | iflytek | hash
        rerank_api_url: str = ""
        rerank_api_key: str = ""
        rerank_top_k: int = 5
        demo_mode: str = "auto"          # auto | true | false
        trace_enabled: bool = True       # write backend/runs/{session_id} debug artifacts
        backend_port: int = 8000
        frontend_origin: str = "http://localhost:3000"

except Exception:  # pragma: no cover - 极端环境兜底(未安装 pydantic-settings)
    class Settings:  # type: ignore[no-redef]
        def __init__(self) -> None:
            g = os.environ.get
            self.spark_api_password = g("SPARK_API_PASSWORD", "")
            self.spark_base_url = g("SPARK_BASE_URL", "https://spark-api-open.xf-yun.com/v1/")
            self.spark_x2_base_url = g("SPARK_X2_BASE_URL", "https://spark-api-open.xf-yun.com/x2/")
            self.spark_appid = g("SPARK_APPID", "")
            self.spark_api_key = g("SPARK_API_KEY", "")
            self.spark_api_secret = g("SPARK_API_SECRET", "")
            self.ark_api_key = g("ARK_API_KEY", "")
            self.ark_base_url = g("ARK_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3")
            self.seedance_model = g("SEEDANCE_MODEL", "")
            self.database_url = g("DATABASE_URL", "")
            self.milvus_uri = g("MILVUS_URI", "")
            self.redis_url = g("REDIS_URL", "")
            self.embedding_backend = g("EMBEDDING_BACKEND", "auto")
            self.rerank_api_url = g("RERANK_API_URL", "")
            self.rerank_api_key = g("RERANK_API_KEY", "")
            self.rerank_top_k = int(g("RERANK_TOP_K", "5"))
            self.demo_mode = g("DEMO_MODE", "auto")
            self.trace_enabled = g("TRACE_ENABLED", "true").lower() not in {"0", "false", "no", "off"}
            self.backend_port = int(g("BACKEND_PORT", "8000"))
            self.frontend_origin = g("FRONTEND_ORIGIN", "http://localhost:3000")


BASE_DIR = Path(__file__).resolve().parent          # backend/app
DATA_DIR = BASE_DIR / "data"
CORPUS_DIR = DATA_DIR / "seed_corpus"
STATIC_DIR = BASE_DIR / "static"
GEN_DIR = STATIC_DIR / "gen"
GEN_DIR.mkdir(parents=True, exist_ok=True)
RUNS_DIR = BASE_DIR.parent / "runs"

COURSE_NAME = "数据结构与算法"


@lru_cache
def get_settings() -> "Settings":
    return Settings()


def is_demo() -> bool:
    """无星火密钥 → 自动演示模式;可用 DEMO_MODE 显式覆盖。"""
    s = get_settings()
    flag = (s.demo_mode or "auto").lower()
    if flag in {"1", "true", "yes", "on"}:
        return True
    if flag in {"0", "false", "no", "off"}:
        return False
    return not bool(s.spark_api_password)


def sqlite_default_url() -> str:
    return f"sqlite:///{(BASE_DIR.parent / 'sparklearn.db').as_posix()}"
