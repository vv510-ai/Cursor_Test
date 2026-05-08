# syntax=docker/dockerfile:1.7

# ----- Stage 1: build server + client -----
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Install build deps for better-sqlite3 (native module)
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Workspace install (npm workspaces)
COPY package.json package-lock.json* ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm install --include=dev

# Copy sources and build
COPY server/tsconfig.json server/tsconfig.json
COPY server/vitest.config.ts server/vitest.config.ts
COPY server/src server/src
COPY client/tsconfig.json client/tsconfig.json
COPY client/tsconfig.app.json client/tsconfig.app.json
COPY client/tsconfig.node.json client/tsconfig.node.json
COPY client/vite.config.ts client/vite.config.ts
COPY client/index.html client/index.html
COPY client/public client/public
COPY client/src client/src

# Build server (tsc → dist) and client (vite → dist)
RUN npm run build --workspace server \
 && npm run build --workspace client


# ----- Stage 2: production runtime -----
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8787 \
    SQLITE_PATH=/app/data/chat.sqlite \
    SERVE_STATIC_DIR=/app/public

# Runtime libs for better-sqlite3
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd -r -u 10001 -g root appuser

# Install production-only deps for the server (rebuilds native modules)
COPY package.json package-lock.json* ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && npm install --omit=dev --workspace server \
 && apt-get purge -y python3 make g++ \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

# Copy compiled server and built client
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/client/dist ./public

# Persistent data dir (mount a volume here for SQLite to survive restarts)
RUN mkdir -p /app/data && chown -R appuser:root /app/data /app
USER appuser

EXPOSE 8787

# Health check hits the public health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||8787) +'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
