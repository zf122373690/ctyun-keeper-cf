// log.js - 执行日志采集器 + KV 环形缓冲
// 日志同时打到 console（wrangler tail 可见）与 KV（网页后台可见）。

export class RunLog {
  constructor() {
    this.entries = [];
  }

  push(level, msg) {
    this.entries.push({ ts: Date.now(), level, msg });
    console.log(`[${level}] ${msg}`);
  }

  info(m) {
    this.push("info", m);
  }
  warn(m) {
    this.push("warn", m);
  }
  error(m) {
    this.push("error", m);
  }

  // 取出并清空当前缓冲，供刷写 KV
  drain() {
    const e = this.entries;
    this.entries = [];
    return e;
  }
}

// 把一批日志追加进 KV，并裁剪到 max 条（环形）
export async function appendLogs(kv, entries, max = 150) {
  if (!kv || !entries || entries.length === 0) return;
  try {
    const raw = await kv.get("logs");
    let arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) arr = [];
    for (const e of entries) arr.push(e);
    if (arr.length > max) arr = arr.slice(arr.length - max);
    await kv.put("logs", JSON.stringify(arr));
  } catch (e) {
    console.error("appendLogs failed:", e);
  }
}

export async function getLogs(kv, max = 200) {
  if (!kv) return [];
  try {
    const raw = await kv.get("logs");
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.slice(-max) : [];
  } catch {
    return [];
  }
}
