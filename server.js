import http from "http";
import https from "https";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { URL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 5175;
const API_HOST = "cloud.yiyongai.cn";
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

const proxyRequest = async (req, res, apiPath, search = "") => {
  const auth = req.headers.authorization || "";
  const apiUrl = `https://${API_HOST}${apiPath}${search}`;

  try {
    let status = 502;
    let contentType = "application/json";
    let body = "";

    if (typeof fetch === "function") {
      const upstream = await fetch(apiUrl, {
        method: "GET",
        headers: {
          Authorization: auth,
        },
      });
      status = upstream.status;
      contentType = upstream.headers.get("content-type") || contentType;
      body = await upstream.text();
    } else {
      const upstream = await requestUpstream(apiUrl, { Authorization: auth });
      status = upstream.status;
      contentType = upstream.headers["content-type"] || contentType;
      body = upstream.body;
    }

    res.writeHead(status, {
      "Content-Type": contentType,
      ...corsHeaders,
    });
    res.end(body);
  } catch (error) {
    res.writeHead(502, {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders,
    });
    res.end(JSON.stringify({ code: false, message: "上游请求失败" }));
  }
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
