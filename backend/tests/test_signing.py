from __future__ import annotations

from urllib.parse import parse_qs, urlparse

from app.llm import signing


def test_auth_date_uses_unix_time_without_local_timezone_conversion(monkeypatch):
    monkeypatch.setattr(signing.time, "time", lambda: 0.0)

    signed = signing.assemble_auth_url(
        "https://example.com/v1/test",
        "api-key",
        "api-secret",
        method="POST",
    )

    query = parse_qs(urlparse(signed).query)
    assert query["date"] == ["Thu, 01 Jan 1970 00:00:00 GMT"]
    assert query["host"] == ["example.com"]
