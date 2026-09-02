# ctyun-keeper-cf

天翼云电脑 Web 版协议保活程序，运行在 Cloudflare Workers。

项目只负责保活，不包含积分、活动、奖励领取或自动兑换功能。程序使用 REST 登录接口获取云电脑信息，再通过 WebSocket、REDQ 加密校验和断线重连维持云电脑连接。

## 功能

- 多账号管理：账号、密码、设备码保存到 Cloudflare KV。
- 自动登录：支持验证码识别；登录成功后缓存会话，减少重复登录。
- 自动开机：云电脑不是“运行中”时尝试发送开机指令。
- 协议保活：获取连接信息后建立 WebSocket，默认每轮保持 55 秒。
- 自动调度：Cron 默认每分钟触发一次，适合连续保活。
- 网页后台：查看云电脑状态、手动执行保活、查看实时日志、修改保活时长。
- 轻量存储：日志和状态快照不写 KV；账号配置、设备码、登录会话才写入 KV。

## 运行原理和限制

每次 Cron 执行都会依次处理账号：登录或读取缓存会话、读取云电脑列表、必要时开机、获取连接信息、建立 WebSocket 并响应服务端校验帧。默认保活时长为 55 秒，下一分钟再次触发。

Cloudflare Workers 不是常驻服务器，单次执行受 CPU、请求和执行时间限制。项目采用“每分钟触发 + 每轮约 55 秒”的方式，不运行 Chromium，不打开桌面页面，也不模拟鼠标键盘。是否被天翼云服务端判定为在线，最终以服务端状态为准。

## 部署前准备

### 1. 安装 Node.js

安装 Node.js 18 或更高版本。安装完成后在 PowerShell 检查：

```powershell
node --version
npm --version
```

### 2. 安装 Wrangler

可以全局安装 Wrangler，也可以使用 `npx` 临时运行。推荐全局安装：

```powershell
npm install --global wrangler
wrangler --version
```

如果没有全局安装，下面所有 `wrangler` 命令都可以替换成 `npx wrangler`。

### 3. 登录 Cloudflare

```powershell
wrangler login
wrangler whoami
```

`wrangler login` 会打开浏览器授权。部署账号需要有 Workers 和 KV 权限。

## 首次部署

### 1. 获取代码并进入目录

```powershell
git clone https://github.com/zf122373690/ctyun-keeper-cf.git
Set-Location .\ctyun-keeper-cf
```

已有本地代码时：

```powershell
Set-Location "F:\代码开发\保活代码\ctyun-keeper-cf"
```

### 2. 安装依赖

```powershell
npm install
```

### 3. 创建或确认 KV

打开配置文件：

```powershell
Get-Content .\wrangler.toml
```

必须存在以下绑定：

```toml
[[kv_namespaces]]
binding = "CTYUN_KV"
id = "你的 KV namespace ID"
```

没有 KV 时创建：

```powershell
wrangler kv namespace create CTYUN_KV
```

把命令输出的 `id` 填入 `wrangler.toml`。`binding` 必须保持为 `CTYUN_KV`。

不要每次部署都重复创建 KV。重复创建会得到新的空命名空间，旧账号配置不会自动迁移。已有项目应继续使用原来的 KV ID。

### 4. 设置后台令牌

`ADMIN_TOKEN` 用于保护网页后台和所有 `/api/*` 接口，与天翼云账号密码无关。

PowerShell 生成随机令牌：

```powershell
$token = [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
$token
```

设置 Secret：

```powershell
wrangler secret put ADMIN_TOKEN
```

命令提示输入时粘贴令牌并回车，输入不会回显。不要把令牌或账号密码写进 Git。

### 5. 检查并部署

```powershell
npm test
node --check .\src\index.js
node --check .\src\ctyun.js
node --check .\src\config.js
node --check .\src\web.js
wrangler deploy
```

部署成功后会输出类似地址：

```text
https://ctyun-keeper-cf.<你的-subdomain>.workers.dev
```

也可以在 Cloudflare Dashboard 的 **Workers & Pages** 中打开该 Worker 查看地址。

## 首次配置账号

### 1. 打开后台

浏览器打开 Worker 地址，输入 `ADMIN_TOKEN`。令牌只保存在浏览器本地存储中，不写入 Worker KV。

### 2. 添加账号

在“添加账号”区域填写名称、天翼云账号、密码和设备码。账号通常是手机号。

设备码建议填写已经在真实天翼云客户端绑定过的 `web_device_code`，并且必须与绑定时使用的设备码一致。设备码留空时，程序会在 KV 中生成新设备码；新设备码没有短信绑定时，Workers 无法代替用户输入短信验证码，账号通常会被跳过。

编辑账号时密码留空表示保留原密码，不会清空密码。

### 3. 第一次手动保活

点击“立即运行一次”，按日志判断结果：

