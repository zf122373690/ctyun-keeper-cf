// 本地登录流程回归测试：mock KV + 真实 Hono app
// 验证：1) 无 token 401；2) 正确 token 200；3) /api/state 不再含 status/lastRun；
//       4) /api/snapshot 接口可用且不崩溃；5) 页面 HTML 完整
import http from "node:http";
import worker from "../src/index.js";

const TOKEN = "test-admin-token-123";

// ---- mock KV（仅保留必要键：config / session；不含任何 status/lastRun 键）----
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
  // session 有效（bondedDevice=true），但 getDesktopList 会因无真实后端而失败
  store.set("session:13800138000", JSON.stringify({ userId: 1, tenantId: "t", secretKey: "k", bondedDevice: true, loginTs: Date.now() }));
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
  check("页面含刷新状态按钮", html.includes("刷新状态"));

  // 2. 无 token → 401
  r = await fetch(base + "/api/state");
  let j = await r.json().catch(() => ({}));
  check("无 token 请求 /api/state 返回 401", r.status === 401, j.error || "");

  // 3. 错误 token → 401「未授权」
  r = await fetch(base + "/api/state", { headers: { Authorization: "Bearer wrong-token" } });
  j = await r.json().catch(() => ({}));
  check("错误 token 返回 401 且提示「未授权」", r.status === 401 && /未授权/.test(j.error || ""), j.error || "");

  // 4. 正确 token → 200（/api/state 不再含 status/lastRun/pcSummary）
  r = await fetch(base + "/api/state", { headers: { Authorization: "Bearer " + TOKEN } });
  j = await r.json().catch(() => ({}));
  check("正确 token 返回 200", r.status === 200);
  check("返回 accounts 数组", Array.isArray(j.accounts) && j.accounts.length === 1);
  check("/api/state 不再返回 status 字段", j.accounts?.[0]?.status === undefined);
  check("/api/state 不再返回 lastRun/pcSummary", j.lastRun === undefined && j.pcSummary === undefined);

  // 5. /api/snapshot 接口可用且不崩溃（无真实桌面列表时返回合理结构）
  r = await fetch(base + "/api/snapshot", { headers: { Authorization: "Bearer " + TOKEN } });
  let s = await r.json().catch(() => ({}));
  check("/api/snapshot 返回 200", r.status === 200);
  check("/api/snapshot 含 accounts 数组", Array.isArray(s.accounts) && s.accounts.length === 1);
  check("/api/snapshot 含 pcSummary", s.pcSummary && typeof s.pcSummary.total === "number");

  // 6. KV stats
  r = await fetch(base + "/api/kv/stats", { headers: { Authorization: "Bearer " + TOKEN } });
  check("kv/stats 200", r.status === 200);

  console.log(results.join("\n"));
  const fails = results.filter((x) => x.startsWith("FAIL")).length;
  console.log(fails === 0 ? "\n全部通过 ✓" : `\n${fails} 项失败 ✗`);
  server.close();
  process.exit(fails === 0 ? 0 : 1);
});
