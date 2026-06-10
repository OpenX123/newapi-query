import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import https from "https";

// 两个站点的 key 不互通：用户输入的 key 只属于其中一个站点。
// 按顺序尝试，第一个失败（key 无效 / 报错）就自动查下一个。
const API_HOSTS = ["cloud.yiyongai.cn", "serve.yiyongai.cn"];
const API_PATHS = ["/api/usage/token", "/api/log/token"];

const isSuccessfulPayload = (status, body) => {
  if (status < 200 || status >= 300) return false;
  try {
    const json = JSON.parse(body);
    return Boolean(json) && (json.code === true || json.success === true);
  } catch {
    return false;
  }
};

const fetchUpstream = (apiUrl, auth) =>
  new Promise((resolve, reject) => {
    const request = https.request(
      apiUrl,
      { method: "GET", headers: { Authorization: auth } },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode || 502,
            contentType: response.headers["content-type"] || "application/json",
            body,
          })
        );
      }
    );
    request.on("error", reject);
    request.end();
  });

const handleApi = async (req, res) => {
  const requestUrl = new URL(req.url, "http://localhost");
  const auth = req.headers.authorization || "";

  let firstResult = null;
  for (const host of API_HOSTS) {
    const apiUrl = `https://${host}${requestUrl.pathname}${requestUrl.search}`;
    try {
      const result = await fetchUpstream(apiUrl, auth);
      if (!firstResult) firstResult = result;
      if (isSuccessfulPayload(result.status, result.body)) {
        res.statusCode = result.status;
        res.setHeader("Content-Type", result.contentType);
        res.end(result.body);
        return;
      }
    } catch (error) {
      // 当前站点请求异常，继续尝试下一个站点。
    }
  }

  if (firstResult) {
    res.statusCode = firstResult.status;
    res.setHeader("Content-Type", firstResult.contentType);
    res.end(firstResult.body);
    return;
  }

  res.statusCode = 502;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ code: false, message: "上游请求失败" }));
};

// dev / preview 两种模式都挂上同样的故障转移中间件，行为与 server.js 一致。
const failoverApiPlugin = () => {
  const middleware = (req, res, next) => {
    const pathname = (req.url || "").split("?")[0];
    if (!API_PATHS.includes(pathname)) return next();
    handleApi(req, res).catch(() => {
      res.statusCode = 502;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ code: false, message: "上游请求失败" }));
    });
  };

  return {
    name: "failover-api-proxy",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
};

export default defineConfig({
  plugins: [vue(), failoverApiPlugin()],
  server: {
    host: "0.0.0.0",
    port: 5175,
    allowedHosts: ["query.yiyongai.cn"],
  },
});
