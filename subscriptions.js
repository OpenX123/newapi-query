// 无本地数据库时，只信任上游用该 Key 鉴权后返回的日志归属。
export async function resolveSubscriptionUser(rawKey) {
  let url;
  try {
    url = new URL("/api/log/token", process.env.NEW_API_BASE_URL);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error();
  } catch { throw new Error("请先配置 HTTPS 套餐站点地址"); }
  let response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${rawKey.trim()}` },
      redirect: "error", signal: AbortSignal.timeout(10000),
    });
  } catch { throw new Error("套餐站点连接失败或超时，请稍后重试"); }
  if (!response.ok) throw new Error("无法验证 API Key，请检查 Key 是否有效");
  let payload;
  try { payload = await response.json(); } catch { throw new Error("Key 验证接口未返回有效 JSON"); }
  if (payload.success !== true || !Array.isArray(payload.data)) throw new Error("无法验证 API Key，请检查 Key 是否有效");
  const ids = new Set(payload.data.map((row) => row.user_id));
  const [id] = ids;
  if (ids.size !== 1 || !Number.isSafeInteger(id) || id <= 0) {
    throw new Error("无法从调用记录确认 Key 归属，请配置数据库查询（新 Key 可能尚无记录）");
  }
  return id;
}

// 管理员凭证只用于服务端请求；每个数据库站点必须显式配置对应站点。
export async function fetchUserSubscriptions(userId, siteIndex = 0) {
  const suffix = siteIndex === 0 ? "" : `_${siteIndex + 1}`;
  const base = process.env[`NEW_API_BASE_URL${suffix}`];
  const accessToken = process.env[`NEW_API_ADMIN_TOKEN${suffix}`];
  const adminId = process.env[`NEW_API_ADMIN_USER_ID${suffix}`];
  if (!base || !accessToken || !/^[1-9]\d*$/.test(adminId || "")) {
    throw new Error("该站点尚未配置套餐查询地址、管理员访问令牌和管理员用户 ID");
  }
  if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) {
    throw new Error("未找到 Key 所属用户");
  }
  let origin;
  try {
    origin = new URL(base);
    if (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))) throw new Error();
    if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") throw new Error();
  } catch {
    throw new Error("套餐查询地址必须为 HTTPS 站点根地址（本机调试允许 HTTP）");
  }
  const request = async (path) => {
    let response;
    try {
      response = await fetch(new URL(path, origin), {
        headers: { Authorization: `Bearer ${accessToken}`, "New-Api-User": adminId },
        signal: AbortSignal.timeout(10000),
        redirect: "error",
      });
    } catch {
      throw new Error("套餐站点连接失败或超时，请稍后重试");
    }
    if (!response.ok) throw new Error(`套餐接口请求失败（${response.status}），请检查管理权限和站点配置`);
    let payload;
    try { payload = await response.json(); } catch { throw new Error("套餐接口未返回有效 JSON"); }
    if (payload.success !== true) throw new Error("套餐接口拒绝查询，请检查管理员凭证和权限");
    if (!Array.isArray(payload.data)) throw new Error("套餐接口数据格式不兼容");
    return payload.data;
  };
  const records = await request(`/api/subscription/admin/users/${Number(userId)}/subscriptions`);
  // 套餐名称不可用时仍显示额度，避免可选信息阻断查询。
  const plans = records.length ? await request("/api/subscription/admin/plans").catch(() => []) : [];
  return records.map(({ subscription: sub }) => {
    if (!sub || Number(sub.user_id) !== Number(userId)) throw new Error("套餐归属校验失败");
    const numeric = (field, optional = false) => {
      if (optional && sub[field] == null) return null;
      const value = Number(sub[field]);
      if (sub[field] == null || !Number.isFinite(value) || value < 0) throw new Error("套餐额度数据不完整");
      return value;
    };
    const now = Math.floor(Date.now() / 1000);
    const end = numeric("end_time");
    const active = sub.status === "active" && end > now;
    const total = numeric("weekly_amount", true);
    let used = numeric("weekly_used", true);
    let reset = numeric("weekly_reset_time", true);
    if (total > 0 && (used === null || reset === null)) throw new Error("套餐周额度数据不完整");
    if (active && total > 0 && reset > 0 && reset <= now) {
      used = 0;
      reset += (Math.floor((now - reset) / 604800) + 1) * 604800;
    }
    const plan = plans.find((item) => item.plan?.id === sub.plan_id)?.plan;
    return {
      id: numeric("id"),
      title: plan?.title || `套餐 #${sub.plan_id}`,
      status: active ? "active" : sub.status === "active" ? "expired" : sub.status,
      start_time: numeric("start_time"), end_time: end,
      amount_total: numeric("amount_total"), amount_used: numeric("amount_used"),
      next_reset_time: numeric("next_reset_time", true),
      weekly_amount: total, weekly_used: used,
      weekly_remaining: total > 0 ? Math.max(0, total - used) : null,
      weekly_reset_time: active && reset > 0 && reset < end ? reset : null,
    };
  });
}
