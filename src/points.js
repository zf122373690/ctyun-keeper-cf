// 天翼云电脑积分任务与奖励兑换（复用 CtYunApi 的登录签名）
const TASK_URL = "https://desk.ctyun.cn/selforder/api/marketing/userPoints/getTaskList";
const REWARD_URL = "https://desk.ctyun.cn/selforder/api/selforder/prod/get?prodId=17000000&prodCode=POINTS";
const ORDER_URL = "https://desk.ctyun.cn/selforder/api/selforder/paas/placeOrder";

function asList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.records)) return data.records;
  if (Array.isArray(data?.list)) return data.list;
  return [];
}

export async function getPointsOptions(api) {
  const desktops = await api.getDesktopList();
  if (desktops === null) return { ok: false, error: "登录会话已失效，无法读取云电脑" };
  const rewardResp = await api._request(REWARD_URL);
  if (rewardResp?.code !== 0) {
    return { ok: false, error: rewardResp?.msg || "无法读取可兑换奖励", desktops: [] };
  }
  const rewards = asList(rewardResp.data).map((item) => ({
    prodId: item.prodId,
    prodName: item.prodName || item.name || "未命名奖励",
    prodType: item.prodType,
    costPoints: item.costPoints ?? item.points ?? item.price ?? 0,
  }));
  const isEightCore = (name) => /8\s*(?:c|核)\s*16\s*g/i.test(String(name || ""));
  const recommendedRewardIndex = rewards.findIndex((item) => isEightCore(item.prodName));
  return {
    ok: true,
    desktops: desktops.map((d) => ({
      desktopId: String(d.desktopId ?? ""),
      name: d.desktopName || d.computerName || d.desktopCode || "未命名云电脑",
      status: d.useStatusText || "未知",
    })),
    rewards,
    recommendedRewardIndex,
  };
}

export function buildOrderPayload(config, times) {
  const count = Math.max(1, Number(times) || 1);
  return {
    busiChannel: "010",
    orderType: 1,
    pointType: 1,
    points: Number(config.costPoints) * count,
    sku: Array.from({ length: count }, (_, i) => ({
      execSort: i + 1,
      prodId: Number(config.prodId),
      prodType: String(config.prodType || ""),
      attrs: [{ attrKey: "bindDesktopId", attrVal: Number(config.desktopId) }],
    })),
  };
}

export async function pollPointsTask(api, account, log) {
  const task = await api._request(TASK_URL);
  const list = Array.isArray(task?.data) ? task.data : [];
  const hang = list.find((x) => x.taskDefName === "使用1小时");
  const progress = Number(hang?.currentProgress || 0);
  const minute = Math.floor(progress / 60);
  if (account._lastPointsMinute !== minute) {
    account._lastPointsMinute = minute;
    log(`[${account.user}] 模拟客户端积分活动，当前进度 ${minute} 分钟`);
  }
  return { progress, task };
}

function todayBeijing() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function shouldRedeem(config, today) {
  if (config.lastRedeemDate === today) return false;
  const type = String(config.scheduleType || "daily");
  if (type === "interval_days") {
    const last = Date.parse(`${config.lastRedeemDate}T00:00:00Z`);
    return !Number.isFinite(last) || Date.parse(`${today}T00:00:00Z`) - last >= Math.max(1, Number(config.intervalDays) || 1) * 86400000;
  }
  if (type === "monthly_days") {
    const day = Number(today.slice(-2));
    const monthEnd = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate();
    const days = Array.isArray(config.monthlyDays) ? config.monthlyDays.map(Number) : [];
    return days.includes(day) || (days.includes(-1) && day === monthEnd);
  }
  return true;
}

export async function runPointsMaintenance(api, account, log, saveConfig) {
  const cfg = account.points;
  if (!cfg || cfg.enabled !== true) return { enabled: false };
  if (!cfg.desktopId || !cfg.prodId || !cfg.prodType || !(Number(cfg.costPoints) > 0)) {
    log(`[${account.user}] 积分兑换配置不完整，跳过`);
    return { enabled: true, ok: false, error: "配置不完整" };
  }
  const taskResult = await pollPointsTask(api, account, log);
  const progress = taskResult.progress;
  log(`[${account.user}] 积分挂机进度：${Math.floor(progress / 60)} 分钟`);
  const today = todayBeijing();
  if (!shouldRedeem(cfg, today)) return { enabled: true, ok: true, progress, skipped: true };
  const available = Number(cfg.currentPoints);
  const pointsResp = await api._request(REWARD_URL);
  const rewards = Array.isArray(pointsResp?.data) ? pointsResp.data : [];
  const selected = rewards.find((x) => Number(x.prodId) === Number(cfg.prodId));
  const currentPoints = Number.isFinite(available) && available > 0 ? available : Number(selected?.userPoints ?? selected?.points ?? 0);
  const possible = currentPoints > 0 ? Math.floor(currentPoints / Number(cfg.costPoints)) : 0;
  const max = Number(cfg.maxRedeemTimes) || 0;
  // Workers 无法读取积分中心 iframe；配置了固定次数时沿用目标项目的降级尝试策略。
  const times = max > 0 ? Math.min(max, possible || max) : possible;
  if (times < 1) return { enabled: true, ok: true, progress, skipped: true, reason: "积分不足或未读取到积分" };
  const order = await api._request(ORDER_URL, {
    method: "POST",
    body: JSON.stringify(buildOrderPayload(cfg, times)),
    contentType: "application/json",
  });
  if (order?.code !== 0) {
    log(`[${account.user}] 积分兑换失败：${order?.msg || order?.code || "未知错误"}`);
    return { enabled: true, ok: false, progress, error: order?.msg || "兑换失败" };
  }
  cfg.lastRedeemDate = today;
  await saveConfig(account);
  log(`[${account.user}] 积分兑换成功：${times} 次，共 ${times * Number(cfg.costPoints)} 积分`);
  return { enabled: true, ok: true, progress, redeemed: times };
}
