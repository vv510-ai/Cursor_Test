---
name: sparklearn-swap-course
description: 把 SparkLearn 多智能体学习系统从一门课程切换或新增到另一门课程时使用——替换课程知识图谱、种子讲义语料、题库,并同步前端的知识点名称映射与补充资料。只要任务涉及「换课程 / 新增课程 / 把系统迁移到 ×× 学科 / 换一门课做演示 / 替换 knowledge_graph 或 seed_corpus」,就使用本 skill,即使用户没有明确说「换课程」也要触发。仅用于课程内容迁移;日常加功能、改逻辑、调样式、加智能体不要用本 skill。
---

# 换课程(SparkLearn Swap Course)

把系统从当前课程(默认「数据结构与算法」)整体切换到一门新课程。涉及**后端数据 + 前端命名映射多处联动**,漏一处会出现「图谱解锁错乱 / 检索引用对不上 / 雷达图标签错位」等静默问题,务必按清单逐项完成并校验。

## 开始前

1. 先读 `docs/代码结构说明.md` 的「更换课程」段与本仓库 `backend/app/data/` 目录,**确认真实文件名后再动手,不要臆造路径**。
2. 确认运行模式:无 `.env` 时为 `demo_mode=True`(MockEngine 离线),足够做换课验证;真实模型联调另说。
3. 准备好新课程的:知识点清单(id / 名称 / 难度 / 先修关系)、讲义文本、题目、补充材料。

## 步骤

### 1. 替换知识图谱
编辑 `backend/app/data/knowledge_graph.json`:重写节点的 `id` / `name` / `difficulty` 与先修边(prerequisite edges)。

- 节点 `id` 是后续 BKT、`services/knowledge_graph.py`(拓扑 / 解锁)、`services/path_service.py`(状态判定 / 打分 / 处方)以及前端映射的**共同主键,全程保持一致**。
- 先修边决定 `path` 页 DAG 的层次与解锁顺序,改完要在前端核对拓扑是否合理。

### 2. 重灌种子语料
清空旧课程讲义,把新课程讲义放入 `backend/app/data/seed_corpus/`。

- 每篇 front matter 标注来源与许可(团队自编讲义按 `CC BY-SA 4.0`)。
- 入库由 `rag/ingest.py` 完成(解析 → 切片 → 入库),应用启动(`app/main.py`)时执行语料入库。
- **注意清理旧向量**:向量库为 Milvus / 内存双后端;若用持久化后端,需清空旧 collection 后重建,否则会检索到上一门课的内容造成引用串味。

### 3. 更新题库
按需替换 `backend/app/data/seed_quiz.json`(冷启动题库)。题目的知识点标签需与第 1 步的节点 `id` 对齐。运行期 `quiz_agent` 仍会结构化出题 + 本地校验 + 错因标签,种子题用于初始展示与兜底。

### 4. 同步前端知识点名称映射
更新前端中以 `id → 中文名` 形式硬编码知识点的两处:

- `frontend/app/resources/page.tsx`
- `frontend/components/profile/ProfileRadar.tsx`(雷达图维度标签)

确保新 `id` 都有对应中文名,否则页面会出现空标签或回退到原始 id。

### 5. 放入补充材料(可选)
视频链接、网页、案例笔记等放 `backend/app/data/extra_sources/`,格式见 `docs/extra_sources_guide.md`。这些与 `seed_corpus` 一同进入检索与引用溯源。

### 6.(可选)对齐其余课程文案
全仓检索「数据结构」/ 旧课程名等字样(如 `api/meta.py` 暴露的课程名、`README`、前端标题),替换为新课程名。

## 校验(必须全过)

1. 重启后端,调用健康 / 元信息接口(见 `backend/app/api/meta.py`):`status=ok` 且课程名为新课程。
2. 后端测试通过:`cd backend && pytest`。
3. 前端构建通过:`cd frontend && npm run build`。
4. 端到端冒烟:对新课程的一个知识点发起 `POST /api/resources/generate`,确认
   - `path` 页 DAG 用新知识点正确分层与解锁;
   - `ProfileRadar` 维度标签为新知识点中文名;
   - 生成的资源卡片引用(`[^n]`)指向新语料、无旧课程残留。

## 常见坑

- 改了 `knowledge_graph.json` 的 `id` 却忘了同步前端映射 → 雷达 / 资源页标签错位。
- 没清理持久化向量库 → 检索召回上一门课内容。
- 讲义缺 front matter 许可字段 → 不符合开源合规约定。
- 节点 `id` 在图谱、题库标签、前端映射三处拼写不一致 → 解锁 / 打分静默异常。
