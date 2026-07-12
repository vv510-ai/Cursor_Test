from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _offline_by_default(monkeypatch):
    """Keep pytest offline even when the developer .env contains real keys."""
    from app import config

    monkeypatch.setenv("DEMO_MODE", "true")
    monkeypatch.setenv("EMBEDDING_BACKEND", "hash")
    config.get_settings.cache_clear()
    yield
    config.get_settings.cache_clear()
