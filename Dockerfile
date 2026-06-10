# syntax=docker/dockerfile:1

# ---- 构建阶段：用 Node + pnpm 打包前端 ----
FROM node:22-alpine AS builder
WORKDIR /app

# 启用 corepack，按 package.json 里的 packageManager 字段使用对应 pnpm 版本
RUN corepack enable

# 先只拷依赖清单，命中缓存，依赖没变就不重装
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# 再拷源码并构建，产物在 /app/dist
COPY . .
RUN pnpm build

# ---- 运行阶段：只跑 server.js，体积小 ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# server.js 仅用 Node 内置模块，不需要 node_modules
COPY --from=builder /app/dist ./dist
COPY server.js ./

EXPOSE 5175
CMD ["node", "server.js"]
