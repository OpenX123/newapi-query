import http from "http";
import https from "https";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { URL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 5175;
// 两个站点的 key 不互通：用户输入的 key 只属于其中一个站点。
// 按顺序尝试，第一个失败（key 无效 / 报错）就自动查下一个。
const API_HOSTS = ["cloud.yiyongai.cn", "serve.yiyongai.cn"];
const DIST_DIR = path.join(__dirname, "dist");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

const serveFile = (filePath, res) => {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType, ...corsHeaders });
    res.end(data);
  });
};

const requestUpstream = (url, headers) =>
  new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "GET",
        headers,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode || 502,
            headers: response.headers || {},
            body,
          });
        });
      }
    );

    request.on("error", reject);
    request.end();
  });

const fetchUpstream = async (apiUrl, auth) => {
  if (typeof fetch === "function") {
    const upstream = await fetch(apiUrl, {
      method: "GET",
      headers: { Authorization: auth },
    });
    return {
      status: upstream.status,
      contentType: upstream.headers.get("content-type") || "application/json",
      body: await upstream.text(),
    };
  }
  const upstream = await requestUpstream(apiUrl, { Authorization: auth });
  return {
    status: upstream.status,
    contentType: upstream.headers["content-type"] || "application/json",
    body: upstream.body,
  };
};

// 上游成功的判定：HTTP 2xx 且业务字段为成功。
// /api/usage/token 成功为 code===true，/api/log/token 成功为 success===true。
const isSuccessfulPayload = (status, body) => {
  if (status < 200 || status >= 300) return false;
  try {
    const json = JSON.parse(body);
    return Boolean(json) && (json.code === true || json.success === true);
  } catch {
    return false;
  }
};

const proxyRequest = async (req, res, apiPath, search = "") => {
  const auth = req.headers.authorization || "";

  let firstResult = null;
  for (const host of API_HOSTS) {
    const apiUrl = `https://${host}${apiPath}${search}`;
    try {
      const result = await fetchUpstream(apiUrl, auth);
      if (!firstResult) firstResult = result;
      if (isSuccessfulPayload(result.status, result.body)) {
        res.writeHead(result.status, {
          "Content-Type": result.contentType,
          ...corsHeaders,
        });
        res.end(result.body);
        return;
      }
    } catch (error) {
      // 当前站点请求异常，继续尝试下一个站点。
    }
  }

  // 所有站点都没有返回成功结果：回传第一个站点的原始响应（含真实错误信息）。
  if (firstResult) {
    res.writeHead(firstResult.status, {
      "Content-Type": firstResult.contentType,
      ...corsHeaders,
    });
    res.end(firstResult.body);
    return;
  }

  res.writeHead(502, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders,
  });
  res.end(JSON.stringify({ code: false, message: "上游请求失败" }));
};

const serveIndex = (res) => {
  const indexPath = path.join(DIST_DIR, "index.html");
  serveFile(indexPath, res);
};

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  if (requestUrl.pathname === "/api/usage/token") {
    proxyRequest(req, res, "/api/usage/token", requestUrl.search);
    return;
  }

  if (requestUrl.pathname === "/api/log/token") {
    proxyRequest(req, res, "/api/log/token", requestUrl.search);
    return;
  }

  if (requestUrl.pathname === "/" || requestUrl.pathname === "/index.html") {
    serveIndex(res);
    return;
  }

  const filePath = path.join(DIST_DIR, requestUrl.pathname);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    serveFile(filePath, res);
    return;
  }

  serveIndex(res);
});

server.listen(PORT);
