# chat-deepseek

Phase 0–3：DeepSeek 流式对话、SQLite 持久化、**JWT 注册/登录**、按用户隔离会话、**日配额与限流**、请求 ID 与统一错误体、Markdown 安全渲染。上游 **模型名在代码中固定为 `deepseek-chat`**，通过 `thinking` / `reasoning_effort` 区分对话与推理模式。

## 要求

- Node.js 20+
- 在 **`server/.env`** 中配置 `DEEPSEEK_API_KEY` 与 `JWT_SECRET`（见 [.env.example](.env.example)）

## 本地开发

```bash
cd chat-deepseek
npm install
cp .env.example server/.env
# 编辑 server/.env 填入 DEEPSEEK_API_KEY 与 JWT_SECRET
npm run dev
```

- 前端：<http://localhost:5173>（先 **Register** 或 **Login**）
- 后端：<http://localhost:8787>
- `dotenv` 从 **`server/.env`** 加载（相对 `server/src`，与工作目录无关）。

**升级说明**：Phase 3 数据库 schema 含 `users` 与 `user_id`；首次启动会将 SQLite **升级到版本 3**（旧匿名会话表会被重建，**旧本地会话数据会清空**）。

## 测试

```bash
npm test --workspace server          # 一次性
npm run test:watch --workspace server # watch 模式
```

涵盖 SSE 累加器、scrypt 密码哈希、DeepSeek 上游 payload、配置 fallback。

## 生产部署（Docker，单容器同时托管前后端）

镜像构建过程：

1. 构建 `server/dist`（tsc）与 `client/dist`（vite）
2. 把 `client/dist` 拷贝到 `/app/public`
3. 启动 server，自动通过 `SERVE_STATIC_DIR=/app/public` 托管前端，SPA 路由回退到 `index.html`

只暴露 **8787 一个端口**，前后端同源（不再有 CORS 问题）。

```bash
# 准备根目录 .env（docker-compose 读取）
cat > .env <<'EOF'
JWT_SECRET=please-replace-with-a-long-random-string
DEEPSEEK_API_KEY=sk-xxxxxxxx
CORS_ORIGINS=http://localhost:8787
EOF

docker compose up -d --build
# 访问 http://localhost:8787
docker compose logs -f app
docker compose down            # 停掉，数据保留在 chat_data 卷
```

环境变量参考 [docker-compose.yml](docker-compose.yml)；SQLite 数据持久化到 `chat_data` 卷（`/app/data`）。

### 不用 docker-compose 直接 docker 命令

```bash
docker build -t chat-deepseek .
docker run -d --name chat-deepseek \
  -p 8787:8787 \
  -e JWT_SECRET="..." \
  -e DEEPSEEK_API_KEY="sk-..." \
  -e CORS_ORIGINS="http://localhost:8787" \
  -v chat_data:/app/data \
  chat-deepseek
```

## 公网暴露（用于演示）

本地或内网部署后，可以用 tunneling 工具临时给 demo 一个公网地址：

| 工具 | 命令 | 说明 |
|------|------|------|
| Cloudflare Tunnel（推荐，免费、长期） | `cloudflared tunnel --url http://localhost:8787` | 启动后给一个 `*.trycloudflare.com` 地址 |
| ngrok | `ngrok http 8787` | 免费版地址会变 |
| LocalTunnel | `npx localtunnel --port 8787` | 零依赖快速试用 |

把生成的公网域名加到 `CORS_ORIGINS`（如果你用 docker-compose，把它放进根 `.env`，重启容器）。

## API 摘要

### 公开

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health`、`/api/health` | 健康检查；`config.defaultModel` 为 `deepseek-chat` |
| GET | `/ready` | 探测 DeepSeek（需 `DEEPSEEK_API_KEY`） |
| POST | `/api/auth/register` | `{ "email", "password" }` |
| POST | `/api/auth/login` | `{ "email", "password" }` → `{ token, user }` |

### 需 `Authorization: Bearer <JWT>`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/auth/me` | 当前用户 |
| GET/POST | `/api/conversations` | 列表 / 创建 |
| GET/PATCH/DELETE | `/api/conversations/:id` | 详情 / 更新（支持 `title`、`mode`） / 删除 |
| POST | `/api/conversations/:id/chat` | 流式对话（上游固定 `deepseek-chat` + thinking 参数） |
| POST | `/api/chat` | 直连调试代理（同样需登录；body 可省略 model，服务端固定模型） |

错误响应形如：`{ "error": { "code", "message", "requestId" } }`；响应头含 `X-Request-Id`。前端会把已知 `code` 映射为中文文案（限流、配额、密钥未配置等）。

## 环境变量（服务端）

| 变量 | 说明 |
|------|------|
| `JWT_SECRET` | 必填，签名 JWT |
| `DEEPSEEK_API_KEY` | 必填，仅服务端使用 |
| `DEEPSEEK_BASE_URL` | 可选，默认 `https://api.deepseek.com/v1` |
| `PORT` | 默认 `8787` |
| `SQLITE_PATH` | 默认 `data/chat.sqlite` |
| `CORS_ORIGINS` | 逗号分隔白名单，默认 `http://localhost:5173` |
| `SERVE_STATIC_DIR` | 设置后由后端托管前端 build 产物（生产/Docker 启用） |
| `DAILY_CHAT_LIMIT` | 每用户每日对话次数上限（默认 200） |
| `RATE_LIMIT_CHAT_PER_MIN` | 每用户每分钟聊天请求数（默认 30） |
| `MAX_CONTEXT_CHARS` | 会话上下文字符上限近似值（默认 120000） |
| `JWT_EXPIRES_IN` | JWT 过期秒数，默认 604800（7 天） |

## 文档

- [ADR-0001 Phase 0 基线](docs/ADR-0001-phase0-baseline.md)
