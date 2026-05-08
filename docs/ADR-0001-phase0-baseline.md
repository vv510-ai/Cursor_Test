# ADR-0001: Phase 0 架构基线

## 状态

已接受（2026-05-07）

## 背景

类 ChatGPT 对话系统需先冻结技术前提，再实现 Phase 1 健康检查与流式代理。

## 决策

1. **模型与协议**  
   - 使用 **DeepSeek 官方 OpenAI 兼容** HTTP API（`DEEPSEEK_BASE_URL`，默认 `https://api.deepseek.com/v1`）。  
   - 客户端**不持有** `DEEPSEEK_API_KEY`；仅服务端通过环境变量注入。

2. **首版鉴权**  
   - **无用户登录**（匿名单页即可），与规划「Phase 1 可无 DB」一致。后续在 Phase 3 再引入账户与配额。

3. **工程形态**  
   - **前后端分离**：`server`（Hono + Node）与 `client`（Vite + React + TypeScript）。  
   - 联调通过 `VITE_API_URL` 指向后端；CORS 由服务端 `CORS_ORIGINS` 白名单控制。

4. **环境变量约定**（与仓库 `.env.example` 一致）  
   - `DEEPSEEK_API_KEY`（必填，用于 `/ready` 与 `/api/chat`）  
   - `DEEPSEEK_BASE_URL`（可选）  
   - `PORT`（默认 8787）  
   - `CORS_ORIGINS`（默认含 `http://localhost:5173`）  
   - 前端 `VITE_API_URL`（默认 `http://localhost:8787`）

## 后果

- 部署需同时发布前后端，或生产环境将静态资源置于 CDN 且仍指向同一 API 基地址。  
- 无鉴权时应在网络层或后续 Phase 限制滥用（本阶段仅建议内网或 demo 使用）。
