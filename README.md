# ctyun-keeper-cf

天翼云电脑（Web 版）纯协议保活，移植到 **Cloudflare Workers**（Hono 框架）。

- 协议：REST 登录 + WebSocket(wss) 保活 + RSA-OAEP / REDQ 校验，全走标准 Workers 能力（无需原始 TCP）。
- 管理：**自带网页后台**，可随时增删改账号、一键手动保活、实时查看执行日志。
- 状态：**「云电脑状态」面板**以小卡片展示每台云电脑：台数汇总、运行状态（在线/离线/其他）、是否处于保活中、本次**保活始于**何时、以及**已在线时长**（前端每秒实时跳动）。状态跨运行累计「已在线」起点，页面每 30 秒自动刷新。
- 存储：账号配置/会话/状态存 KV，**不进 git**；后台用 `ADMIN_TOKEN` 保护。
- 日志：**只在页面实时展示，不写入 KV**（避免打满免费版 KV 写入额度）。

## 目录结构

```
src/
  crypto.js    WebCrypto SHA-256 + 纯 JS MD5 + RSA-OAEP(SHA-1) 空消息加密
  framing.js   SendInfo 二进制帧 + REDQ 加密响应器
  ctyun.js     REST 登录/桌面/开机/连接 + WebSocket 保活(含重连) + 会话缓存
  config.js    账号 CRUD(存 KV) + deviceCode 解析 + 脱敏
  log.js       执行日志采集（纯内存，不落盘）
  web.js       暗色主题管理后台单页
  index.js     Hono 路由 + ADMIN_TOKEN 鉴权 + /api + Cron 入口
test/          unit test (crypto + store)，node test 运行
wrangler.toml  KV 绑定(CTYUN_KV) + Cron(*/1 * * * *) 已预填
config.example.json  KV 里 config 键的样例
```

## 一、部署（首次）

> 前置：本机已装 Node，且 `wrangler login` 过（有 Cloudflare 账号权限）。

```bash
cd ctyun-keeper-cf
npm install                       # 安装依赖（hono 等）

# 1) KV 命名空间：已创建过，id 已写进 wrangler.toml 的 CTYUN_KV，可跳过。
#    若需新建：wrangler kv namespace create CTYUN_KV，再把返回的 id 填进 wrangler.toml
wrangler kv namespace create CTYUN_KV   # 可选，重复创建无害

# 2) 后台访问令牌（必填！任意长随机串，不是云电脑账号密码）
wrangler secret put ADMIN_TOKEN
#   不会编随机串？用：openssl rand -base64 24

# 3) 部署
wrangler deploy
```

部署成功后控制台/输出会给出地址：`https://ctyun-keeper-cf.<你的子域>.workers.dev/`

## 二、在网页后台添加账号

1. 浏览器打开上面的地址，输入 `ADMIN_TOKEN` 解锁（暗色登录卡片）。
2. **添加账号**：填 名称 / 账号（手机号）/ 密码 / 设备码。
   - `deviceCode` 留空会自动生成并持久化；但**建议先在真实客户端用同一个设备码绑定过**，
     否则无头环境收不到短信验证码、该账号会被跳过。
3. **立即运行一次**：点按钮触发保活，下方日志面板**以响应流（SSE 式）实时滚动展示**。
   日志**全程只在页面上展示，不写入 KV**——不会占用 KV 写入额度。
4. **Cron 每分钟自动跑保活**：Cron 运行的日志**只打 `console.log`**（用 `wrangler tail` 查看）。
   因为通常无人在线、且页面日志不落盘，Cron 不推送也不写 KV，把写入额度留给真正的持久化数据。
5. **KV 占用**：设置面板里有「KV 占用 X KB · N 键」标签，可直观看到账号/会话/状态各键大小。
   「执行日志」面板右上角有 **清屏** 按钮（仅清空当前页面显示，不影响任何 KV 数据）。

> 账号密码只在 KV 与后端之间传输，网页不持久化明文；编辑账号时密码留空=保持不变。

### KV 写入量说明（重要）

KV 中**只持久化必要信息**，刻意不存日志：

