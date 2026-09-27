import assert from "node:assert/strict";
import pg from "pg";
import { querySubscriptions } from "./db.js";
import { fetchUserSubscriptions, resolveSubscriptionUser } from "./subscriptions.js";

process.env.DATABASE_URL = "postgresql://localhost/test";
process.env.NEW_API_BASE_URL = "https://new-api.invalid";
process.env.NEW_API_ADMIN_USER_ID = "1";
process.env.NEW_API_ADMIN_TOKEN = "test-admin-token";
// 测试不继承部署环境里的第二站点配置。
delete process.env.NEW_API_BASE_URL_2;
delete process.env.NEW_API_ADMIN_USER_ID_2;
delete process.env.NEW_API_ADMIN_TOKEN_2;
const now = Math.floor(Date.now() / 1000);
const sub = { id: 19, user_id: 42, plan_id: 7, status: "active", start_time: now - 100,
  end_time: now + 2000000, amount_total: 25000000, amount_used: 640000,
  weekly_amount: 600000000, weekly_used: 37445000, weekly_reset_time: now + 604700 };
let records = [{ subscription: sub }];
let token = { user_id: 42, status: 1, user_status: 1, expired_time: -1 };
let calls = [];
const originalFetch = globalThis.fetch;
const originalQuery = pg.Pool.prototype.query;
pg.Pool.prototype.query = async (_sql, values) => {
  assert.equal(values[0], "test-user-key");
  return { rows: token ? [token] : [] };
};
globalThis.fetch = async (url, options) => {
  calls.push(String(url));
  assert.equal(options.headers.Authorization, "Bearer test-admin-token");
  assert.equal(options.headers["New-Api-User"], "1");
  assert.equal(options.redirect, "error");
  assert.ok(!String(url).includes("test-user-key"));
  const plans = String(url).endsWith("/plans");
  assert.ok(plans || String(url).endsWith("/users/42/subscriptions"));
  return { ok: true, json: async () => ({ success: true, data: plans ? [{ plan: { id: 7, title: "2人拼车" } }] : records }) };
};
try {
  const result = await querySubscriptions("sk-test-user-key");
  assert.equal(result.success, true);
  assert.equal(result.data[0].title, "2人拼车");
  assert.equal(result.data[0].weekly_remaining, 562555000);
  assert.equal(result.data[0].weekly_used, 37445000);
  assert.ok(!JSON.stringify(result).includes("test-admin-token"));
  assert.equal(result.data[0].user_id, undefined);

  records = [{ subscription: { ...sub, weekly_reset_time: now - 604800 } }];
  const reset = (await fetchUserSubscriptions(42))[0];
  assert.equal(reset.weekly_used, 0);
  assert.ok(reset.weekly_reset_time > now);
  records = [{ subscription: { ...sub, status: "expired", weekly_reset_time: now - 604800 } }];
  assert.equal((await fetchUserSubscriptions(42))[0].weekly_used, sub.weekly_used);
  records = [{ subscription: { ...sub, weekly_amount: undefined, weekly_used: undefined, weekly_reset_time: undefined } }];
  assert.equal((await fetchUserSubscriptions(42))[0].weekly_amount, null);
  records = [{ subscription: { ...sub, user_id: 43 } }];
  await assert.rejects(fetchUserSubscriptions(42), /归属/);
  records = [];
  assert.deepEqual(await fetchUserSubscriptions(42), []);
  for (const invalid of [null, { ...token, status: 2 }, { ...token, status: 3 }, { ...token, user_status: 2 }, { ...token, expired_time: now - 1 }]) {
    const saved = token;
    token = invalid;
    calls = [];
    assert.equal((await querySubscriptions("sk-test-user-key")).success, false);
    assert.equal(calls.length, 0);
    token = saved;
  }
  token.status = 4;
  assert.equal((await querySubscriptions("sk-test-user-key")).success, true);
  await assert.rejects(fetchUserSubscriptions(42, 1), /尚未配置/);
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: false, message: "test-admin-token" }) });
  const rejected = await querySubscriptions("sk-test-user-key");
  assert.equal(rejected.success, false);
  assert.ok(!rejected.message.includes("test-admin-token"));
  globalThis.fetch = async () => { throw new Error("private connection details"); };
  await assert.rejects(fetchUserSubscriptions(42), /连接失败或超时/);
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers.Authorization, "Bearer sk-test-user-key");
    return { ok: true, json: async () => ({ success: true, data: [{ user_id: 42 }, { user_id: 42 }] }) };
  };
  assert.equal(await resolveSubscriptionUser("sk-test-user-key"), 42);
  for (const rows of [[], [{ user_id: 42 }, { user_id: 43 }], [{ user_id: null }]]) {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: true, data: rows }) });
    await assert.rejects(resolveSubscriptionUser("sk-test-user-key"), /归属/);
  }
  console.log("subscription checks passed");
} finally {
  globalThis.fetch = originalFetch;
  pg.Pool.prototype.query = originalQuery;
}
