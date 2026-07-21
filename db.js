import pg from "pg";

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

// 启动时调用：未配置任何 DATABASE_URL 时抛错，让进程尽早失败并给出提示。
export const assertConfigured = () => {
  if (getSites().length === 0) {
    throw new Error(
      "未配置数据库连接：请设置环境变量 DATABASE_URL（更多站点用 DATABASE_URL_2、DATABASE_URL_3…）"
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
        `SELECT id, user_id, name, remain_quota, used_quota, unlimited_quota
           FROM tokens
          WHERE key = $1 AND deleted_at IS NULL
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
    try {
      const result = await site.pool.query(
        "SELECT quota FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1",
        [token.user_id]
      );
      if (result.rows.length > 0) totalAvailable = Number(result.rows[0].quota);
    } catch (error) {
      console.error(`[db] ${site.label} 查询用户余额失败：${error.message}`);
      return { code: false, message: "查询余额失败，请稍后重试" };
    }
  }

  return {
    code: true,
    data: {
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

// /api/log/token：返回与 new-api 兼容的 { success, data: [...] }。
// 用 user_id + token_name 关联（老版本日志无 token_id），只取消费记录（type = 2）。
export const queryLogs = async (rawKey) => {
  const found = await findTokenSite(normalizeKey(rawKey));
  if (!found.site) {
    return { success: false, message: found.errorMessage };
  }

  const { site, token } = found;
  try {
    const result = await site.pool.query(
      `SELECT id, created_at, model_name, quota, prompt_tokens, completion_tokens, use_time, is_stream, other
         FROM logs
        WHERE user_id = $1 AND token_name = $2 AND type = 2
        ORDER BY created_at DESC
        LIMIT $3`,
      [token.user_id, token.name, getLogLimit()]
    );
    return {
      success: true,
      data: result.rows.map((row) => {
        const promptTokens = Number(row.prompt_tokens) || 0;
        const completionTokens = Number(row.completion_tokens) || 0;
        const cache = parseCacheTokens(row.other);
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
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          use_time: Number(row.use_time),
          is_stream: row.is_stream,
        };
      }),
    };
  } catch (error) {
    console.error(`[db] ${site.label} 查询日志失败：${error.message}`);
    return { success: false, message: "查询使用记录失败，请稍后重试" };
  }
};
