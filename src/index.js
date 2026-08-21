// index.js - Cloudflare Workers 入口
// Cron 定时触发保活；HTTP 提供手动触发与状态查看。

import { loadConfig, resolveDeviceCode } from "./config.js";
import { CtYunApi, runAccount } from "./ctyun.js";

export default {
  // Cron 触发（由 wrangler.toml [triggers] 配置）
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAll(env, "cron"));
  },

  // HTTP 触发：GET /run 手动保活，其余返回说明
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/run") {
      const result = await runAll(env, "manual");
      return new Response(JSON.stringify(result, null, 2), {
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    if (url.pathname === "/health") {
      return new Response("ok", { headers: { "content-type": "text/plain" } });
    }
    return new Response(
      "ctyun-keeper-cf 已部署。\n" +
        "GET /run   手动触发一次保活\n" +
        "GET /health 健康检查\n" +
        "账号请配置在 KV 命名空间 CTYUN_KV 的 'config' 键（JSON）。",
      { headers: { "content-type": "text/plain; charset=utf-8" } }
    );
  },
};

async function runAll(env, trigger) {
  const kv = env.CTYUN_KV;
  if (!kv) {
    return { ok: false, error: "未绑定 KV 命名空间 CTYUN_KV" };
  }
  const config = await loadConfig(kv);
  const accounts = config.accounts || [];
  const keepAliveSeconds = Math.max(10, config.keepAliveSeconds || 60);
  const logs = [];
  const log = (m) => {
    logs.push(m);
    console.log(m);
  };

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

  return {
    trigger,
    keepAliveSeconds,
    accountCount: accounts.length,
    results,
    logs,
  };
}
