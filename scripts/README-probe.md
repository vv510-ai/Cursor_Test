# DeepSeek 流式探测脚本

## 运行

```bash
cd scripts
pip install -r requirements-test.txt
python deepseek_stream_probe.py
```

## 产出（`scripts/logs/`）

| 文件 | 说明 |
|------|------|
| `openai_ChatCompletionChunk_schema.json` | OpenAI Python SDK 自带的流式 chunk JSON Schema（**不含** DeepSeek 专有扩展字段名） |
| `probe_chat_thinking_high.json` | `deepseek-chat` + `reasoning_effort` + `extra_body.thinking` 开启时的字段路径与样例 chunk |
| `probe_chat_thinking_disabled.json` | 对照：关闭 thinking |
| `probe_multiturn_chat_thinking.json` | 两轮对话；第二轮请求里 assistant 消息是否包含 `reasoning_content` |
| `probe_index.json` | 上述结果的索引 |
| `error_*.json` | 若 API 返回错误（如 **402 余额不足**），记录完整响应 JSON |

## 前端对接要点（与脚本一致）

1. **请求**：与 OpenAI 兼容；思考模式使用  
   `reasoning_effort`（如 `"high"`） + `extra_body={"thinking": {"type": "enabled"}}`（具体以官方为准）。
2. **流式响应**：SSE `data: {json}`；解析 `choices[0].delta`：  
   - 常见：`content`（最终回复增量）  
   - DeepSeek 扩展：`reasoning_content`（思维链增量，可与 `content` 分开展示）
3. **多轮**：第二轮不要把上一轮的 `reasoning_content` 再发给模型（官方说明 API 会忽略 assistant 上的该字段；建议在持久化与上游组装时只传 `role`+`content`）。

## 余额不足（402）

若出现 `Insufficient Balance`，密钥通常有效但账户需充值；脚本仍会写入 `error_*.json` 便于对接错误展示。
