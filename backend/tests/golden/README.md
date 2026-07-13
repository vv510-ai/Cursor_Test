# 多模态金样最小集

本目录只用于手动真实服务验收，不进入默认 `pytest`，不包含个人信息或密钥。

- `lecture_binary_tree.png`：二叉树遍历讲义图。
- `lecture_sorting.png`：排序算法讲义图。
- `narration.txt`：TTS 固定旁白。
- `cover_prompts.json`：两个固定文生图提示词。

运行：

```powershell
cd backend
.\.venv\Scripts\python.exe tests\smoke_multimodal.py --golden
```

验收要求：两张图 OCR 均不少于 20 字，TTS 输出文件非空，两张生成图的 PNG/JPEG 数据可校验。任何一项未开通、超时或降级都会返回非零退出码并打印 `code/message/sid`，不会用演示结果冒充通过。
