"""数据库会话:缺省 SQLite 零依赖演示;docker-compose 下注入 PostgreSQL DATABASE_URL。"""
from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from ..config import get_settings, sqlite_default_url


class Base(DeclarativeBase):
    pass


def _url() -> str:
    return get_settings().database_url or sqlite_default_url()


_engine = None
_SessionLocal = None


def get_engine():
    global _engine, _SessionLocal
    if _engine is None:
        url = _url()
        kw = {"connect_args": {"check_same_thread": False}} if url.startswith("sqlite") else {}
        _engine = create_engine(url, pool_pre_ping=True, **kw)
        _SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine


def init_db() -> None:
    from . import entities  # noqa: F401  确保模型注册
    Base.metadata.create_all(get_engine())


def session() -> Session:
    get_engine()
    return _SessionLocal()
