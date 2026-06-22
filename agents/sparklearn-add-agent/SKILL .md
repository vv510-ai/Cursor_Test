---
name: sparklearn-add-agent
description: 给 SparkLearn 多智能体系统新增一个智能体 / 编排节点时使用——在 agents/ 写 run(state) 节点、在 graph.py 注册节点与边、按需登记并行生成节点与资源 kind、并同步前端事件类型与资源卡片。只要任务涉及「加一个 agent / 智能体 / 节点、加一种新的资源生成器、扩展编排图、新增一类生成内容(如口述复述检查、新可视化)」,就使用本 skill,即使用户没说「智能体」也要触发。仅用于新增节点;修改已有 agent 的内部逻辑不需要本 skill。
---

# 新增智能体(SparkLearn Add Agent)

往 LangGraph 编排图里加一个新节点。分两类,步骤略有差别:

- **A 类 · 普通智能体**:像 `tutor` / `eval`,不直接产出「资源卡片」。
- **B 类 · 并行生成智能体**:像 `doc` / `mindmap` / `quiz` / `media`,与其它生成节点并发执行并产出一种资源 `kind`。

判断:如果它会被编排器在「generate」路由下与其它四件套并发执行、并往前端落一张资源卡片,就是 **B 类**,需多做「登记 `_GEN_NODES` / `_KIND2NODE` + 前端资源卡片」两步。

## 开始前

先读 `docs/代码结构说明.md` 的「扩展指南」与现有同类 agent(B 类参照 `backend/app/agents/doc_agent.py`,A 类参照 `tutor_agent.py`),沿用其结构与命名,不要另起一套。落笔前确认真实文件名。

## 步骤

### 1. 写 agent
新建 `backend/app/agents/<name>_agent.py`,实现:

```python
async def run(state) -> dict:
    ...
```

- 入口 / 出口用 `emitter.emit()` 发 `agent_start` / `agent_end`(B 类还需发 `resource` 事件)。
- **不要自建 LLM 客户端**,模型调用一律走 `llm_complete()` / `llm_stream()`(`backend/app/llm/spark_client.py`)。
- 返回的 dict 会按 reducer 合并进全局 State。

### 2. 声明 State 字段(若有新字段)
如果该节点写入新的 State 字段,在 `backend/app/agents/state.py` 增加字段;**凡是可能被并行节点写入的字段必须带 reducer 注解**,否则并行执行时会互相覆盖。

### 3. 在编排图注册
编辑 `backend/app/agents/graph.py`:注册新节点及其入边 / 出边。

- **B 类额外两步**:把节点加入 `_GEN_NODES`(使其进入并发生成集合),并在 `_KIND2NODE` 里把它产出的资源 `kind` 映射到该节点。

### 4. 同步前端事件类型(若有新事件)
若引入了新的事件 `type`,更新:

- `frontend/lib/types.ts`(事件类型定义)
- `frontend/components/agent/AgentTrace.tsx`(事件归约逻辑)

否则 AgentTrace 遥测面板不会显示该节点。

### 5. 同步前端资源卡片(仅 B 类新增 kind)
若新增了资源 `kind`,在 `frontend/components/resource/ResourceCard.tsx` 的 `KIND_META` 加一项,并补对应渲染分支,否则新卡片无法正确渲染。

### 6. 加测试
在 `backend/tests/` 加单元测试,用 `_stubs.py` 保证离线可跑。

## 校验(必须全过)

1. `cd backend && pytest` 通过。
2. `cd frontend && npm run build` 通过。
3. 端到端:发起一次 `POST /api/resources/generate`(或触发该 agent 的对应接口),确认
   - AgentTrace 面板点亮新节点的 `agent_start` / `agent_end`;
   - B 类:新资源卡片正确渲染、引用溯源正常。

## 常见坑

- 自建 LLM 客户端 → 绕过互备 / Mock / 计量,demo 模式下直接报错或漏计量。
- 漏 reducer 注解 → 并行写入静默互相覆盖。
- 新事件类型只改了后端、没同步 `types.ts` + AgentTrace → 遥测看不到。
- B 类只加了节点、没进 `_GEN_NODES` 或没在 `_KIND2NODE` 映射 → 不会被并发调度或资源无法落卡。
