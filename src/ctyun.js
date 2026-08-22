// ctyun.js - 天翼云电脑 Web 版纯协议保活（Cloudflare Workers 移植版）
// 移植自 ctyun_keepalive.py：REST 登录 + WebSocket 保活 + RSA-OAEP/REDQ 校验。

import { sha256Hex, md5Hex, base64ToBytes, bytesToBase64, bytesToHex, utf8ToBytes } from "./crypto.js";
import { SendInfo, Encryption } from "./framing.js";

const ORC_URL = "https://orc.1999111.xyz/ocr";
const VERSION = "103020001";
const DEVICE_TYPE = "60";
const BASE_URL = "https://desk.ctyun.cn:8810";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
const REDQ_INITIAL_PAYLOAD = base64ToBytes(
  "UkVEUQIAAAACAAAAGgAAAAAAAAABAAEAAAABAAAAEgAAAAkAAAAECAAA"
);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function urlencode(obj) {
  const p = new URLSearchParams();
  for (const k of Object.keys(obj)) p.append(k, obj[k]);
  return p.toString();
}

export class CtYunApi {
  constructor(deviceCode, kv, log) {
    this.deviceCode = deviceCode;
    this.kv = kv || null;
    this.log = log || (() => {});
    this.loginInfo = null;
  }

  _headers(extra) {
    const h = {
      "User-Agent": UA,
      "ctg-devicetype": DEVICE_TYPE,
      "ctg-version": VERSION,
      "ctg-devicecode": this.deviceCode,
      referer: "https://pc.ctyun.cn/",
    };
    if (this.loginInfo) {
      const ts = String(Date.now());
      h["ctg-userid"] = String(this.loginInfo.userId ?? "");
      h["ctg-tenantid"] = String(this.loginInfo.tenantId ?? "");
      h["ctg-timestamp"] = ts;
      h["ctg-requestid"] = ts;
      const sigStr =
        `${DEVICE_TYPE}${ts}${this.loginInfo.tenantId ?? ""}${ts}` +
        `${this.loginInfo.userId ?? ""}${VERSION}${this.loginInfo.secretKey ?? ""}`;
      h["ctg-signaturestr"] = md5Hex(sigStr);
    }
    if (extra) Object.assign(h, extra);
    return h;
  }

