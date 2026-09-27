import pg from "pg";
import { fetchUserSubscriptions, resolveSubscriptionUser } from "./subscriptions.js";

try {
  process.loadEnvFile();
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const { Pool } = pg;

// 明细记录默认返回条数，可用 LOG_LIMIT 环境变量覆盖。
const DEFAULT_LOG_LIMIT = 1000;

// 站点列表：DATABASE_URL（或 DATABASE_URL_1）为站点 1，DATABASE_URL_2、DATABASE_URL_3…
// 为更多站点。编号必须连续，断号即停止扫描。数组顺序即故障转移顺序。
let sites = null;

const maskUrl = (url) => {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || 5432}${parsed.pathname}`;
  } catch {
    return "(无法解析的连接串)";
  }
};

const loadSites = () => {
  const urls = [];
  const first = process.env.DATABASE_URL || process.env.DATABASE_URL_1;
  if (first) urls.push(first);
  for (let i = 2; ; i += 1) {
    const url = process.env[`DATABASE_URL_${i}`];
    if (!url) break;
    urls.push(url);
  }
  return urls.map((url, index) => ({
    index,
    label: `站点${index + 1}(${maskUrl(url)})`,
    pool: new Pool({
      connectionString: url,
      max: 3,
      connectionTimeoutMillis: 4000,
      idleTimeoutMillis: 30000,
      query_timeout: 5000,
    }),
  }));
};

const getSites = () => {
  if (sites === null) sites = loadSites();
  return sites;
};

// 支持数据库查询，或只配置管理接口的独立套餐查询。
export const assertConfigured = () => {
  if (getSites().length === 0 && !(process.env.NEW_API_BASE_URL && process.env.NEW_API_ADMIN_TOKEN && process.env.NEW_API_ADMIN_USER_ID)) {
    throw new Error(
      "请配置 DATABASE_URL，或配置套餐查询的 NEW_API_BASE_URL、NEW_API_ADMIN_TOKEN、NEW_API_ADMIN_USER_ID"
    );
  }
};

export const getLogLimit = () => {
  const parsed = Number.parseInt(process.env.LOG_LIMIT || "", 10);
  if (Number.isNaN(parsed)) return DEFAULT_LOG_LIMIT;
  return Math.min(Math.max(parsed, 1), 10000);
};

// 库里存的 key 不带 sk- 前缀。
const normalizeKey = (rawKey) => rawKey.trim().replace(/^sk-/, "");

// cache_tokens 已包含在 prompt_tokens 中；只有缓存写是额外的实际处理量。
const cacheCreationTokensSql = `COALESCE(
  substring(
    COALESCE(other, '')
    FROM '"cache_creation_tokens"[[:space:]]*:[[:space:]]*([0-9]+)'
  )::numeric,
  0
)`;
const tokenTotalSql = `
  COALESCE(prompt_tokens, 0)::numeric
  + COALESCE(completion_tokens, 0)::numeric
  + ${cacheCreationTokensSql}
`;

// 按顺序在各站点查找 key 对应的令牌。
// 返回 { site, token } 或 { errorMessage }。
const findTokenSite = async (key) => {
  const siteList = getSites();
  if (siteList.length === 0) {
    return { errorMessage: "服务未配置数据库连接" };
  }

  let reachable = 0;
  for (const site of siteList) {
    try {
      const result = await site.pool.query(
        `SELECT t.id, t.user_id, t.status, t.expired_time, t.remain_quota, t.used_quota, t.unlimited_quota,
                u.quota AS user_quota, u.status AS user_status
           FROM tokens t
      LEFT JOIN users u ON u.id = t.user_id AND u.deleted_at IS NULL
          WHERE t.key = $1 AND t.deleted_at IS NULL
          LIMIT 1`,
        [key]
      );
      reachable += 1;
      if (result.rows.length > 0) {
        return { site, token: result.rows[0] };
      }
    } catch (error) {
      console.error(`[db] ${site.label} 查询失败：${error.message}`);
    }
  }

  return {
    errorMessage: reachable > 0 ? "无效的令牌" : "所有站点数据库连接失败，请稍后重试",
  };
};

// 用户只能凭自己的有效 Key 查询归属账户，不接受前端传来的用户 ID。
export const querySubscriptions = async (rawKey) => {
  if (!rawKey.trim() || rawKey.length > 256) {
    return { success: false, message: "无效的 API Key" };
  }
  if (getSites().length === 0) {
    try {
      const userId = await resolveSubscriptionUser(rawKey);
      return { success: true, data: await fetchUserSubscriptions(userId) };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }
  const found = await findTokenSite(normalizeKey(rawKey));
  if (!found.site) return { success: false, message: found.errorMessage };
  const { token, site } = found;
  if (Number(token.user_status) !== 1 || ![1, 4].includes(Number(token.status))
    || (Number(token.expired_time) !== -1 && Number(token.expired_time) <= Date.now() / 1000)) {
    return { success: false, message: "Key 或所属账户已停用、过期" };
  }
  try {
    return { success: true, data: await fetchUserSubscriptions(token.user_id, site.index) };
  } catch (error) {
    return { success: false, message: error.message };
  }
};

// /api/usage/token：返回与 new-api 兼容的 { code, data: { total_used, total_available } }。
export const queryUsage = async (rawKey) => {
  const found = await findTokenSite(normalizeKey(rawKey));
  if (!found.site) {
    return { code: false, message: found.errorMessage };
  }

  const { site, token } = found;
  let totalAvailable = Number(token.remain_quota);
  if (token.unlimited_quota) {
    // 不限额度的令牌：余额取属主账户的余额。
    if (token.user_quota === null) {
      return { code: false, message: "未找到令牌归属用户" };
    }
    totalAvailable = Number(token.user_quota);
  }

  let stats;
  try {
    const result = await site.pool.query(
      `SELECT
         COALESCE((
           SELECT SUM(${tokenTotalSql})
             FROM logs
            WHERE token_id = $1 AND type = 2
         ), 0)
         + COALESCE((
           SELECT total_tokens
             FROM log_archive_token_totals
            WHERE token_id = $1
         ), 0) AS total_tokens`,
      [token.id]
    );
    stats = result.rows[0];
  } catch (error) {
    console.error(`[db] ${site.label} 查询累计 Token 失败：${error.message}`);
    return { code: false, message: "查询累计 Token 失败，请稍后重试" };
  }

  return {
    code: true,
    data: {
      total_tokens: Number(stats.total_tokens),
      total_used: Number(token.used_quota),
      total_available: totalAvailable,
    },
  };
};

// 从 logs.other（JSON 文本）里解析缓存 token。
// cache_tokens = 缓存读（已包含在 prompt_tokens 内），cache_creation_tokens = 缓存写（额外单列）。
const parseCacheTokens = (other) => {
  if (!other) return { read: 0, creation: 0 };
  try {
    const parsed = JSON.parse(other);
    return {
      read: Number(parsed.cache_tokens) || 0,
      creation: Number(parsed.cache_creation_tokens) || 0,
    };
  } catch {
    return { read: 0, creation: 0 };
  }
};

export const toLogEntry = (row) => {
  const promptTokens = Number(row.prompt_tokens) || 0;
  const completionTokens = Number(row.completion_tokens) || 0;
  const cache = parseCacheTokens(row.other);
  const totalTokens = Number(row.total_tokens);
  return {
    id: Number(row.id),
    created_at: Number(row.created_at),
    model_name: row.model_name,
    quota: Number(row.quota),
    // 输入为纯新输入（prompt_tokens 已含缓存读，需扣除）
    input_tokens: Math.max(0, promptTokens - cache.read),
    output_tokens: completionTokens,
    // 缓存 = 缓存读 + 缓存写
    cache_tokens: cache.read + cache.creation,
    cache_read_tokens: cache.read,
    cache_creation_tokens: cache.creation,
    total_tokens: Number.isFinite(totalTokens)
      ? totalTokens
      : promptTokens + completionTokens + cache.creation,
    use_time: Number(row.use_time),
    is_stream: row.is_stream,
  };
};

// /api/log/token：返回与 new-api 兼容的 { success, data: [...] }。
// 按 token_id 关联，避免同一用户的同名或改名令牌串入历史记录。
export const queryLogs = async (rawKey) => {
  const found = await findTokenSite(normalizeKey(rawKey));
  if (!found.site) {
    return { success: false, message: found.errorMessage };
  }

  const { site, token } = found;
  try {
    const result = await site.pool.query(
      `SELECT id, created_at, model_name, quota, prompt_tokens, completion_tokens, use_time, is_stream, other,
              (${tokenTotalSql}) AS total_tokens
         FROM logs
        WHERE token_id = $1 AND type = 2
        ORDER BY total_tokens DESC, created_at DESC
        LIMIT $2`,
      [token.id, getLogLimit()]
    );
    return {
      success: true,
      data: result.rows.map(toLogEntry),
    };
  } catch (error) {
    console.error(`[db] ${site.label} 查询日志失败：${error.message}`);
    return { success: false, message: "查询使用记录失败，请稍后重试" };
  }
};
