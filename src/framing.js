// framing.js - 二进制消息帧 (SendInfo) 与 REDQ 加密器
// 移植自 ctyun_keepalive.py 的 SendInfo / Encryption 类。

import { rsaOaepSha1EncryptEmpty } from "./crypto.js";

export class SendInfo {
  constructor(type = 0, data = new Uint8Array(0)) {
    this.type = type;
    this.data = data;
  }

  toBuffer(isBuildMsg = false) {
    const dataLength = this.data.length;
    const msgLength = isBuildMsg ? 8 : 0;
    const size = msgLength + dataLength;
    const buf = new Uint8Array(2 + 4 + msgLength + dataLength);
    const dv = new DataView(buf.buffer);
    dv.setUint16(0, this.type & 0xffff, true);
    dv.setInt32(2, size, true);
    if (isBuildMsg) {
      dv.setUint32(6, dataLength, true);
      dv.setUint32(10, 8, true);
    }
    if (dataLength > 0) buf.set(this.data, 6 + msgLength);
    return buf;
  }

  static fromBuffer(buffer) {
    const results = [];
    if (!buffer || buffer.length === 0) return results;
    const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let offset = 0;
    while (offset + 6 <= buffer.length) {
      const msgType = dv.getUint16(offset, true);
      const dataLength = dv.getInt32(offset + 2, true);
      if (dataLength < 0 || offset + 6 + dataLength > buffer.length) {
        const remaining = buffer.length - offset;
        if (remaining > 0) {
          results.push(new SendInfo(msgType, buffer.slice(offset, offset + remaining)));
        }
        break;
      }
      const data =
        dataLength > 0
          ? buffer.slice(offset + 6, offset + 6 + dataLength)
          : new Uint8Array(0);
      results.push(new SendInfo(msgType, data));
      offset += 6 + dataLength;
      if (offset + 6 > buffer.length && offset < buffer.length) {
        let allZero = true;
        for (let i = offset; i < buffer.length; i++) {
          if (buffer[i] !== 0) { allZero = false; break; }
        }
        if (allZero) break;
      }
    }
    return results;
  }
}

export class Encryption {
  constructor() {
    this.authMechanism = 1;
  }

  // 收到 REDQ 校验帧后，用其中携带的公钥对空消息做 RSA-OAEP 加密并回包。
  async execute(data) {
    const payload = data.subarray(16);
    const nBytes = payload.subarray(32, 32 + 129);
    const eBytes = payload.subarray(163, 163 + 3);
    const encrypted = await rsaOaepSha1EncryptEmpty(nBytes, eBytes);
    return this._toBuffer(encrypted);
  }

  _toBuffer(buffer) {
    const out = new Uint8Array(4 + buffer.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, this.authMechanism, true);
    out.set(buffer, 4);
    return out;
  }
}