  async _request(
    url,
    { method = "GET", body = null, contentType = null, extraHeaders = null, asBytes = false } = {}
  ) {
    const headers = this._headers(extraHeaders);
    if (contentType) headers["Content-Type"] = contentType;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const resp = await fetch(url, { method, headers, body, signal: ctrl.signal });
      if (asBytes) return new Uint8Array(await resp.arrayBuffer());
      const text = await resp.text();
      try {
        return JSON.parse(text);
      } catch {
        return { code: -100, msg: text };
      }
    } catch (ex) {
      return { code: -100, msg: String(ex) };
    } finally {
      clearTimeout(timer);
    }
  }

  _addCollection(data) {
    data.deviceCode = this.deviceCode;
    data.deviceName = "Chrome浏览器";
    data.deviceType = DEVICE_TYPE;
    data.deviceModel = "Windows NT 10.0; Win64; x64";
    data.appVersion = "3.2.0";
    data.sysVersion = "Windows NT 10.0; Win64; x64";
    data.clientVersion = VERSION;
    return data;
  }

  async getChallengeData() {
    const r = await this._request(`${BASE_URL}/api/auth/client/genChallengeData`, {
      method: "POST",
      body: JSON.stringify({}),
      contentType: "application/json",
    });
    if (r && r.code === 0) return r.data;
    this.log(`获取challengeData失败: ${r?.msg}`);
    return null;
  }

  async _getCaptchaText(imgBytes) {
    if (!imgBytes || imgBytes.length === 0) return "";
    try {
      this.log("正在识别验证码...");
      const b64 = bytesToBase64(imgBytes);
      const boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
      // 注意：multipart 分隔符必须是 "--" + boundary（与原 Python 一致）
      const body =
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="image"\r\n\r\n` +
        `${b64}\r\n` +
        `--${boundary}--\r\n`;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 30000);
      const resp = await fetch(ORC_URL, {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "User-Agent": UA,
          "ctg-devicetype": DEVICE_TYPE,
          "ctg-version": VERSION,
          "ctg-devicecode": this.deviceCode,
          "referer": "https://pc.ctyun.cn/",
        },
        body,
        signal: ctrl.signal,
      });
      clearTimeout(t);
      const result = await resp.json();
      const text = (result?.data ?? "").toString().trim();
      this.log(`识别结果: ${text}`);
      return text;
    } catch (ex) {
      this.log(`验证码识别错误: ${ex}`);
      return "";
    }
  }

  async login(userphone, password) {
    const MAX = 8;
    for (let i = 1; i <= MAX; i++) {
      // 每次重试前稍等，让服务端验证码轮换出新图（避免同一张图被稳定误读）
      if (i > 1) await sleep(800 + Math.floor(Math.random() * 1200));

      const challenge = await this.getChallengeData();
      if (!challenge) {
        this.log(`重试${i}/${MAX}, 获取challenge失败`);
        continue;
      }
      const challengeCode = challenge.challengeCode ?? "";
      const challengeId = challenge.challengeId ?? "";

      const captchaUrl =
        `${BASE_URL}/api/auth/client/captcha?height=36&width=85` +
        `&userInfo=${encodeURIComponent(userphone)}&mode=auto` +
        `&_t=${Date.now()}&_r=${Math.floor(Math.random() * 1e9)}`;
      const captchaImg = await this._request(captchaUrl, { asBytes: true });
      const captchaCode = await this._getCaptchaText(captchaImg);
      if (!captchaCode) {
        this.log(`重试${i}/${MAX}, 验证码识别为空`);
        continue;
      }

      const form = {
        userAccount: userphone,
        password: await sha256Hex(password + challengeCode),
        sha256Password: await sha256Hex((await sha256Hex(password)) + challengeCode),
        challengeId,
        captchaCode,
      };
      this._addCollection(form);
      const result = await this._request(`${BASE_URL}/api/auth/client/login`, {
        method: "POST",
        body: urlencode(form),
        contentType: "application/x-www-form-urlencoded",
      });
      if (result && result.code === 0) {
        this.loginInfo = result.data;
        await this._saveSession(userphone);
        return true;
      }
      this.log(`重试${i}/${MAX}, Login Error: ${result?.msg}`);
      if (result?.msg === "用户名或密码错误") return false;
    }
    return false;
  }

  async getSmsCode(userphone) {
    for (let i = 0; i < 3; i++) {
      const captchaImg = await this._request(
        `${BASE_URL}/api/auth/client/validateCode/captcha?width=120&height=40&_t=${Date.now()}`,
        { asBytes: true }
      );
      const captchaCode = await this._getCaptchaText(captchaImg);
      if (!captchaCode) continue;
      const r = await this._request(
        `${BASE_URL}/api/cdserv/client/device/getSmsCode?mobilePhone=${encodeURIComponent(
          userphone
        )}&captchaCode=${encodeURIComponent(captchaCode)}`
      );
      if (r && r.code === 0) return true;
      this.log(`重试${i}, GetSmsCode Error: ${r?.msg}`);
    }
    return false;
  }

  async bindingDevice(verificationCode) {
    const url =
      `${BASE_URL}/api/cdserv/client/device/binding` +
      `?verificationCode=${encodeURIComponent(verificationCode)}` +
      `&deviceName=${encodeURIComponent("Chrome浏览器")}` +
      `&deviceCode=${encodeURIComponent(this.deviceCode)}` +
      `&deviceModel=${encodeURIComponent("Windows NT 10.0; Win64; x64")}` +
      `&sysVersion=${encodeURIComponent("Windows NT 10.0; Win64; x64")}` +
      `&appVersion=3.2.0&hostName=pc.ctyun.cn&deviceInfo=Win32`;
    const r = await this._request(url, {
      method: "POST",
      body: "null",
      contentType: "application/json",
    });
    if (r && r.code === 0) return true;
    this.log(`BindingDevice Error: ${r?.msg}`);
    return false;
  }

  async getDesktopList() {
    const r = await this._request(`${BASE_URL}/api/desktop/client/pageDesktop`, {
      method: "POST",
      body: JSON.stringify({
        getCnt: 20,
        desktopTypes: ["1", "2001", "2002", "2003"],
        sortType: "createTimeV1",
      }),
      contentType: "application/json",
    });
    if (r && r.code === 0) return r.data?.desktopList ?? [];
    this.log(`获取桌面列表失败: ${r?.msg}`);
    return null;
  }

  async powerOn(desktopId) {
    const form = { desktopId, operationType: 1 };
    return this._request(`${BASE_URL}/api/desktop/client/operate`, {
      method: "POST",
      body: urlencode(form),
      contentType: "application/x-www-form-urlencoded",
    });
  }

  async connect(desktopId) {
    const form = {
      objId: desktopId,
      objType: "0",
      osType: "15",
      deviceId: DEVICE_TYPE,
      vdCommand: "",
      ipAddress: "",
      macAddress: "",
    };
    this._addCollection(form);
    return this._request(`${BASE_URL}/api/desktop/client/connect`, {
      method: "POST",
      body: urlencode(form),
      contentType: "application/x-www-form-urlencoded",
    });
  }

  // ---- 会话缓存（减少验证码 OCR 压力）----
  // 仅在内容变化时才写入（内容 diff），避免重复写打满 KV 免费额度。
  // loginTs 记录本次登录时刻，用于页面推算「已在线多久 / 保活始于」（替代原 KV status 快照）
  async _saveSession(user) {
    if (!this.kv || !this.loginInfo) return;
    const payload = { ...this.loginInfo, loginTs: Date.now() };
    try {
      const next = JSON.stringify(payload);
      const prev = await this.kv.get("session:" + user);
      if (prev === next) return; // 未变化，跳过
    } catch {
      /* 读失败则继续写 */
    }
    try {
      await this.kv.put("session:" + user, JSON.stringify(payload));
    } catch (e) {
      this.log(`保存会话失败: ${e}`);
    }
  }

  async loadSession(user) {
    if (!this.kv) return null;
    try {
      const raw = await this.kv.get("session:" + user);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
}

// ---- WebSocket 保活（单台云电脑，窗口期内自动重连）----
function keepaliveWorker(api, account, desktop, keepAliveSeconds, desktopInfo, log) {
  const label = `${account.user}/${desktop.desktopCode || ""}`;
  const clinkHost = desktopInfo.clinkLvsOutHost || "";
  const desktopId = desktop.desktopId;
  const uri = `wss://${clinkHost}/clinkProxy/${desktopId}/MAIN`;
  const hostParts = clinkHost.split(":");
  const connectMessage = {
    type: 1,
    ssl: 1,
    host: hostParts[0],
    port: hostParts[1] || "443",
    ca: desktopInfo.caCert || "",
    cert: desktopInfo.clientCert || "",
    key: desktopInfo.clientKey || "",
    servername: `${desktopInfo.host || ""}:${desktopInfo.port || ""}`,
    oqs: 0,
  };
  const loginInfo = api.loginInfo || {};
  const username = loginInfo.userName || "";
  const userid = loginInfo.userId || 0;
  const encryptor = new Encryption();
  const deadline = Date.now() + keepAliveSeconds * 1000;

  return new Promise((resolve) => {
    let ws = null;
    let done = false;
    let connects = 0;

    const timer = setTimeout(() => finish(), (keepAliveSeconds + 15) * 1000);
    const checker = setInterval(() => {
      if (Date.now() >= deadline) finish();
    }, 1000);

    function finish() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(checker);
      try { ws && ws.close(); } catch {}
      resolve();
    }

    async function onMessage(ev) {
      const data = ev.data;
      if (typeof data === "string") return;
      const bytes = new Uint8Array(data);
      const hex = bytesToHex(bytes).toUpperCase();
      if (hex.startsWith("52454451")) {
        try {
          const resp = await encryptor.execute(bytes);
          ws.send(resp);
          log(`[${label}] 收到保活校验并已响应`);
        } catch (e) {
          log(`[${label}] 加密响应失败: ${e}`);
        }
        return;
      }
      try {
        const infos = SendInfo.fromBuffer(bytes);
        for (const info of infos) {
          if (info.type === 103) {
            const payload = utf8ToBytes(
              JSON.stringify({ type: 1, userName: username, userInfo: "", userId: userid })
            );
            const reply = new SendInfo(118, payload).toBuffer(true);
            ws.send(reply);
          }
        }
      } catch (e) {
        log(`[${label}] 消息解析失败: ${e}`);
      }
    }

    function openWs() {
      if (done) return;
      connects++;
      if (connects > 50) {
        log(`[${label}] 重连次数过多，停止`);
        finish();
        return;
      }
      try {
        ws = new WebSocket(uri, ["binary"]);
      } catch (e) {
        log(`[${label}] WebSocket 创建失败: ${e}`);
        finish();
        return;
      }
      ws.binaryType = "arraybuffer";
      ws.addEventListener("open", () => {
        log(`[${label}] WebSocket 已连接`);
        ws.send(JSON.stringify(connectMessage));
        setTimeout(() => {
          try {
            ws.send(REDQ_INITIAL_PAYLOAD);
            log(`[${label}] 已发送初始 REDQ`);
          } catch {}
        }, 500);
      });
      ws.addEventListener("message", onMessage);
      ws.addEventListener("close", () => {
        if (!done && Date.now() < deadline) {
          log(`[${label}] 连接关闭，1 秒后重连`);
          setTimeout(openWs, 1000);
        } else {
          finish();
        }
      });
      ws.addEventListener("error", (e) => {
        log(`[${label}] WebSocket 错误: ${e?.message || e}`);
      });
    }

    openWs();
  });
}

