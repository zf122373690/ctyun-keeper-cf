// index.js - Cloudflare Workers 入口（Hono 框架）
// 路由：
//   GET  /              管理后台（暗色主题单页）
//   GET  /api/state     仪表盘数据（账号列表/设置/最近一次运行）
//   GET  /api/kv/stats  KV 各键占用诊断（仅账号/会话/状态，不含日志）
//   POST /api/accounts  新增账号
//   PUT  /api/accounts/:id  修改账号（密码留空=不变）
//   DELETE /api/accounts/:id 删除账号
//   POST /api/settings  修改保活时长
//   POST /api/run       立即触发一次保活（流式实时推送日志到页面）
//   GET  /health        健康检查
// Cron（wrangler.toml [triggers]）定时触发保活。
// 所有 /api/* 需用 Bearer ADMIN_TOKEN 鉴权（wrangler secret put ADMIN_TOKEN）。
//
// 设计要点：
//   日志只打 console（wrangler tail 可见），且手动运行时通过 /api/run 的
//   响应流实时推到网页展示，**不写入 KV**（避免打满免费版 KV 写入额度）。
//   KV 中只持久化必要信息：账号配置(config)、登录会话(session:<user>)、
//   设备码缓存、最近一次运行摘要(lastRun)。

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
  getLastRun,
  setLastRun,
  getAccountStatus,
  setAccountStatus,
} from "./config.js";

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
  const lastRun = await getLastRun(kv);
  const accounts = [];
  let totalPc = 0;
  let onlinePc = 0;
  for (const a of cfg.accounts) {
    const masked = {
      id: a.id,
      name: a.name,
      user: a.user,
      hasPassword: !!a.password,
      password: a.password ? "********" : "",
      deviceCode: a.deviceCode ? "已设置" : "未设置",
    };
    const st = await getAccountStatus(kv, a.user);
    if (st) {
      masked.status = st;
      const ds = st.desktops || [];
      totalPc += ds.length;
      onlinePc += ds.filter((d) => d.online).length;
    }
    accounts.push(masked);
  }
  return c.json({
    keepAliveSeconds: cfg.keepAliveSeconds,
    accounts,
    lastRun,
    pcSummary: { total: totalPc, online: onlinePc },
  });
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

// ---- KV 各键占用诊断（只统计账号/会话/状态，不含日志）----
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

// ---- 立即运行（流式实时推送日志到页面，日志不写入 KV）----
app.post("/api/run", async (c) => {
  const env = c.env;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (m) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(m + "\n"));
        } catch (_) {
          /* 客户端断开后忽略 */
        }
      };
      try {
        await runAll(env, "manual", send);
      } catch (e) {
        send("ERROR: " + (e && e.message ? e.message : String(e)));
      } finally {
        closed = true;
        try {
          controller.close();
        } catch (_) {}
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
});

// ---- 核心：跑全部账号保活 ----
// 日志策略（重要）：
//   logFn 为可选回调（手动运行时由 /api/run 传入，逐行实时推到网页）。
//   无论哪种触发，日志都只打 console（wrangler tail 可见）；
//   若提供 logFn，则同时实时推到页面。**日志绝不写入 KV**，
//   这样不会打满免费版 KV 的写入额度（1000 次/天）。
//   KV 中只写必要信息：账号配置、登录会话、设备码、最近一次运行摘要(lastRun)。
export async function runAll(env, trigger, logFn) {
  const kv = env.CTYUN_KV;
  if (!kv) return { ok: false, error: "未绑定 KV 命名空间 CTYUN_KV" };

  const log = (m) => {
    console.log(m);
    if (logFn) {
      try {
        logFn(m);
      } catch (_) {
        /* 忽略推送异常 */
      }
    }
  };

  const cfg = await loadConfig(kv);
  const accounts = cfg.accounts || [];
  const keepAliveSeconds = Math.max(10, cfg.keepAliveSeconds || 60);

  log(`开始保活（触发=${trigger}，账号数=${accounts.length}，时长=${keepAliveSeconds}s）`);

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
  }

  const summary = {
    trigger,
    ts: Date.now(),
    keepAliveSeconds,
    accountCount: accounts.length,
    results,
  };
  log("本轮保活结束");

  // lastRun：轻量状态快照（非日志流），手动运行必写；
  // Cron 节流（≥10 分钟才写一次），进一步压低 KV 写入量。
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

  // 云电脑状态（账号信息，允许写入 KV）：手动运行必写；
  // Cron 与 lastRun 共用节流（≥10 分钟一次），避免打满 KV 写入额度。
  const writeStatus = trigger === "manual" || writeLastRun;
  if (writeStatus) {
    for (const r of results) {
      const payload = {
        ts: summary.ts,
        user: r.user,
        ok: !!r.ok,
        error: r.error || "",
        desktops: Array.isArray(r.desktops) ? r.desktops : [],
      };
      if (payload.desktops.length > 0 || payload.error) {
        await setAccountStatus(kv, r.user, payload);
      }
    }
  }
  return summary;
}

// Workers 入口：Hono 处理 HTTP，scheduled 处理 Cron
export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  async scheduled(event, env, ctx) {
    // Cron 触发：日志只打 console，不推页面（通常无人在线查看），也不写 KV
    ctx.waitUntil(runAll(env, "cron", null));
  },
};
