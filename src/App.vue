<template>
  <div class="page">
    <header class="hero">
      <div class="brand">
        <img
          class="brand-logo"
          src="https://oss.yiyongai.cn/img/Claude.png"
          alt="CC API Logo"
        />
        <span class="brand-name">CC API</span>
      </div>
      <p class="hero-eyebrow">Balance & Usage</p>
      <h1 class="hero-title">查询令牌余额与用量</h1>
      <p class="hero-subtitle">
        输入你的 Key，即可查看当前额度用量与余额。隐私优先，Key 仅在本地请求中使用。
      </p>
    </header>

    <main class="panel">
      <section class="query">
        <label class="input-label" for="apiKey">API Key</label>
        <div class="input-row">
          <input
            id="apiKey"
            v-model="apiKey"
            class="input"
            type="password"
            placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
            autocomplete="off"
            @keydown.enter="fetchUsage"
          />
          <button class="btn" type="button" :disabled="isLoading" @click="fetchUsage">
            {{ isLoading ? "查询中..." : "立即查询" }}
          </button>
        </div>
        <p class="input-hint">Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>
      </section>

      <section class="results">
        <div class="card">
          <p class="card-label">已用额度</p>
          <p class="card-value">{{ usageText }}</p>
          <p class="card-caption">统计范围：当前令牌累计使用量</p>
        </div>
        <div class="card">
          <p class="card-label">可用余额</p>
          <p class="card-value">{{ balanceText }}</p>
          <p class="card-caption">按美元格式展示</p>
        </div>
      </section>

      <section class="records">
        <div class="records-header">
          <div class="records-title-row">
            <h2 class="records-title">详细使用记录</h2>
            <label class="sort-control">
              <span>时间排序</span>
              <select v-model="sortOrder" class="select">
                <option value="desc">最近在前</option>
                <option value="asc">最早在前</option>
              </select>
            </label>
          </div>
          <p class="records-subtitle">默认按最近时间排序，可切换排序方式。</p>
        </div>
        <div class="table-wrapper">
          <table class="table">
            <thead>
              <tr>
                <th>时间</th>
                <th>模型</th>
                <th>输入</th>
                <th>输出</th>
                <th>缓存</th>
                <th>消耗钱</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in pagedItems" :key="item._rowKey">
                <td>{{ formatTimestamp(item.created_at) }}</td>
                <td>{{ item.model_name || "--" }}</td>
                <td>{{ formatTokens(item.input_tokens) }}</td>
                <td>{{ formatTokens(item.output_tokens) }}</td>
                <td>{{ formatCache(item.cache_tokens) }}</td>
                <td>{{ formatCost(item.quota) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="pagedItems.length === 0" class="empty-text">暂无记录</p>
          <div class="pagination">
            <div class="page-info">
              <span>共 {{ displayItems.length }} 条</span>
              <span>第 {{ displayItems.length ? currentPage : 0 }} / {{ totalPages }} 页</span>
            </div>
            <div class="page-actions">
              <button
                class="btn btn-secondary"
                type="button"
                :disabled="currentPage <= 1 || displayItems.length === 0"
                @click="prevPage"
              >
                上一页
              </button>
              <button
                class="btn btn-secondary"
                type="button"
                :disabled="currentPage >= totalPages || displayItems.length === 0"
                @click="nextPage"
              >
                下一页
              </button>
            </div>
          </div>
        </div>
      </section>

      <section class="status">
        <p class="status-text">{{ statusText }}</p>
      </section>
    </main>
  </div>
</template>

<script setup>
import { computed, ref, watch } from "vue";

const API_BASE = "";
const TOKEN_TO_USD_RATE = 500000;
const PAGE_SIZE = 20;

const apiKey = ref("");
const isLoading = ref(false);
const statusText = ref("请填写 Key 并点击查询。");

const usageValue = ref(null);
const balanceValue = ref(null);
const logItems = ref([]);
const currentPage = ref(1);
const sortOrder = ref("desc");

const numberFormat = new Intl.NumberFormat("en-US");
const usdFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const usdCostFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const usageText = computed(() =>
  typeof usageValue.value === "number" ? numberFormat.format(usageValue.value) : "--"
);
const balanceText = computed(() =>
  typeof balanceValue.value === "number"
    ? usdFormat.format(balanceValue.value / TOKEN_TO_USD_RATE)
    : "--"
);

const formatTokens = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numberFormat.format(numeric) : "0";
};

// 缓存为 0 时留空不显示。
const formatCache = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numberFormat.format(numeric) : "";
};

