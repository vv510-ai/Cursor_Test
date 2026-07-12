from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _offline_multimodal_by_default(monkeypatch):
    """Keep the default test suite offline even when the developer .env has keys."""
    from app.llm import multimodal_gateway

    monkeypatch.setattr(multimodal_gateway, "is_demo", lambda: True)
