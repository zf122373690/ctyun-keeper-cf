// store.test.mjs - 验证 config.js 的账号 CRUD + log.js 的环形日志
// 使用内存版 KV mock，无需联网或 Cloudflare 环境。
import assert from "node:assert";

// 内存 KV mock
function makeKv() {
  const m = new Map();
  return {
    async get(k) {
      return m.has(k) ? m.get(k) : null;
    },
    async put(k, v) {
      m.set(k, String(v));
    },
    _map: m,
  };
}

const { loadConfig, addAccount, updateAccount, deleteAccount, setKeepAlive, maskAccounts, getLastRun } =
  await import("../src/config.js");
const { RunLog, appendLogs, getLogs } = await import("../src/log.js");

let passed = 0;
function ok(name) {
  passed++;
  console.log("  ✓ " + name);
}

// ---- 空配置 ----
{
  const kv = makeKv();
  const cfg = await loadConfig(kv);
  assert.strictEqual(cfg.accounts.length, 0);
  assert.strictEqual(cfg.keepAliveSeconds, 60);
  ok("空配置返回默认结构");
}

// ---- 新增账号会自动获得 id ----
let id1;
{
  const kv = makeKv();
  const a = await addAccount(kv, { name: "店铺A", user: "13800000000", password: "pw1" });
  assert.ok(a.id, "应有 id");
  id1 = a.id;
  const cfg = await loadConfig(kv);
  assert.strictEqual(cfg.accounts.length, 1);
  assert.strictEqual(cfg.accounts[0].password, "pw1");
  ok("新增账号并生成 id");
}

// ---- 脱敏：密码不回传 ----
{
  const kv = makeKv();
  await addAccount(kv, { name: "店铺A", user: "13800000000", password: "pw1" });
  const cfg = await loadConfig(kv);
  const masked = maskAccounts(cfg);
  assert.strictEqual(masked[0].password, "********");
  assert.strictEqual(masked[0].hasPassword, true);
  ok("maskAccounts 脱敏密码");
}

// ---- 修改：密码留空保持不变 ----
{
  const kv = makeKv();
  const a = await addAccount(kv, { user: "u1", password: "old" });
  const updated = await updateAccount(kv, a.id, { name: "新名", password: "" });
  assert.strictEqual(updated.password, "old");
  assert.strictEqual(updated.name, "新名");
  ok("updateAccount 密码留空=不变");
}

// ---- 修改：新密码生效 ----
{
  const kv = makeKv();
  const a = await addAccount(kv, { user: "u1", password: "old" });
  const updated = await updateAccount(kv, a.id, { password: "new" });
  assert.strictEqual(updated.password, "new");
  ok("updateAccount 新密码生效");
}

// ---- 删除 ----
{
  const kv = makeKv();
  const a = await addAccount(kv, { user: "u1", password: "p" });
  const d1 = await deleteAccount(kv, a.id);
  assert.strictEqual(d1, true);
  const cfg = await loadConfig(kv);
  assert.strictEqual(cfg.accounts.length, 0);
  const d2 = await deleteAccount(kv, a.id);
  assert.strictEqual(d2, false);
  ok("deleteAccount 删除与重复删除");
}

// ---- 不存在的 id 返回 null ----
{
  const kv = makeKv();
  const r = await updateAccount(kv, "nope", { name: "x" });
  assert.strictEqual(r, null);
  ok("updateAccount 未知 id 返回 null");
}

// ---- 保活时长设置与下限 ----
{
  const kv = makeKv();
  const s1 = await setKeepAlive(kv, 30);
  assert.strictEqual(s1, 30);
  const s2 = await setKeepAlive(kv, 1); // 低于下限应被钳到 10
  assert.strictEqual(s2, 10);
  ok("setKeepAlive 与下限钳制");
}

// ---- 环形日志：封顶 300 ----
{
  const kv = makeKv();
  const big = [];
  for (let i = 0; i < 350; i++) big.push({ ts: Date.now(), level: "info", msg: "line" + i });
  await appendLogs(kv, big, 300);
  const got = await getLogs(kv, 400);
  assert.strictEqual(got.length, 300, "应裁剪到 300");
  assert.strictEqual(got[0].msg, "line50", "保留最近的部分");
  ok("appendLogs/getLogs 环形裁剪");
}

// ---- RunLog 采集 + drain ----
{
  const logger = new RunLog();
  logger.info("a");
  logger.warn("b");
  assert.strictEqual(logger.entries.length, 2);
  const drained = logger.drain();
  assert.strictEqual(drained.length, 2);
  assert.strictEqual(logger.entries.length, 0);
  ok("RunLog 采集与 drain");
}

console.log("\nstore 测试全部通过：" + passed + " 项");