const formatCost = (value) => {
  const numeric = Number(value);
  return Number.isNaN(numeric) ? "--" : usdCostFormat.format(numeric / TOKEN_TO_USD_RATE);
};

const formatTimestamp = (value) => {
  if (!value) return "--";
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return "--";
  const time = numeric < 1e12 ? numeric * 1000 : numeric;
  return new Date(time).toLocaleString();
};

const displayItems = computed(() => {
  const filtered = logItems.value.filter((item) => Number(item.quota) > 0);
  return filtered
    .slice()
    .sort((a, b) => {
      const aTime = Number(a.created_at) || 0;
      const bTime = Number(b.created_at) || 0;
      return sortOrder.value === "asc" ? aTime - bTime : bTime - aTime;
    })
    .map((item, index) => ({
      ...item,
      _rowKey: `${item.id || item.created_at || "row"}-${index}`,
    }));
});

const totalPages = computed(() => Math.max(1, Math.ceil(displayItems.value.length / PAGE_SIZE)));

const pagedItems = computed(() => {
  const start = (currentPage.value - 1) * PAGE_SIZE;
  return displayItems.value.slice(start, start + PAGE_SIZE);
});

const resetValues = () => {
  usageValue.value = null;
  balanceValue.value = null;
};

const resetLogs = () => {
  logItems.value = [];
  currentPage.value = 1;
};

const fetchWithAuth = async (path, key) => {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${key}`,
    },
  });

  if (!response.ok) {
    throw new Error(`请求失败（${response.status}）`);
  }
  return response.json();
};

const fetchUsageData = async (key) => {
  const payload = await fetchWithAuth("/api/usage/token", key);
  const data = payload && payload.data ? payload.data : null;

  if (!payload || payload.code !== true || !data) {
    const message = payload && payload.message ? payload.message : "返回数据不完整";
    throw new Error(message);
  }

  const totalUsed = Number(data.total_used);
  const totalAvailable = Number(data.total_available);

  if (Number.isNaN(totalUsed) || Number.isNaN(totalAvailable)) {
    throw new Error("额度数据异常，请确认 key 是否有效。");
  }

  return { totalUsed, totalAvailable };
};

const fetchLogData = async (key) => {
  const payload = await fetchWithAuth(`/api/log/token?key=${encodeURIComponent(key)}`, key);
  const data = payload && payload.data ? payload.data : [];
  if (!payload || payload.success !== true) {
    const message = payload && payload.message ? payload.message : "记录数据不完整";
    throw new Error(message);
  }
  return data;
};

const fetchUsage = async () => {
  const rawKey = apiKey.value.trim();
  if (!rawKey) {
    statusText.value = "请先填写 Key，再进行查询。";
    resetValues();
    return;
  }

  isLoading.value = true;
  statusText.value = "正在获取最新用量、余额与记录...";
  resetLogs();

  try {
    const [usageData, logData] = await Promise.all([
      fetchUsageData(rawKey),
      fetchLogData(rawKey).catch((error) => ({ error })),
    ]);

    usageValue.value = usageData.totalUsed;
    balanceValue.value = usageData.totalAvailable;

    if (Array.isArray(logData)) {
      logItems.value = logData;
      statusText.value = "查询成功，数据已更新。";
    } else {
      statusText.value = `查询成功，记录获取失败：${logData.error.message}`;
      resetLogs();
    }
  } catch (error) {
    resetValues();
    resetLogs();
    statusText.value = `查询失败：${error.message}`;
  } finally {
    isLoading.value = false;
  }
};

const prevPage = () => {
  if (currentPage.value > 1) {
    currentPage.value -= 1;
  }
};

const nextPage = () => {
  if (currentPage.value < totalPages.value) {
    currentPage.value += 1;
  }
};

watch(sortOrder, () => {
  currentPage.value = 1;
});
</script>
