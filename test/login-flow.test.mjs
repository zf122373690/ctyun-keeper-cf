// 本地登录流程回归测试：mock KV + 真实 Hono app
// 验证：1) 无 token 401；2) 正确 token 200；3) 旧格式 status 数据不炸；4) 页面 HTML 完整
import http from "node:http";
import worker from "../src/index.js";

const TOKEN = "test-admin-token-123";

// ---- mock KV（模拟线上数据，含旧格式 status:<user>）----
function mockKV() {
  const store = new Map();
  store.set(
    "config",
    JSON.stringify({
      keepAliveSeconds: 55,
      accounts: [
        { id: "a1", name: "测试账号", user: "13800138000", password: "pw", deviceCode: "" },
      ],
    })
  );
  store.set("session:13800138000", JSON.stringify({ userId: 1, tenantId: "t", secretKey: "k", bondedDevice: true }));
  // 旧格式：没有 onlineSince / keepAliveStart 字段（老版本写入的数据）
  store.set(
    "status:13800138000",
    JSON.stringify({
      ts: Date.now() - 3600000,
      user: "13800138000",
      ok: true,
      error: "",
      desktops: [
        { desktopId: "d1", desktopCode: "PC-001", name: "云电脑1", status: "运行中", online: true, keptAlive: true },
        { desktopId: "d2", desktopCode: "PC-002", name: "云电脑2", status: "已停止", online: false, keptAlive: false },
      ],
    })
  );
  store.set("lastRun", JSON.stringify({ trigger: "cron", ts: Date.now(), results: [] }));
  store.set("lastRunMeta", JSON.stringify({ ts: Date.now() }));
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, String(v)); },
    async delete(k) { store.delete(k); },
    async list() { return { keys: [...store.keys()].map((name) => ({ name })) }; },
  };
}

const env = { CTYUN_KV: mockKV(), ADMIN_TOKEN: TOKEN };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const resp = await worker.fetch(
    new Request(url, { method: req.method, headers, body }),
    env,
    { waitUntil: () => {} }
  );
  res.writeHead(resp.status, Object.fromEntries(resp.headers));
  res.end(Buffer.from(await resp.arrayBuffer()));
});

server.listen(18787, async () => {
  const base = "http://localhost:18787";
  const results = [];
  const check = (name, cond, extra = "") => {
    results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  → " + extra : ""}`);
  };

  // 1. 页面能打开
  let r = await fetch(base + "/");
  const html = await r.text();
  check("GET / 返回 200", r.status === 200);
  check("页面含登录卡片", html.includes("管理后台登录"));
  check("页面含云电脑状态面板", html.includes("云电脑状态"));
  check("页面含 pcBody 容器", html.includes('id="pcBody"'));

  // 2. 无 token → 401
  r = await fetch(base + "/api/state");
  let j = await r.json().catch(() => ({}));
  check("无 token 请求 /api/state 返回 401", r.status === 401, j.error || "");

  // 3. 错误 token → 401「未授权」
  r = await fetch(base + "/api/state", { headers: { Authorization: "Bearer wrong-token" } });
  j = await r.json().catch(() => ({}));
  check("错误 token 返回 401 且提示「未授权」", r.status === 401 && /未授权/.test(j.error || ""), j.error || "");

  // 4. 正确 token → 200（含旧格式 status 数据）
  r = await fetch(base + "/api/state", { headers: { Authorization: "Bearer " + TOKEN } });
  j = await r.json().catch(() => ({}));
  check("正确 token 返回 200", r.status === 200);
  check("返回 accounts 数组", Array.isArray(j.accounts) && j.accounts.length === 1);
  check("账号带 status.desktops", j.accounts?.[0]?.status?.desktops?.length === 2);
  check("pcSummary 统计正确(共2在线1)", j.pcSummary?.total === 2 && j.pcSummary?.online === 1, JSON.stringify(j.pcSummary));

  // 5. 旧格式缺 onlineSince 时兼容（不 500）
  const d0 = j.accounts?.[0]?.status?.desktops?.[0] || {};
  check("旧格式桌面 onlineSince 为空不报错", d0.onlineSince === null || d0.onlineSince === undefined);

  // 6. KV stats
  r = await fetch(base + "/api/kv/stats", { headers: { Authorization: "Bearer " + TOKEN } });
  check("kv/stats 200", r.status === 200);

  console.log(results.join("\n"));
  const fails = results.filter((x) => x.startsWith("FAIL")).length;
  console.log(fails === 0 ? "\n全部通过 ✓" : `\n${fails} 项失败 ✗`);
  server.close();
  process.exit(fails === 0 ? 0 : 1);
});
