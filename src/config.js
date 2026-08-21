// config.js - 账号配置存储（KV 命名空间 CTYUN_KV 的 'config' 键）
// 账号密码只存 KV，不进 git；每个账号有稳定 id 以便网页增删改。

const DEVICE_CODE_CHARS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomString(len) {
  let s = "";
  for (let i = 0; i < len; i++) {
    s += DEVICE_CODE_CHARS[Math.floor(Math.random() * DEVICE_CODE_CHARS.length)];
  }
  return s;
}

function genId() {
  try {
    if (globalThis.crypto && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {}
  return "id_" + randomString(12);
}

export async function loadConfig(kv) {
  const raw = await kv.get("config");
  let cfg;
  if (!raw) {
    cfg = { keepAliveSeconds: 60, accounts: [] };
  } else {
    try {
      cfg = JSON.parse(raw);
    } catch {
      cfg = { keepAliveSeconds: 60, accounts: [] };
    }
  }
  cfg.keepAliveSeconds = cfg.keepAliveSeconds || 60;
  cfg.accounts = Array.isArray(cfg.accounts) ? cfg.accounts : [];

  // 兼容旧数据：为每个账号补齐 id
  let changed = false;
  for (const a of cfg.accounts) {
    if (!a.id) {
      a.id = genId();
      changed = true;
    }
  }
  if (changed) await kv.put("config", JSON.stringify(cfg));
  return cfg;
}

export async function saveConfig(kv, cfg) {
  cfg.keepAliveSeconds = Math.max(10, cfg.keepAliveSeconds || 60);
  await kv.put("config", JSON.stringify(cfg));
}

// deviceCode 优先用配置里显式给定的；否则用 KV 持久化一个稳定的随机值。
export async function resolveDeviceCode(kv, account) {
  if (account.deviceCode && String(account.deviceCode).trim()) {
    return String(account.deviceCode).trim();
  }
  const user = account.user || account.name || "default";
  const key = "device:" + user;
  let code = await kv.get(key);
  if (!code) {
    code = "web_" + randomString(32);
    await kv.put(key, code);
  }
  return code;
}

// ---- 账号 CRUD ----
export async function addAccount(kv, acc) {
  const cfg = await loadConfig(kv);
  const item = {
    id: genId(),
    name: acc.name || acc.user || "未命名",
    user: acc.user || "",
    password: acc.password || "",
    deviceCode: acc.deviceCode || "",
  };
  cfg.accounts.push(item);
  await saveConfig(kv, cfg);
  return item;
}

export async function updateAccount(kv, id, patch) {
  const cfg = await loadConfig(kv);
  const a = cfg.accounts.find((x) => x.id === id);
  if (!a) return null;
  if (patch.name !== undefined) a.name = patch.name;
  if (patch.user !== undefined) a.user = patch.user;
  if (patch.deviceCode !== undefined) a.deviceCode = patch.deviceCode;
  // 密码为空表示“保持不变”，避免编辑其它字段时误清空密码
  if (patch.password !== undefined && String(patch.password).length > 0) {
    a.password = patch.password;
  }
  await saveConfig(kv, cfg);
  return a;
}

export async function deleteAccount(kv, id) {
  const cfg = await loadConfig(kv);
  const before = cfg.accounts.length;
  cfg.accounts = cfg.accounts.filter((x) => x.id !== id);
  if (cfg.accounts.length !== before) {
    await saveConfig(kv, cfg);
    return true;
  }
  return false;
}

export async function setKeepAlive(kv, sec) {
  const cfg = await loadConfig(kv);
  cfg.keepAliveSeconds = Math.max(10, Number(sec) || 60);
  await saveConfig(kv, cfg);
  return cfg.keepAliveSeconds;
}

// 脱敏：密码不回传给前端
export function maskAccounts(cfg) {
  return cfg.accounts.map((a) => ({
    id: a.id,
    name: a.name,
    user: a.user,
    hasPassword: !!a.password,
    password: a.password ? "********" : "",
    deviceCode: a.deviceCode ? "已设置" : "未设置",
  }));
}

export async function getLastRun(kv) {
  try {
    const raw = await kv.get("lastRun");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function setLastRun(kv, data) {
  if (!kv) return;
  await kv.put("lastRun", JSON.stringify(data));
}

// ---- 云电脑状态（按账号快照，允许写入 KV；与 lastRun 共用 Cron 节流）----
export async function getAccountStatus(kv, user) {
  try {
    const raw = await kv.get("status:" + user);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function setAccountStatus(kv, user, data) {
  if (!kv) return;
  await kv.put("status:" + user, JSON.stringify(data));
}