- `config`：账号配置（账号、密码、设备码、保活时长）—— 仅在增删改账号时写入。
- `session:<user>`：登录会话缓存——仅登录成功后写入，失效才重登（且复用校验结果不重复请求）。
- `status:<user>`：云电脑状态快照（每台云电脑的台数/状态/是否在线/是否保活）——手动运行必写；**Cron 与 `lastRun` 共用每 10 分钟节流**。供「云电脑状态」面板直接读取。
- `lastRun` / `lastRunMeta`：最近一次运行摘要——手动运行必写；**Cron 节流为每 10 分钟才写一次**。

日志（每次保活的逐行输出）**完全不写 KV**，手动运行时通过 `/api/run` 的 HTTP 响应流实时推到页面。
这样 KV 的每日写入量被压到极低（仅账号变更 + 每 10 分钟一次 `lastRun`），远离免费版 1000 次/天额度。
若想看 Cron 实时日志，用 `wrangler tail`；或把 Cron 关掉、仅用手动触发。

## 三、更新代码后重新部署

仓库在 GitHub 上已是公开（或私有），每次改完代码都要 **先拉最新、再部署**，否则 CF 上跑的是旧版：

```bash
git pull            # 拉取最新（含本仓库的历次修复）
wrangler deploy     # 重新部署
```

> 关键坑：本地目录和仓库不同步时，从旧目录 `wrangler deploy` 会把旧代码推上去，
> 表现为"明明修过却还是报错"。务必 `git pull` 后再 `deploy`。

## 四、本地开发 / 测试

```bash
wrangler dev                      # 本地起服务，访问 http://localhost:8787/
node test                         # 跑单元测试（crypto + store，全部通过）
node --check src/*.js             # 单文件语法校验
```

## 五、排错记录（搭建过程中已修复的坑）

下面这些 bug 都已修复并推送到仓库，列出来方便排查同类问题：

| 现象 | 根因 | 修复 |
| --- | --- | --- |
| `ReferenceError: bytesToBase64 is not defined` | `ctyun.js` import 漏了 `bytesToBase64`（验证码图片转 base64 用到） | 补进 import |
| 验证码 OCR 恒定返回 `JQh8`、8 次全一样 | multipart 分隔符少了 `--` 前缀（应为 `------WebKit...` 而非 `----WebKit...`），OCR 没解析到图片；且缺 `User-Agent`/`ctg-*`/`referer` 头 | 修正分隔符 + 补齐请求头 |
| 每个 Cron 周期都"开始登录"、反复打验证码 | `runAccount` 用 `test.code === 0` 判会话有效，但 `getDesktopList()` 返回的是**数组**（无 `.code` 字段），恒为 false → 缓存被判失效 | 改为 `test !== null` 判有效，并复用校验结果省一次请求 |

验证用到的单元测试：`test/crypto.test.mjs`（MD5/SHA-256 向量、RSA-OAEP 往返、SendInfo 帧、合成 REDQ）、`test/store.test.mjs`（账号 CRUD + RunLog 采集）。

## 六、已知风险 / 注意

- **deviceCode 必须先绑定**：无头环境无法输入短信验证码，未绑定设备的账号会被跳过。先在真实客户端用同一个 `deviceCode` 绑定过再上云。
- **登录依赖第三方打码服务**（`orc.1999111.xyz`）：若不可用则登录失败。代码已加 KV 会话缓存——登录成功后复用会话、仅在失效时重登，把不稳定的打码环节降到最低。
- **Cron 频率**：默认每分钟一次（`*/1 * * * *`）。高频 Cron + 较长保活窗口在标准版够用（单账号保活窗口建议 ≤ 55s，与 Cron 间隔匹配）；多账号或超长窗口可能触达 CPU/时长限制，按需升级 Workers 付费版。
- **WebSocket 不能带自定义请求头**：Workers 的 `WebSocket` 客户端无法设置 `Origin`/`ctg-*` 头（REST 部分可以，WS 不行）。实测 ctyun WS 服务端容忍缺 Origin，但不同账号/服务端可能行为不同。

## 七、仓库状态

- 公开仓库：https://github.com/zf122373690/ctyun-keeper-cf
- 真实账号/密码只存 Cloudflare KV（`config` 键），**不进 git**；仓库内 `config.example.json` 仅为占位符。
- `ADMIN_TOKEN` 是后台访问令牌（经 `wrangler secret` 注入），不出现在代码里。
