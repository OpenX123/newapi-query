import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toLogEntry } from "./db.js";

const entry = toLogEntry({
  id: 1,
  created_at: 1,
  model_name: "test",
  quota: 0,
  prompt_tokens: 100,
  completion_tokens: 20,
  other: JSON.stringify({ cache_tokens: 30, cache_creation_tokens: 5 }),
  total_tokens: 125,
});

assert.equal(entry.input_tokens + entry.output_tokens + entry.cache_tokens, entry.total_tokens);
assert.equal(entry.total_tokens, 125);

const claude = toLogEntry({
  id: 2, created_at: 2, model_name: "claude-test", quota: 4651400,
  prompt_tokens: 0, completion_tokens: 8327,
  other: JSON.stringify({ claude: true, cache_tokens: 954150, cache_creation_tokens: 0 }),
});
assert.equal(claude.total_tokens, 962477);
assert.equal(claude.input_tokens + claude.output_tokens + claude.cache_tokens, claude.total_tokens);

const subscription = toLogEntry({
  id: 3, created_at: 3, model_name: "claude-test", quota: 4651400,
  prompt_tokens: 2, completion_tokens: 228,
  other: JSON.stringify({ billing_source: "subscription", wallet_quota_deducted: 0 }),
});
assert.equal(subscription.billing_source, "subscription");
assert.equal(subscription.wallet_quota_deducted, 0);
assert.equal(subscription.actual_wallet_quota, 0);
const wallet = toLogEntry({ id: 4, quota: 16326, prompt_tokens: 2, completion_tokens: 228,
  other: JSON.stringify({ billing_source: "wallet" }) });
assert.equal(wallet.actual_wallet_quota, 16326);
const unknown = toLogEntry({ id: 5, quota: 4651400, prompt_tokens: 2, completion_tokens: 228, other: "{}" });
assert.equal(unknown.actual_wallet_quota, null);

const source = readFileSync(new URL("./db.js", import.meta.url), "utf8");
assert.match(source, /FROM log_archive_token_totals/);
assert.match(source, /FROM logs[\s\S]*WHERE token_id = \$1 AND type = 2/);
assert.match(source, /ORDER BY created_at DESC, id DESC/);
assert.match(source, /CASE WHEN \$\{isClaudeSql\} THEN \$\{cacheReadTokensSql\}/);
assert.match(source, /SUM\(CASE WHEN \$\{walletLogSql\} THEN quota ELSE 0 END\)/);
assert.match(source, /unknown_billing_count/);

console.log("db checks passed");
