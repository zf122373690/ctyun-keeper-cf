# ctyun-keeper-cf

天翼云电脑（Web 版）纯协议保活，移植到 **Cloudflare Workers**（Hono 框架）。

- 协议：REST 登录 + WebSocket(wss) 保活 + RSA-OAEP / REDQ 校验，全走标准 Workers 能力（无需原始 TCP）。
- 管理：**自带网页后台**，可随时增删改账号、一键手动保活、实时查看执行日志。
- 存储：账号配置与日志都存在 KV，**不进 git**；后台用 `ADMIN_TOKEN` 保护。

## 目录结构

```
src/
  crypto.js    WebCrypto SHA-256 + 纯 JS MD5 + RSA-OAEP(SHA-1) 空消息加密
  framing.js   SendInfo 二进制帧 + REDQ 加密响应器
  ctyun.js     REST 登录/桌面/开机/连接 + WebSocket 保活(含重连)
  config.js    账号 CRUD(存 KV) + deviceCode 解析 + 脱敏
  log.js       执行日志采集 + KV 环形缓冲
  web.js       暗色主题管理后台单页
  index.js     Hono 路由 + 鉴权 + API + Cron 入口
test/          单元测试(crypto + store)，node test 运行
```

## 部署

```bash
npm install                       # 安装 hono 等依赖
wrangler login
# 1) KV 命名空间（已创建则跳过，把 id 填进 wrangler.toml 的 CTYUN_KV）
wrangler kv namespace create CTYUN_KV
# 2) 后台访问令牌（必填，任意长随机串，不是云电脑账号密码）
wrangler secret put ADMIN_TOKEN
# 3) 部署
wrangler deploy
```

## 使用网页后台

1. 打开 `https://<你的子域>.workers.dev/`，输入刚设置的 `ADMIN_TOKEN` 解锁。
2. **添加账号**：填名称/账号/密码；设备码 `deviceCode` 留空会自动生成并持久化。
3. **立即运行一次**：点按钮触发保活，下方日志面板实时滚动（每 2.5s 刷新）。
4. **看历史日志/最近一次结果**：日志存 KV（封顶 300 条），随时刷新可见；Cron 定时也会持续写入。

> 账号密码只在 KV 与后端之间传输，网页不持久化明文；编辑账号时密码留空表示保持不变。

## 本地开发

```bash
wrangler dev                      # 本地起服务，访问 http://localhost:8787/
node test                         # 跑单元测试
```

## 已知风险 / 注意

- **deviceCode 必须先绑定**：无头环境无法输入短信验证码，未绑定设备的账号会被跳过。先在真实客户端用同一个 `deviceCode` 绑定过再上云。
- **登录依赖第三方打码服务**（`orc.1999111.xyz`）：若不可用则登录失败；代码已加 KV 会话缓存，登录成功后复用、失效才重登。
- **Cron 频率**：默认每分钟一次；高频 Cron + 较长保活窗口可能需要 Workers 付费版。在「保活设置」里调整时长（建议 ≤ 55s）。
- ecloud / soho 两个版本依赖原始 TCP，标准 Workers 跑不了，需 Workers+Sockets 或 Containers，暂未移植。
