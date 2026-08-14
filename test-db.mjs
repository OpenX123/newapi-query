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

const source = readFileSync(new URL("./db.js", import.meta.url), "utf8");
assert.match(source, /FROM log_archive_token_totals/);
assert.match(source, /FROM logs[\s\S]*WHERE token_id = \$1 AND type = 2/);

console.log("db checks passed");
