"""讯飞 OCR / 图片理解:用户拍照提问的入口。

优先走星火图片理解多模态接口;未配置三元组时返回提示文本(演示模式给出固定示例)。
"""
from __future__ import annotations

import base64
import json
import logging

from ..config import get_settings, is_demo
from .signing import assemble_auth_url

log = logging.getLogger("sparklearn.ocr")
IMG_UNDERSTAND_URL = "wss://spark-api.cn-huabei-1.xf-yun.com/v2.1/image"


def image_to_question(image_bytes: bytes, hint: str = "") -> str:
    """图片 → 题目文本。演示模式返回内置样例,保证拍照答疑链路可演示。"""
    if is_demo():
        return "【演示OCR】题目:已知一棵二叉搜索树,求中序遍历序列,并说明为何有序。" + (f"(用户补充:{hint})" if hint else "")
    s = get_settings()
    if not (s.spark_appid and s.spark_api_key and s.spark_api_secret):
        return "(未配置讯飞图片理解三元组,无法解析图片;请直接文字描述题目)"
    try:
        import websocket
    except ImportError:
        return "(websocket-client 未安装,无法调用图片理解)"
    url = assemble_auth_url(IMG_UNDERSTAND_URL.replace("wss://", "https://"),
                            s.spark_api_key, s.spark_api_secret).replace("https://", "wss://")
    result: list[str] = []
    req = {
        "header": {"app_id": s.spark_appid},
        "parameter": {"chat": {"domain": "image", "temperature": 0.3, "max_tokens": 1024}},
        "payload": {"message": {"text": [
            {"role": "user", "content": base64.b64encode(image_bytes).decode(), "content_type": "image"},
            {"role": "user", "content": "请完整转写图中题目文字,保留公式与代码。" + hint, "content_type": "text"},
        ]}},
    }

    def on_message(ws, message):  # noqa: ANN001
        msg = json.loads(message)
        if msg["header"]["code"] != 0:
            ws.close(); return
        for t in msg["payload"]["choices"]["text"]:
            result.append(t.get("content", ""))
        if msg["payload"]["choices"]["status"] == 2:
            ws.close()

    ws = websocket.WebSocketApp(url, on_message=on_message,
                                on_open=lambda w: w.send(json.dumps(req)))
    ws.run_forever()
    return "".join(result) or "(图片理解无返回)"
