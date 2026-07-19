import http from "http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { URL } from "url";
import { assertConfigured, queryUsage, queryLogs } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 5175;
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

const sendJson = (res, payload) => {
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders,
  });
  res.end(JSON.stringify(payload));
};

// 从 Authorization: Bearer sk-xxx 或 ?key= 参数中取出用户输入的 key。
const extractKey = (req, requestUrl) => {
  const fromQuery = requestUrl.searchParams.get("key");
  if (fromQuery && fromQuery.trim()) return fromQuery;
  const auth = req.headers.authorization || "";
  return auth.replace(/^Bearer\s+/i, "");
};

const handleApi = async (req, res, requestUrl) => {
  const key = extractKey(req, requestUrl);
  if (!key.trim()) {
    sendJson(res, { code: false, success: false, message: "缺少 API Key" });
    return;
  }

  if (requestUrl.pathname === "/api/usage/token") {
    sendJson(res, await queryUsage(key));
    return;
  }
  sendJson(res, await queryLogs(key));
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

  if (requestUrl.pathname === "/api/usage/token" || requestUrl.pathname === "/api/log/token") {
    handleApi(req, res, requestUrl).catch((error) => {
      console.error(`[server] 处理请求失败：${error.message}`);
      sendJson(res, { code: false, success: false, message: "服务内部错误" });
    });
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

try {
  assertConfigured();
} catch (error) {
  console.error(`[server] 启动失败：${error.message}`);
  process.exit(1);
}

server.listen(PORT, () => {
  console.log(`[server] 已启动：http://0.0.0.0:${PORT}`);
});
