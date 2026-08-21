// index.js - Cloudflare Workers 入口（Hono 框架）
// 路由：
//   GET  /              管理后台（暗色主题单页）
//   GET  /api/state     仪表盘数据（账号列表/设置/最近一次运行）
//   GET  /api/logs      执行日志（仅手动运行写入 KV；Cron 只打 console）
//   POST /api/logs/clear 清空日志（回收 KV 空间）
//   GET  /api/kv/stats  KV 各键占用诊断
//   POST /api/accounts  新增账号
//   PUT  /api/accounts/:id  修改账号（密码留空=不变）
//   DELETE /api/accounts/:id 删除账号
//   POST /api/settings  修改保活时长
//   POST /api/run       立即触发一次保活（异步，看日志面板）
//   GET  /health        健康检查
// Cron（wrangler.toml [triggers]）定时触发保活。
// 所有 /api/* 需用 Bearer ADMIN_TOKEN 鉴权（wrangler secret put ADMIN_TOKEN）。

import { Hono } from "hono";
import { adminHtml } from "./web.js";
import {
  CtYunApi,
  runAccount,
} from "./ctyun.js";
import {
  loadConfig,
  resolveDeviceCode,
  addAccount,
  updateAccount,
  deleteAccount,
  setKeepAlive,
  maskAccounts,
  getLastRun,
  setLastRun,
} from "./config.js";
import { RunLog, appendLogs, getLogs } from "./log.js";

const app = new Hono();

// ---- 鉴权中间件：仅 /api/* ----
app.use("/api/*", async (c, next) => {
  const expected = c.env.ADMIN_TOKEN;
  const auth = c.req.header("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!expected) {
    return c.json(
      { error: "后台未配置 ADMIN_TOKEN：请先运行 wrangler secret put ADMIN_TOKEN" },
      401
    );
  }
  if (!token || token !== expected) {
    return c.json({ error: "未授权：请在网页输入正确的访问令牌" }, 401);
  }
  await next();
});

// ---- 静态后台 ----
app.get("/", (c) => c.html(adminHtml));
app.get("/health", (c) => c.text("ok"));

// ---- 仪表盘 ----
app.get("/api/state", async (c) => {
  const kv = c.env.CTYUN_KV;
  if (!kv) return c.json({ error: "未绑定 KV 命名空间 CTYUN_KV" }, 500);
  const cfg = await loadConfig(kv);
  const logs = await getLogs(kv, 100);
  const lastRun = await getLastRun(kv);
  return c.json({
    keepAliveSeconds: cfg.keepAliveSeconds,
    accounts: maskAccounts(cfg),
    logCount: logs.length,
    lastRun,
  });
});

app.get("/api/logs", async (c) => {
  const kv = c.env.CTYUN_KV;
  if (!kv) return c.json({ error: "未绑定 KV" }, 500);
  const logs = await getLogs(kv, 200);
  return c.json({ logs });
});

// ---- 账号增删改 ----
app.post("/api/accounts", async (c) => {
  const kv = c.env.CTYUN_KV;
  const body = await c.req.json().catch(() => ({}));
  if (!body.user || !body.password) {
    return c.json({ error: "user 和 password 必填" }, 400);
  }
  const item = await addAccount(kv, body);
  return c.json({
    ok: true,
    account: {
      id: item.id,
      name: item.name,
      user: item.user,
      hasPassword: !!item.password,
      deviceCode: item.deviceCode ? "已设置" : "未设置",
    },
  });
});

app.put("/api/accounts/:id", async (c) => {
  const kv = c.env.CTYUN_KV;
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const a = await updateAccount(kv, id, body);
  if (!a) return c.json({ error: "账号不存在" }, 404);
  return c.json({
    ok: true,
    account: {
      id: a.id,
      name: a.name,
      user: a.user,
      hasPassword: !!a.password,
      deviceCode: a.deviceCode ? "已设置" : "未设置",
    },
  });
});

app.delete("/api/accounts/:id", async (c) => {
  const kv = c.env.CTYUN_KV;
  const id = c.req.param("id");
  const ok = await deleteAccount(kv, id);
  if (!ok) return c.json({ error: "账号不存在" }, 404);
  return c.json({ ok: true });
});