// ---- 单账号完整流程 ----
export async function runAccount(api, account, keepAliveSeconds, log) {
  const result = { user: account.user, ok: false, desktops: [], error: "" };

  // 尝试复用缓存会话
  const cached = await api.loadSession(account.user);
  let desktopList = null;
  if (cached) {
    api.loginInfo = cached;
    // getDesktopList 成功返回数组(含空数组)、失败返回 null，故用非 null 判断会话有效
    const test = await api.getDesktopList();
    if (test !== null) {
      log(`[${account.user}] 使用缓存会话`);
      desktopList = test; // 复用校验结果，避免重复请求
    } else {
      api.loginInfo = null;
      log(`[${account.user}] 缓存会话已失效，重新登录`);
    }
  }

  if (!api.loginInfo) {
    log(`[${account.user}] 开始登录`);
    const ok = await api.login(account.user, account.password);
    if (!ok) {
      result.error = "登录失败";
      log(`[${account.user}] 登录失败`);
      return result;
    }
  }

  if (!api.loginInfo.bondedDevice) {
    result.error =
      "设备未绑定：无头环境无法输入短信验证码。请先在真实客户端绑定该 deviceCode 后再运行。";
    log(`[${account.user}] ${result.error}`);
    return result;
  }

  if (desktopList === null) desktopList = await api.getDesktopList();
  if (!desktopList || desktopList.length === 0) {
    result.error = "未获取到云电脑";
    log(`[${account.user}] 未获取到云电脑`);
    return result;
  }

  // 构建云电脑状态快照（用于页面展示：台数 / 状态 / 是否在线 / 保活起始 / 已在线时长）
  // 注意：不再写入 KV。onlineSince / keepAliveStart 统一以本次登录时刻(loginTs)计，
  // 跨轮累计改由 session:<user> 缓存的 loginTs 提供（见 sessionFor）
  const statusMap = new Map();
  const loginTs = (api.loginInfo && api.loginInfo.loginTs) || Date.now();
  const runStart = Date.now();
  for (const d of desktopList) {
    const online = d.useStatusText === "运行中";
    const onlineSince = online ? loginTs : null;
    statusMap.set(d.desktopId, {
      desktopId: d.desktopId,
      desktopCode: d.desktopCode || "",
      name: d.desktopName || d.computerName || d.desktopCode || "(未命名)",
      status: d.useStatusText || "未知",
      online,
      keptAlive: false,
      onlineSince,
      keepAliveStart: loginTs,
    });
  }

  const active = [];
  for (const desktop of desktopList) {
    const st = statusMap.get(desktop.desktopId);
    if (desktop.useStatusText !== "运行中") {
      log(`[${account.user}] 云电脑状态: ${desktop.useStatusText}，尝试开机`);
      const pr = await api.powerOn(desktop.desktopId);
      if (pr && pr.code === 0) {
        log(`[${account.user}] 开机指令已发送，等待 30 秒...`);
        await sleep(30000);
      } else {
        log(`[${account.user}] 开机失败: ${pr?.msg}`);
        continue;
      }
    }
    const conn = await api.connect(desktop.desktopId);
    if (conn && conn.code === 0 && conn.data?.desktopInfo) {
      desktop._desktopInfo = conn.data.desktopInfo;
      active.push(desktop);
      if (st) {
        st.keptAlive = true;
        st.keepAliveStart = runStart;
      }
      log(`[${account.user}][${desktop.desktopCode}] 已获取连接信息`);
    } else {
      log(`[${account.user}][${desktop.desktopCode}] 连接失败: ${conn?.msg}`);
    }
  }

  if (active.length === 0) {
    result.error = "没有可保活的云电脑";
    result.desktops = Array.from(statusMap.values());
    return result;
  }

  log(
    `[${account.user}] 保活任务启动，已接管 ${active.length} 台云电脑，本周期保持 ${keepAliveSeconds} 秒`
  );

  try {
    await Promise.all(
      active.map((d) =>
        keepaliveWorker(api, account, d, keepAliveSeconds, d._desktopInfo, log)
      )
    );
    result.ok = true;
  } catch (e) {
    result.error = String(e);
  }
  result.desktops = Array.from(statusMap.values());
  return result;
}

