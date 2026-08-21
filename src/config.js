// config.js - 从 KV 读取账号配置，并解析/持久化 deviceCode

const DEVICE_CODE_CHARS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomString(len) {
  let s = "";
  for (let i = 0; i < len; i++) {
    s += DEVICE_CODE_CHARS[Math.floor(Math.random() * DEVICE_CODE_CHARS.length)];
  }
  return s;
}

export async function loadConfig(kv) {
  const raw = await kv.get("config");
  if (!raw) return { keepAliveSeconds: 60, accounts: [] };
  try {
    const cfg = JSON.parse(raw);
    return {
      keepAliveSeconds: cfg.keepAliveSeconds || 60,
      accounts: Array.isArray(cfg.accounts) ? cfg.accounts : [],
    };
  } catch {
    return { keepAliveSeconds: 60, accounts: [] };
  }
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
