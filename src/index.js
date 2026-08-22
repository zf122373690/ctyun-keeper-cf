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
// 设计要点（极简 KV 写入原则）：
//   KV 中**只持久化功能必需的 3 类键**：
//     1) config（账号/密码/保活时长）—— 用户配置，不能丢
//     2) device:<user>（设备码）—— 一次性生成，几乎不写
//     3) session:<user>（登录态缓存，含 loginTs）—— 避免反复 OCR 验证码
//   所有展示数据（运行摘要、云电脑状态卡片）**一律不写 KV**，
//   改为页面打开时实时查询（/api/snapshot，复用缓存会话拉桌面列表，不保活、不写 KV）。
//   日志只打 console（wrangler tail 可见），手动运行时通过 /api/run 实时推到网页，
//   同样不写入 KV。

import { Hono } from "hono";
import { adminHtml } from "./web.js";
import {
  CtYunApi,
  runAccount,
  queryStatus,
} from "./ctyun.js";
import {
  loadConfig,
  resolveDeviceCode,
  addAccount,
  updateAccount,
  deleteAccount,
  setKeepAlive,
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
// 仅返回账号列表 + 设置 + cron 表达式 + 服务器时间。
// 云电脑实时状态由 /api/snapshot 提供（不写 KV，页面打开时拉取）。
app.get("/api/state", async (c) => {
  const kv = c.env.CTYUN_KV;
  if (!kv) return c.json({ error: "未绑定 KV 命名空间 CTYUN_KV" }, 500);
  const cfg = await loadConfig(kv);
  const accounts = cfg.accounts.map((a) => ({
    id: a.id,
    name: a.name,
    user: a.user,
    hasPassword: !!a.password,
    password: a.password ? "********" : "",
    deviceCode: a.deviceCode ? "已设置" : "未设置",
  }));
  return c.json({
    keepAliveSeconds: cfg.keepAliveSeconds,
    accounts,
    cronExpr: (c.env.CRON_EXPR || "*/1 * * * *"),
    serverTime: Date.now(),
  });
});

// ---- 实时状态快照（不写 KV）----
// 对每账号复用缓存会话拉桌面列表，构造状态卡片。会话失效且无密码时返回错误提示。
// 不执行开机/连接/WebSocket 保活，不消耗 OCR（除非必须登录）。
app.get("/api/snapshot", async (c) => {
  const kv = c.env.CTYUN_KV;
  if (!kv) return c.json({ error: "未绑定 KV 命名空间 CTYUN_KV" }, 500);
  const cfg = await loadConfig(kv);
  const accounts = cfg.accounts || [];
  const results = [];
  let totalPc = 0;
  let onlinePc = 0;
  for (const acc of accounts) {
    if (!acc.user || !acc.password) {
      results.push({ user: acc.user || "(未知)", ok: false, error: "缺少 user/password", desktops: [] });
      continue;
    }
    const deviceCode = await resolveDeviceCode(kv, acc);
    const api = new CtYunApi(deviceCode, kv, () => {});
    const r = await queryStatus(api, acc, () => {});
    const ds = r.desktops || [];
    totalPc += ds.length;
    onlinePc += ds.filter((d) => d.online).length;
    results.push(r);
  }
  return c.json({
    ts: Date.now(),
    pcSummary: { total: totalPc, online: onlinePc },
    accounts: results,
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

// ---- KV 各键占用诊断（仅 config / device:* / session:*，不含任何日志或状态快照）----
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
//   若提供 logFn，则同时实时推到页面。**日志绝不写入 KV**。
//   KV 中只写功能必需的 3 类键：config / device:<user> / session:<user>。
//   运行结果和云电脑状态均不写 KV（页面通过 /api/snapshot 实时拉取）。
export async function runAll(env, trigger, logFn) {
  const kv = env.CTYUN_KV;
  if (!kv) return { ok: false, error: "未绑定 KV 命名空间 CTYUN_KV" };

  const pad = (n) => String(n).padStart(2, "0");
  const stamp = () => {
    const d = new Date();
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  const log = (m) => {
    const line = `[${stamp()}] ${m}`;
    console.log(line);
    if (logFn) {
      try {
        logFn(line);
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
