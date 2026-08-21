// 深度体检：adminHtml 内嵌脚本的转义安全 + 语法正确性
import { adminHtml } from "../src/web.js";

const m = adminHtml.match(/<script>([\s\S]*?)<\/script>/);
const js = m[1];

// 1. 列出脚本里所有反斜杠序列（模板字符串会把 \n \t \' \" 等转成真实字符）
const seqs = js.match(/\\./g) || [];
const counts = {};
for (const s of seqs) counts[s] = (counts[s] || 0) + 1;
console.log("内嵌脚本中的反斜杠序列:", JSON.stringify(counts));

// 2. 语法校验
try {
  new Function(js);
  console.log("PASS: 内嵌脚本语法正确");
} catch (e) {
  console.log("FAIL: 语法错误 →", e.message);
  process.exit(1);
}

// 3. 危险转义审计：这些序列在输出中会被模板字符串变换
const dangerous = { "\\n": "换行符(断字符串)", "\\r": "回车(断字符串)", "\\'": "单引号(提前闭合字符串)", '\\"': "双引号", "\\t": "制表符(无害但注意)" };
let hasDanger = false;
for (const [seq, why] of Object.entries(dangerous)) {
  if (counts[seq]) {
    hasDanger = true;
    console.log(`FAIL: 存在 ${JSON.stringify(seq)} → ${why}，共 ${counts[seq]} 处`);
  }
}
if (!hasDanger) console.log("PASS: 无危险转义序列");

// 4. 关键交互函数存在性
const checks = [
  ["loginBtn onclick 绑定", /loginBtn'\)\.onclick/],
  ["runNow 绑定", /runBtn'\)\.onclick/],
  ["split 分行逻辑存在", /split\(String\.fromCharCode\(10\)\)/],
];
let ok = true;
for (const [name, re] of checks) {
  const found = re.test(js);
  if (!found) ok = false;
  console.log((found ? "PASS" : "FAIL") + ": " + name);
}
process.exit(ok && !hasDanger ? 0 : 1);