// ---- 只读状态查询（页面 /api/snapshot 用）----
// 仅复用缓存会话拉桌面列表，构造状态卡片，**不做开机/连接/WebSocket 保活**，
// 也不写入任何 KV。用于页面实时展示「几台 / 是否在线 / 已在线多久」，
// 彻底替代原 KV 的 status:<user> 快照。会话失效且无密码时返回错误提示。
export async function queryStatus(api, account, log) {
  const cached = await api.loadSession(account.user);
  if (!cached) {
    if (!account.password) {
      return {
        user: account.user,
        ok: false,
        error: "无缓存会话且无密码，无法查询",
        desktops: [],
      };
    }
    // 需要登录（会触发 OCR，但不写 KV、不做保活）
    const ok = await api.login(account.user, account.password);
    if (!ok) {
      return { user: account.user, ok: false, error: "登录失败", desktops: [] };
    }
  } else {
    api.loginInfo = cached;
  }

  if (api.loginInfo && !api.loginInfo.bondedDevice) {
    return {
      user: account.user,
      ok: false,
      error: "设备未绑定，请先在真实客户端绑定 deviceCode",
      desktops: [],
    };
  }

  const list = await api.getDesktopList();
  if (!list || list.length === 0) {
    return { user: account.user, ok: false, error: "未获取到云电脑", desktops: [] };
  }

  const loginTs = (api.loginInfo && api.loginInfo.loginTs) || Date.now();
  const desktops = list.map((d) => {
    const online = d.useStatusText === "运行中";
    return {
      desktopId: d.desktopId,
      desktopCode: d.desktopCode || "",
      name: d.desktopName || d.computerName || d.desktopCode || "(未命名)",
      status: d.useStatusText || "未知",
      online,
      keptAlive: false, // 实时查询不保活，故恒为 false
      onlineSince: online ? loginTs : null,
      // 仅状态查看，未真正接管保活，保活起始置空（语义诚实）
      keepAliveStart: null,
    };
  });
  return { user: account.user, ok: true, error: "", desktops };
}
