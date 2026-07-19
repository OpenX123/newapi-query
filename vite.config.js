import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { queryUsage, queryLogs } from "./db.js";

const API_PATHS = ["/api/usage/token", "/api/log/token"];

// dev / preview 模式直接复用 db.js 查库，行为与 server.js 一致。
// 本地开发需要先设置 DATABASE_URL（可选 DATABASE_URL_2…）。
const handleApi = async (req, res) => {
  const requestUrl = new URL(req.url, "http://localhost");
  const fromQuery = requestUrl.searchParams.get("key");
  const auth = req.headers.authorization || "";
  const key = fromQuery && fromQuery.trim() ? fromQuery : auth.replace(/^Bearer\s+/i, "");

  let payload;
  if (!key.trim()) {
    payload = { code: false, success: false, message: "缺少 API Key" };
  } else if (requestUrl.pathname === "/api/usage/token") {
    payload = await queryUsage(key);
  } else {
    payload = await queryLogs(key);
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
};

const dbApiPlugin = () => {
  const middleware = (req, res, next) => {
    const pathname = (req.url || "").split("?")[0];
    if (!API_PATHS.includes(pathname)) return next();
    handleApi(req, res).catch((error) => {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ code: false, success: false, message: `查询失败：${error.message}` }));
    });
  };

  return {
    name: "db-api",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
};

export default defineConfig({
  plugins: [vue(), dbApiPlugin()],
  server: {
    host: "0.0.0.0",
    port: 5175,
    allowedHosts: ["query.yiyongai.cn"],
  },
});
