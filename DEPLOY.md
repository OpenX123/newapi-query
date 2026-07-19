# 部署说明

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
