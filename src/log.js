// log.js - 执行日志采集器（纯内存，不落盘）
//
// 设计说明：日志只用于实时展示（手动运行时经 /api/run 流式推到网页）与
// console（wrangler tail 可见），**绝不写入 KV**，以免打满免费版 KV 写入额度。
// RunLog 仅作可选的内存采集器，runAll 实际通过回调 logFn 直接推送，无需落盘缓冲。

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

  // 取出并清空当前缓冲（仅用于内存收集，不写 KV）
  drain() {
    const e = this.entries;
    this.entries = [];
    return e;
  }
}