// ---- 保活设置 ----
app.post("/api/settings", async (c) => {
  const kv = c.env.CTYUN_KV;
  const body = await c.req.json().catch(() => ({}));
  const sec = await setKeepAlive(kv, body.keepAliveSeconds);
  return c.json({ ok: true, keepAliveSeconds: sec });
});

// ---- 清空日志（回收 KV 空间）----
app.post("/api/logs/clear", async (c) => {
  const kv = c.env.CTYUN_KV;
  if (!kv) return c.json({ error: "未绑定 KV" }, 500);
  await kv.delete("logs");
  return c.json({ ok: true });
});

// ---- KV 各键占用诊断 ----
app.get("/api/kv/stats", async (c) => {
  const kv = c.env.CTYUN_KV;
  if (!kv) return c.json({ error: "未绑定 KV" }, 500);
  let listed = [];
  try {
    const r = await kv.list();
    listed = r.keys || [];
  } catch {
    listed = [];
  }
  const stats = [];
  for (const k of listed) {
    try {
      const v = await kv.get(k.name);
      stats.push({ name: k.name, bytes: v ? v.length : 0 });
    } catch {
      stats.push({ name: k.name, bytes: -1 });
    }
  }
  stats.sort((a, b) => b.bytes - a.bytes);
  return c.json({ stats });
});

// ---- 立即运行（异步，结果看日志面板）----
app.post("/api/run", async (c) => {
  const env = c.env;
  c.executionCtx.waitUntil(runAll(env, "manual"));
  return c.json({ ok: true, started: true, message: "保活任务已启动，请查看日志面板" });
});

// ---- 核心：跑全部账号保活 ----
// Cron 每分钟触发，若每轮都把日志写 KV 会迅速打满免费版 KV 写入额度(1000/天)。
// 因此 Cron 运行只打 console 日志（wrangler tail 可见），仅「手动运行」才把日志写进 KV 供网页查看。
// lastRun 对 Cron 节流（≥10 分钟才写一次），进一步压低写入量。
export async function runAll(env, trigger) {
  const kv = env.CTYUN_KV;
  if (!kv) return { ok: false, error: "未绑定 KV 命名空间 CTYUN_KV" };

  const logger = new RunLog();
  const log = (m) => logger.info(m);
  const writeLogsToKv = trigger === "manual";
  const flush = async () => {
    const entries = logger.drain();
    if (writeLogsToKv && entries.length) await appendLogs(kv, entries);
  };

  const cfg = await loadConfig(kv);
  const accounts = cfg.accounts || [];
  const keepAliveSeconds = Math.max(10, cfg.keepAliveSeconds || 60);

  log(`开始保活（触发=${trigger}，账号数=${accounts.length}，时长=${keepAliveSeconds}s）`);
  if (writeLogsToKv) await flush();

  const results = [];
  for (const acc of accounts) {
    if (!acc.user || !acc.password) {
      results.push({ user: acc.user || "(未知)", ok: false, error: "缺少 user/password" });
      continue;
    }
    const deviceCode = await resolveDeviceCode(kv, acc);
    const api = new CtYunApi(deviceCode, kv, log);
    const r = await runAccount(api, acc, keepAliveSeconds, log);
    results.push(r);
    if (writeLogsToKv) await flush();
  }

  const summary = {
    trigger,
    ts: Date.now(),
    keepAliveSeconds,
    accountCount: accounts.length,
    results,
  };
  log("本轮保活结束");
  if (writeLogsToKv) await flush();

  // lastRun：手动运行必写；Cron 节流，避免每日 KV 写入超免费额度
  let writeLastRun = true;
  if (trigger === "cron") {
    const metaRaw = await kv.get("lastRunMeta");
    const last = metaRaw ? JSON.parse(metaRaw).ts || 0 : 0;
    if (Date.now() - last < 10 * 60 * 1000) writeLastRun = false;
  }
  if (writeLastRun) {
    await setLastRun(kv, summary);
    await kv.put("lastRunMeta", JSON.stringify({ ts: Date.now() }));
  }
  return summary;
}

// Workers 入口：Hono 处理 HTTP，scheduled 处理 Cron
export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAll(env, "cron"));
  },
};
