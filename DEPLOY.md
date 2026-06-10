# 部署说明

## 整体流程

1. 你本地 `git push` 到 `main` 分支。
2. GitHub Actions 自动用 Docker 打包，并把镜像推送到 GHCR（`ghcr.io/openx123/newapi-query`）。
3. 另一台服务器执行一条命令拉取最新镜像并重启容器，即完成更新。

镜像内含构建好的前端（`dist`）和 `server.js` 代理。代理已硬编码两个站点 `cloud.yiyongai.cn` 和 `serve.yiyongai.cn`，用户输入的 key 在哪个站点有效就自动用哪个，一个失败自动查另一个。容器监听 `5175` 端口。

---

## 一、首次准备（只做一次）

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

## 二、目标服务器上部署

把仓库里的 `docker-compose.yml` 拷到服务器任意目录（例如 `/opt/newapi-query/`），然后：

```bash
cd /opt/newapi-query
docker compose up -d
```

访问 `http://服务器IP:5175` 即可。若用 `query.yiyongai.cn` 域名，让你的 Nginx/反代指向 `127.0.0.1:5175`。

---

## 三、以后每次更新

本地推送代码后，等 Actions 构建完成（约 1～2 分钟），到服务器执行：

```bash
cd /opt/newapi-query
docker compose pull && docker compose up -d
```

`pull` 拉最新 `latest` 镜像，`up -d` 用新镜像重建容器。旧镜像可定期 `docker image prune -f` 清理。

> 想完全免手动？可在服务器加一个 [Watchtower](https://containrrr.dev/watchtower/) 容器自动检测并更新，但需要它能拉到镜像（公开镜像或已 `docker login`）。

---

## 修改站点 / 端口

- 站点地址写在 `server.js` 的 `API_HOSTS` 和 `vite.config.js` 的 `API_HOSTS`，改完推送即重新打包。
- 端口在 `docker-compose.yml` 的 `ports` 改宿主机侧（如 `"8080:5175"`）。
