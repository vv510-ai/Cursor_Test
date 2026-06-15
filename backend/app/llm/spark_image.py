"""讯飞星火图片生成(文生图,HTTP+HMAC)。失败/未配置时返回 None,由上层降级为 SVG 占位图。"""
from __future__ import annotations

import base64
import json
import logging

import requests

from ..config import GEN_DIR, get_settings
from .signing import assemble_auth_url

log = logging.getLogger("sparklearn.image")
TTI_URL = "https://spark-api.cn-huabei-1.xf-yun.com/v2.1/tti"


def generate_image(prompt: str, *, width: int = 1024, height: int = 768) -> str | None:
    s = get_settings()
    if not (s.spark_appid and s.spark_api_key and s.spark_api_secret):
        return None
    url = assemble_auth_url(TTI_URL, s.spark_api_key, s.spark_api_secret, method="POST")
    body = {
        "header": {"app_id": s.spark_appid},
        "parameter": {"chat": {"domain": "general", "width": width, "height": height}},
        "payload": {"message": {"text": [{"role": "user", "content": prompt}]}},
    }
    try:
        r = requests.post(url, json=body, timeout=120)
        data = r.json()
        text = data["payload"]["choices"]["text"][0]["content"]
        img = base64.b64decode(text)
        out = GEN_DIR / f"img_{abs(hash(prompt)) % 10**8}.jpg"
        out.write_bytes(img)
        return f"/static/gen/{out.name}"
    except Exception as e:  # noqa: BLE001
        log.warning("文生图失败:%s", e)
        return None