- `使用缓存会话`：已有有效登录会话。
- `开始登录`：会话失效，需要重新登录和识别验证码。
- `设备未绑定`：设备码没有完成真实客户端绑定。
- `已获取连接信息`：已拿到云电脑连接参数。
- `WebSocket 已连接`：本轮协议保活已建立。
- `本轮保活结束`：本轮执行完成。

首次登录可能需要等待验证码识别。登录成功后，会话写入 `session:<账号>`，后续运行会优先复用。

## Cron 自动保活

当前 `wrangler.toml` 配置为：

```toml
[triggers]
crons = ["*/1 * * * *"]
```

含义是每分钟触发一次。每轮保活默认 55 秒，下一分钟再次运行。Cron 日志不会推送到网页，而是写入 Worker 控制台。

后台设置区域会显示自动保活频率、上次 Cron 心跳、下次预计运行时间和心跳状态。为了节省 KV 写入量，`cronHeartbeat` 每 10 分钟才更新一次，不影响每分钟保活。

## 查看 Cron 日志

```powershell
wrangler tail ctyun-keeper-cf --format pretty
```

等待下一次 Cron 执行即可看到登录、开机、WebSocket、REDQ、重连和错误日志。按 `Ctrl+C` 只会停止日志查看，不会停止 Worker。

## 更新代码后重新部署

```powershell
git pull origin master
npm install
npm test
wrangler deploy
```

Secret 和 KV 不会被 `git pull` 覆盖。只要 `wrangler.toml` 中的 KV ID 不变，原账号配置和会话仍然保留。

查看部署记录：

```powershell
wrangler deployments list
```

## 本地开发和测试

运行单元测试：

```powershell
npm test
node test\login-flow.test.mjs
```

启动本地 Worker：

```powershell
wrangler dev
```

默认访问 `http://localhost:8787/`。本地开发使用 Wrangler 的本地 KV 模拟。真实账号建议只在已部署 Worker 中配置，不要把密码写入本地文件。

## KV 数据说明

项目使用以下键：

- `config`：账号、密码、设备码和保活时长。
- `device:<账号>`：未手动填写设备码时生成的稳定设备码。
- `session:<账号>`：登录会话缓存和登录时间。
- `cronHeartbeat`：每 10 分钟写入一次的 Cron 心跳时间戳。

执行日志、云电脑状态快照和前端在线时长不会写入 KV。

## 常见问题

### 页面提示未配置 `ADMIN_TOKEN`

重新设置并部署：

```powershell
wrangler secret put ADMIN_TOKEN
wrangler deploy
```

### 页面提示未绑定 `CTYUN_KV`

检查 `wrangler.toml` 是否存在 `binding = "CTYUN_KV"`，并确认 `id` 是当前 Cloudflare 账号下真实存在的 KV namespace ID，然后重新部署。

### 每次都重新登录

可能是会话失效、KV ID 改变、账号密码错误、设备码未绑定，或天翼云服务端拒绝当前设备。先查看 `wrangler tail`，再确认 KV 和设备码。

### 提示设备未绑定

在真实天翼云客户端使用同一个 `web_device_code` 完成短信绑定，再把该设备码填写到后台。Workers 没有交互式终端，不能在 Cron 中等待短信验证码。

### 云电脑显示离线或没有云电脑

先点击“刷新状态”，再点击“立即运行一次”查看完整日志。账号无云电脑资源、会话过期、连接失败或开机尚未完成，都可能造成该提示。

### WebSocket 经常断开

程序会在保活窗口内自动重连，但 Workers 无法为 WebSocket 客户端设置全部浏览器请求头。如果天翼云服务端策略变化，可能需要更新协议字段；使用 `wrangler tail` 查看具体错误。

## 安全注意

- 不要把 `ADMIN_TOKEN`、天翼云密码或 KV 导出内容提交到 GitHub。
- 后台令牌等同于管理后台密码，泄露后他人可以查看和修改账号配置。
- 不要把管理后台地址和令牌同时公开分享。
- 建议使用独立、足够长的 `ADMIN_TOKEN`，并定期更换。
- 项目依赖天翼云接口和第三方验证码识别服务，第三方接口异常时登录可能失败。

## 项目结构

```text
src/
  crypto.js       WebCrypto SHA-256、纯 JS MD5、RSA-OAEP
  framing.js      SendInfo 二进制帧和 REDQ 响应
  ctyun.js        登录、桌面列表、开机、连接、WebSocket 保活
  config.js       账号和保活配置的 KV 存储
  log.js          内存日志采集
  web.js          网页管理后台
  index.js        Hono 路由和 Cron 入口
test/
  crypto.test.mjs
  store.test.mjs
  login-flow.test.mjs
wrangler.toml     KV 绑定和 Cron 配置
```

## 仓库

https://github.com/zf122373690/ctyun-keeper-cf
