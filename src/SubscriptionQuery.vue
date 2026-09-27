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
    <article v-for="item in items" :key="item.id" class="card">
      <h2 class="card-value">{{ item.title }}</h2>
      <p class="card-label">#{{ item.id }} · {{ statusLabel(item.status) }}</p>
      <template v-if="item.weekly_amount > 0">
        <p class="card-value">本周已用 {{ money(item.weekly_used) }} / {{ money(item.weekly_amount) }}</p>
        <progress :value="Math.min(item.weekly_used, item.weekly_amount)" :max="item.weekly_amount" :aria-label="`${item.title}周额度使用进度`" style="width: 100%"></progress>
        <p class="card-label">剩余 {{ money(item.weekly_remaining) }} · 已用 {{ (item.weekly_used / item.weekly_amount * 100).toFixed(1) }}%</p>
        <p class="card-label">下次周重置：{{ date(item.weekly_reset_time) }}</p>
      </template>
      <p v-else class="card-label">{{ item.weekly_amount === null ? '该站点未提供周额度数据' : '此套餐未设置独立周限额' }}</p>
      <p class="card-label">套餐额度已用：{{ money(item.amount_used) }} / {{ item.amount_total > 0 ? money(item.amount_total) : '不限额' }}</p>
      <p class="card-label">下次额度窗口重置：{{ date(item.next_reset_time) }}</p>
      <p class="card-caption">开始：{{ date(item.start_time) }}</p>
      <p class="card-caption">到期：{{ date(item.end_time) }}</p>
    </article>
  </section>
</template>

<script setup>
import { onUnmounted, ref, watch } from "vue";

const key = ref("");
const loading = ref(false);
const items = ref([]);
const message = ref("输入普通 API Key 查询套餐。");
const updatedAt = ref("");
let controller;
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const money = (quota) => usd.format(quota / 500000);
const date = (seconds) => seconds ? new Date(seconds * 1000).toLocaleString() : "—";
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
    updatedAt.value = new Date().toLocaleTimeString();
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
