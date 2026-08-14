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
            :disabled="isLoading"
            @keydown.enter="fetchUsage"
          />
          <button class="btn" type="button" :disabled="isLoading" @click="fetchUsage">
            {{ isLoading ? "查询中..." : "立即查询" }}
          </button>
        </div>
        <p class="input-hint">Key 仅用于本次查询，不会保存。</p>
      </section>

      <section class="results">
        <div class="card">
          <p class="card-label">消耗 Token</p>
          <p class="card-value">{{ tokenUsageText }}</p>
          <p class="card-caption">当前令牌全部消费记录的实际处理量</p>
        </div>
        <div class="card">
          <p class="card-label">令牌归属</p>
          <p class="card-value">{{ tokenOwnerText }}</p>
          <p class="card-caption">用户 ID：{{ tokenUserIdText }} · Token：{{ tokenNameText }}</p>
        </div>
        <div class="card">
          <p class="card-label">访问 IP</p>
          <p class="card-value">{{ ipCountText }}</p>
          <p class="card-caption">累计去重，未记录的 IP 不计入</p>
        </div>
        <div class="card">
          <p class="card-label">消耗余额</p>
          <p class="card-value">{{ usedBalanceText }}</p>
          <p class="card-caption">按美元格式展示</p>
        </div>
        <div class="card">
          <p class="card-label">总额度</p>
          <p class="card-value">{{ totalQuotaText }}</p>
          <p class="card-caption">原始额度总量</p>
        </div>
        <div class="card">
          <p class="card-label">剩余额度</p>
          <p class="card-value">{{ balanceText }}</p>
          <p class="card-caption">原始剩余额度</p>
        </div>
      </section>

      <section class="records">
        <div class="records-header">
          <h2 class="records-title">详细使用记录</h2>
          <p class="records-subtitle">按单次总 Token 从高到低排列；同量时最近在前。</p>
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
                <th>总 Token</th>
                <th>消耗钱</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in pagedItems" :key="item._rowKey">
                <td>{{ formatTimestamp(item.created_at) }}</td>
                <td>{{ item.model_name || "--" }}</td>
                <td>{{ formatTokens(item.input_tokens) }}</td>
                <td>{{ formatTokens(item.output_tokens) }}</td>
                <td>{{ formatCache(item.cache_tokens) }}</td>
                <td>{{ formatTokens(item.total_tokens) }}</td>
                <td>{{ formatCost(item.quota) }}</td>
                <td>{{ item.ip || "未记录" }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="pagedItems.length === 0" class="empty-text">暂无记录</p>
          <div class="pagination">
            <div class="page-info">
              <span>显示 {{ displayItems.length }} 条</span>
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
import { computed, ref } from "vue";

const API_BASE = "";
const TOKEN_TO_USD_RATE = 500000;
const PAGE_SIZE = 20;

const apiKey = ref("");
const isLoading = ref(false);
const statusText = ref("请填写 Key 并点击查询。");

const tokenUsageValue = ref(null);
const usedBalanceValue = ref(null);
const balanceValue = ref(null);
const ipCountValue = ref(null);
const tokenInfo = ref(null);
const logItems = ref([]);
const currentPage = ref(1);

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

const tokenUsageText = computed(() =>
  typeof tokenUsageValue.value === "number"
    ? numberFormat.format(tokenUsageValue.value)
    : "--"
);
const ipCountText = computed(() =>
  typeof ipCountValue.value === "number"
    ? `${numberFormat.format(ipCountValue.value)} 个`
    : "--"
);
const tokenOwnerText = computed(() => tokenInfo.value?.username || "--");
const tokenUserIdText = computed(() => tokenInfo.value?.user_id ?? "--");
const tokenNameText = computed(() => tokenInfo.value?.name || "--");
const usedBalanceText = computed(() =>
  typeof usedBalanceValue.value === "number"
    ? usdFormat.format(usedBalanceValue.value / TOKEN_TO_USD_RATE)
    : "--"
);
const totalQuotaText = computed(() =>
  typeof usedBalanceValue.value === "number" && typeof balanceValue.value === "number"
    ? `${numberFormat.format(usedBalanceValue.value + balanceValue.value)} 额度`
    : "--"
);
const balanceText = computed(() =>
  typeof balanceValue.value === "number"
    ? `${numberFormat.format(balanceValue.value)} 额度`
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

const displayItems = computed(() =>
  logItems.value.map((item, index) => ({
    ...item,
    _rowKey: `${item.id || item.created_at || "row"}-${index}`,
  }))
);

const totalPages = computed(() => Math.max(1, Math.ceil(displayItems.value.length / PAGE_SIZE)));

const pagedItems = computed(() => {
  const start = (currentPage.value - 1) * PAGE_SIZE;
  return displayItems.value.slice(start, start + PAGE_SIZE);
});

const resetValues = () => {
  tokenUsageValue.value = null;
  usedBalanceValue.value = null;
  balanceValue.value = null;
  ipCountValue.value = null;
  tokenInfo.value = null;
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
    cache: "no-store",
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

  const totalTokens = Number(data.total_tokens);
  const totalUsed = Number(data.total_used);
  const totalAvailable = Number(data.total_available);
  const uniqueIpCount = Number(data.unique_ip_count);

  if (
    Number.isNaN(totalTokens)
    || Number.isNaN(totalUsed)
    || Number.isNaN(totalAvailable)
    || Number.isNaN(uniqueIpCount)
    || !data.token
  ) {
    throw new Error("额度数据异常，请确认 key 是否有效。");
  }

  return {
    totalTokens,
    totalUsed,
    totalAvailable,
    uniqueIpCount,
    token: data.token,
  };
};

const fetchLogData = async (key) => {
  const payload = await fetchWithAuth("/api/log/token", key);
  const data = payload && payload.data ? payload.data : [];
  if (!payload || payload.success !== true) {
    const message = payload && payload.message ? payload.message : "记录数据不完整";
    throw new Error(message);
  }
  return data;
};

const fetchUsage = async () => {
  if (isLoading.value) return;
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

    tokenUsageValue.value = usageData.totalTokens;
    usedBalanceValue.value = usageData.totalUsed;
    balanceValue.value = usageData.totalAvailable;
    ipCountValue.value = usageData.uniqueIpCount;
    tokenInfo.value = usageData.token;

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
</script>
