# 部署说明

## 套餐查询

页面的「套餐查询」独立于余额查询，输入普通 API Key 后显示其所属账户所有套餐的周用量、剩余量、重置时间和有效期。用量是账户共享套餐口径；点击「查询套餐」手动更新。

Node.js 22.16+ 自动读取项目根目录 `.env`（已有环境变量优先）。参照 `.env.example` 配置 `DATABASE_URL`、`NEW_API_BASE_URL`、`NEW_API_ADMIN_USER_ID` 和 `NEW_API_ADMIN_TOKEN`。站点地址为 HTTPS 根地址，管理员访问令牌不可使用普通模型 Key 代替。第二数据库站点必须单独设置同名 `_2` 配置，以此类推，不会回退到其他站点的管理员凭证。

`GET /api/subscriptions/token` 使用 `Authorization: Bearer sk-...`，先在数据库确定 Key 归属，再请求 `/api/subscription/admin/users/:id/subscriptions` 和套餐名称接口。接口不接受客户端指定用户 ID，只返回套餐展示字段。有效或额度耗尽的 Key 可以查看；停用、过期 Key 及停用账户不能查看。

本地未配置数据库时，套餐查询可独立运行：通过上游 `/api/log/token` 验证 Key，从返回记录确认唯一用户 ID，再查询套餐。此模式的 Key 有效性由上游只读鉴权决定；无记录或归属不一致时拒绝查询，不能查询尚无记录的新 Key。原有余额与记录查询仍需数据库。配置了数据库但连接失败时不会切换到其他站点的 HTTP 接口。

显示金额沿用本站的 500,000 额度 = 1 USD。上游没有周额度字段时显示「未提供」，不从累计用量推算。已到周重置时间的生效套餐按上游固定七天窗口展示；查询不会修改上游额度。

`.env` 已排除 Git 和 Docker 构建上下文。Docker 部署请在服务配置中添加 `env_file: .env` 或显式传入上述环境变量；不要将管理员凭证放入 `VITE_` 变量或前端代码。`npm test` 验证归属限制、周重置、无套餐和错误处理，`npm run build` 构建前端。

## 整体流程

1. 你本地 `git push` 到 `main` 分支。
2. GitHub Actions 自动用 Docker 打包，并把镜像推送到 GHCR（`ghcr.io/openx123/newapi-query`）。
3. 另一台服务器执行一条命令拉取最新镜像并重启容器，即完成更新。

镜像内含构建好的前端（`dist`）和 `server.js` 服务。服务**直连各站点 new-api 的 PostgreSQL 数据库**查询（不再走站点域名的 HTTP 接口，不受限流影响）。用户输入的 key 在哪个站点的库里命中就用哪个站点的数据，按配置顺序自动故障转移。容器监听 `5175` 端口。

---

## 一、数据库配置（环境变量）

在服务器上的 `docker-compose.yml` 的 `environment` 里配置：

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL` | 站点 1 的 PostgreSQL 连接串（**必填**，缺失则容器启动失败） |
| `DATABASE_URL_2`、`DATABASE_URL_3`… | 更多站点，编号需连续，断号即停止扫描；顺序即故障转移顺序 |
| `LOG_LIMIT` | 明细记录返回条数，默认 `1000`，范围 1～10000 |

连接串格式：

```
postgresql://用户名:密码@主机:5432/newapi?sslmode=disable
```

> **安全提醒**
> - 真实连接串只写在服务器上的 compose 文件里，**不要提交到 git 仓库**。
> - 建议为查询服务单独建一个 PG 账号，只授予 `tokens`、`logs`、`users` 三张表的 `SELECT` 权限。

---

## 二、首次准备（只做一次）

### 1. 推代码，触发首次构建

```bash
git add .
git commit -m "docker 自动部署"
git push origin main
```

推送后到 GitHub 仓库的 **Actions** 标签页确认 `Build and Push Docker Image` 跑成功。
成功后镜像出现在仓库右侧 **Packages**。

### 2. 让镜像可被服务器拉取

GHCR 镜像默认是 **私有** 的，两种方式二选一：

**方式 A（推荐，最省事）：把镜像设为公开**
仓库 → 右侧 **Packages** → 点进 `newapi-query` → **Package settings** → **Change visibility** → 设为 **Public**。
之后服务器无需登录即可 `docker pull`。

**方式 B：保持私有，服务器登录后再拉**
在 GitHub 生成一个有 `read:packages` 权限的 PAT（Settings → Developer settings → Personal access tokens），然后在服务器上：

```bash
echo "你的PAT" | docker login ghcr.io -u OpenX123 --password-stdin
```

---

## 三、目标服务器上部署

把仓库里的 `docker-compose.yml` 拷到服务器任意目录（例如 `/opt/newapi-query/`），**把 `environment` 里的 `DATABASE_URL` 换成真实连接串**，然后：

```bash
cd /opt/newapi-query
docker compose up -d
```

访问 `http://服务器IP:5175` 即可。若用 `query.yiyongai.cn` 域名，让你的 Nginx/反代指向 `127.0.0.1:5175`。

启动后可用 `docker logs newapi-query` 确认没有报"未配置数据库连接"。

---

## 四、以后每次更新

本地推送代码后，等 Actions 构建完成（约 1～2 分钟），到服务器执行：

```bash
cd /opt/newapi-query
docker compose pull && docker compose up -d
```

`pull` 拉最新 `latest` 镜像，`up -d` 用新镜像重建容器。旧镜像可定期 `docker image prune -f` 清理。

> 想完全免手动？可在服务器加一个 [Watchtower](https://containrrr.dev/watchtower/) 容器自动检测并更新，但需要它能拉到镜像（公开镜像或已 `docker login`）。

---

## 修改站点 / 端口

- 增删站点：改服务器上 compose 文件的 `DATABASE_URL*` 环境变量，`docker compose up -d` 重建即可生效，**无需重新打包镜像**。
- 端口在 `docker-compose.yml` 的 `ports` 改宿主机侧（如 `"8080:5175"`）。
- 本地开发：`DATABASE_URL=... pnpm dev`（dev 服务器同样直查数据库）。
