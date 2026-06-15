"""讯飞旧版鉴权:HMAC-SHA256 URL 签名(TTS / 文生图 / OCR 等 WebSocket/HTTP 接口)。

仅传统接口需要 APPID+APIKey+APISecret 三元组;OpenAI 兼容 HTTP 接口只需 APIPassword。
"""
from __future__ import annotations

import base64
import hashlib
import hmac
from datetime import datetime, timezone
from urllib.parse import urlencode, urlparse
from wsgiref.handlers import format_date_time
from time import mktime


def assemble_auth_url(url: str, api_key: str, api_secret: str, method: str = "GET") -> str:
    """按讯飞规范生成带 authorization/date/host 查询参数的鉴权 URL。"""
    u = urlparse(url)
    host, path = u.netloc, u.path
    now = datetime.now(timezone.utc)
    date = format_date_time(mktime(now.timetuple()))
    signature_origin = f"host: {host}\ndate: {date}\n{method} {path} HTTP/1.1"
    signature_sha = hmac.new(api_secret.encode(), signature_origin.encode(),
                             digestmod=hashlib.sha256).digest()
    signature = base64.b64encode(signature_sha).decode()
    authorization_origin = (
        f"api_key=\"{api_key}\", algorithm=\"hmac-sha256\", "
        f"headers=\"host date request-line\", signature=\"{signature}\""
    )
    authorization = base64.b64encode(authorization_origin.encode()).decode()
    return url + "?" + urlencode({"authorization": authorization, "date": date, "host": host})
