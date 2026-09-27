<template>
  <section class="query">
    <label class="input-label" for="subscriptionKey">套餐所属账户的 API Key</label>
    <form class="input-row" @submit.prevent="query">
      <input id="subscriptionKey" v-model="key" class="input" type="password" autocomplete="off" placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx" required />
      <button class="btn" :disabled="loading">{{ loading ? '查询中...' : '查询套餐' }}</button>
    </form>
    <p class="input-hint">显示该账户全部 Key 共用的套餐用量，不是单个 Key 的消耗。Key 不会保存。</p>
  </section>
  <p class="status-text" role="status">{{ message }}<span v-if="updatedAt"> · 上次成功更新：{{ updatedAt }}</span></p>
  <section v-if="items.length" class="results" aria-label="套餐用量">
    <article v-for="item in items" :key="item.id" class="quota-card">
      <header class="quota-header">
        <h2>{{ item.title }}</h2>
        <span class="quota-status">{{ statusLabel(item.status) }}</span>
      </header>
      <div class="window-usage">
        <p class="quota-label">5h 剩余额度</p>
        <p class="remaining">{{ item.amount_total > 0 ? money(Math.max(0, item.amount_total - item.amount_used)) : '不限额' }}</p>
        <div class="usage-summary">
          <span>已用 {{ money(item.amount_used) }} <span class="muted">/ {{ item.amount_total > 0 ? money(item.amount_total) : '不限额' }}</span></span>
          <span v-if="item.amount_total > 0">{{ (item.amount_used / item.amount_total * 100).toFixed(1) }}%</span>
        </div>
        <progress v-if="item.amount_total > 0" :value="Math.min(item.amount_used, item.amount_total)" :max="item.amount_total" :aria-label="`${item.title}5h 额度使用进度`"></progress>
        <div class="reset-info">
          <p class="quota-label">下次重置 <span class="reset-relative">{{ relativeReset(item.next_reset_time) }}</span></p>
          <p class="auxiliary">{{ date(item.next_reset_time) }} · 相对时间以本次查询为准</p>
        </div>
      </div>
      <div class="weekly-usage">
        <template v-if="item.weekly_amount > 0">
          <div class="usage-summary"><span>周额度</span><span>{{ (item.weekly_used / item.weekly_amount * 100).toFixed(1) }}% 已用</span></div>
          <p>{{ money(item.weekly_used) }} <span class="muted">/ {{ money(item.weekly_amount) }}</span></p>
          <p class="auxiliary">下次周重置 {{ date(item.weekly_reset_time) }}</p>
        </template>
        <p v-else class="auxiliary">{{ item.weekly_amount === null ? '该站点未提供周额度数据' : '此套餐未设置独立周限额' }}</p>
      </div>
      <footer class="quota-footer">
        <p>开始 {{ date(item.start_time) }}</p>
        <p>到期 {{ date(item.end_time) }}</p>
      </footer>
    </article>
  </section>
</template>

<style scoped>
.quota-card { background: #fff; border-radius: 16px; padding: 24px; color: #171717; box-shadow: 0 4px 24px rgb(15 23 42 / 5%); display: grid; gap: 24px; min-width: 0; font-size: 14px; font-variant-numeric: tabular-nums; }
.quota-card p, .quota-card h2 { margin: 0; }
.quota-header, .usage-summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.quota-header h2 { font-size: 22px; font-weight: 600; }
.quota-status { background: #f3f4f6; border-radius: 20px; padding: 5px 10px; font-size: 12px; }
.window-usage { display: grid; gap: 12px; }
.quota-label { font-size: 14px; color: #52525b; }
.remaining { font-size: 28px; font-weight: 600; letter-spacing: -.6px; line-height: 1.2; }
.muted, .auxiliary, .quota-footer { color: #71717a; }
.auxiliary, .quota-footer { font-size: 12px; line-height: 1.6; }
progress { appearance: none; width: 100%; height: 7px; border: 0; border-radius: 99px; overflow: hidden; background: #eeeef0; }
progress::-webkit-progress-bar { background: #eeeef0; border-radius: 99px; }
progress::-webkit-progress-value { background: #27272a; border-radius: 99px; }
progress::-moz-progress-bar { background: #27272a; border-radius: 99px; }
.reset-info { display: grid; gap: 6px; padding-top: 8px; }
.reset-relative { color: #171717; font-size: 16px; margin-left: 8px; }
.weekly-usage { display: grid; gap: 8px; background: #f7f7f8; padding: 16px; border-radius: 12px; font-size: 14px; }
.quota-footer { display: flex; justify-content: space-between; gap: 8px 20px; flex-wrap: wrap; }
</style>

<script setup>
import { onUnmounted, ref, watch } from "vue";

const key = ref("");
const loading = ref(false);
const items = ref([]);
const message = ref("输入普通 API Key 查询套餐。");
const updatedAt = ref("");
const queriedAt = ref(Date.now());
let controller;
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const money = (quota) => usd.format(quota / 500000);
const date = (seconds) => seconds ? new Date(seconds * 1000).toLocaleString(undefined, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
const relativeReset = (seconds) => {
  if (!seconds) return "暂无计划";
  const minutes = Math.ceil((seconds * 1000 - queriedAt.value) / 60000);
  if (minutes <= 0) return "已到重置时间";
  if (minutes < 60) return `${minutes} 分钟后`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ""}后`;
};
const statusLabel = (status) => ({ active: "生效", expired: "已到期", cancelled: "已取消" }[status] || status);

watch(key, () => {
  controller?.abort();
  items.value = [];
  updatedAt.value = "";
  message.value = "Key 已变更，请重新查询。";
});

async function query() {
  const requestedKey = key.value.trim();
  if (loading.value || !requestedKey) return;
  loading.value = true;
  controller = new AbortController();
  message.value = "正在查询套餐...";
  try {
    const response = await fetch("/api/subscriptions/token", {
      headers: { Authorization: `Bearer ${requestedKey}` },
      cache: "no-store",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35000)]),
    });
    if (!response.ok) throw new Error(`查询失败（${response.status}）`);
    const payload = await response.json();
    if (!payload.success || !Array.isArray(payload.data)) throw new Error(payload.message || "套餐数据格式异常");
    if (requestedKey !== key.value.trim()) return;
    items.value = payload.data;
    queriedAt.value = Date.now();
    updatedAt.value = new Date(queriedAt.value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
    message.value = items.value.length ? "套餐用量已更新。" : "该账户暂无套餐。";
  } catch (error) {
    if (controller.signal.aborted) return;
    message.value = `${error.name === 'TimeoutError' ? '查询超时，请重试' : error.message}${updatedAt.value ? '；当前显示上次成功结果。' : ''}`;
  } finally {
    loading.value = false;
  }
}

onUnmounted(() => controller?.abort());
</script>
