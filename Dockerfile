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

# ---- 运行阶段：跑 server.js，需要 pg 依赖直连数据库 ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable

# 只装生产依赖（pg 等），前端依赖都在 devDependencies 不会进镜像
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/dist ./dist
COPY server.js db.js ./

EXPOSE 5175
CMD ["node", "server.js"]
