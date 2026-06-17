# 多来源 RAG 资料接入指南

这份文档对应“多模态 RAG 问答系统”的工程化用法：先不要急着重写模型链路，第一步是把课件、视频链接、案例笔记、外部文本统一接入知识库，让检索结果能带来源和 URL。

## 页面上传入口

资源工坊现在支持从页面上传 `.txt`、`.md`、`.pdf` 学习资料。上传后后端会：

1. 保存原文件到 `backend/app/data/uploaded_sources/`
2. 写入同名 `.meta.json` 元数据
3. 重新构建本地向量索引
4. 通过 `/api/knowledge/search` 立即验证检索结果

`uploaded_sources/` 已被 `.gitignore` 忽略，适合放个人教材、课堂笔记和临时资料。下面的 `extra_sources/` 更适合开发者手工维护的公共样例资料。

## 放在哪里

把新增资料放到：

```text
backend/app/data/extra_sources/
```

当前支持三种格式：

```text
.md
.txt
.json
```

系统启动或第一次检索时会把这些资料和原来的 `seed_corpus` 一起写入向量库。文件内容变化后，系统会根据 `vector_store_manifest.json` 自动重建向量库。

## JSON 推荐格式

视频、网页、案例、论文链接优先用 JSON，字段更清楚：

```json
{
  "items": [
    {
      "id": "video_binary_tree_intro",
      "type": "video_link",
      "title": "二叉树入门视频讲解",
      "url": "https://example.com/resources/binary-tree-intro",
      "summary": "视频摘要",
      "content": "补充说明或转写文本",
      "kp": "binary_tree",
      "tags": ["video", "binary_tree", "traversal"]
    }
  ]
}
```

字段含义：

```text
id       唯一编号，建议英文小写加下划线
type     来源类型，例如 video_link / case_note / article / dataset
title    展示给用户看的来源标题
url      原始链接，可为空
summary  摘要，会参与检索
content  正文、转写、笔记，会参与检索
kp       对应知识点 id，例如 binary_tree / queue / graph
tags     标签数组，方便后续筛选
```

## Markdown 格式

Markdown 可以写 front matter：

```markdown
---
source: 二叉树课堂补充讲义
chapter: 递归遍历
kp: binary_tree
type: article
url: https://example.com/resources/tree-recursion
tags: binary_tree, recursion
---

## 为什么遍历要用递归

这里写正文。
```

## 接入后怎么验证

后端目录执行：

```powershell
cd C:\Users\26054\Desktop\sparklearn-multiagent\backend
.\.venv\Scripts\python.exe tests\test_services.py
```

如果测试通过，说明 extra sources 能被读取，引用格式也能带上 URL。

也可以直接问和资料相关的问题，例如：

```text
二叉树遍历有没有视频讲解？
```

答案引用里应该能看到类似：

```text
二叉树入门视频讲解 (video_link) https://example.com/resources/binary-tree-intro
```
