// crypto.test.mjs - 在 Node 下验证 crypto / framing 移植正确性
// 运行：node test/crypto.test.mjs
import { webcrypto } from "node:crypto";
import assert from "node:assert";

// Node 22 已原生提供全局 crypto(webcrypto) / btoa / atob / TextEncoder，无需 shim。

const { sha256Hex, md5Hex, base64ToBytes, bytesToBase64, bytesToHex, rsaOaepSha1EncryptEmpty } =
  await import("../src/crypto.js");
const { SendInfo, Encryption } = await import("../src/framing.js");

let passed = 0;
function ok(name) {
  passed++;
  console.log("  ✓ " + name);
}

async function main() {
  // ---- MD5 已知向量 ----
  assert.strictEqual(md5Hex(""), "d41d8cd98f00b204e9800998ecf8427e");
  assert.strictEqual(md5Hex("abc"), "900150983cd24fb0d6963f7d28e17f72");
  assert.strictEqual(
    md5Hex("The quick brown fox jumps over the lazy dog"),
    "9e107d9d372bb6826bd81d3542a419d6"
  );
  ok("MD5 已知向量");

  // ---- SHA-256 已知向量 ----
  assert.strictEqual(
    await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
  ok("SHA-256 已知向量");

  // ---- base64 往返 ----
  const sample = new Uint8Array([0, 1, 2, 250, 255, 16, 32]);
  assert.deepStrictEqual(base64ToBytes(bytesToBase64(sample)), sample);
  ok("base64 编解码往返");

  // ---- RSA-OAEP(SHA-1) 空消息：加密后可用私钥解密为空 ----
  const kp = await webcrypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      hash: "SHA-1",
      modulusLength: 1024,
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ["encrypt", "decrypt"]
  );
  const pubJwk = await webcrypto.subtle.exportKey("jwk", kp.publicKey);
  const nBytes = Uint8Array.from(Buffer.from(pubJwk.n, "base64url"));
  const eBytes = Uint8Array.from(Buffer.from(pubJwk.e, "base64url"));
  const ct = await rsaOaepSha1EncryptEmpty(nBytes, eBytes);
  const pt = await webcrypto.subtle.decrypt({ name: "RSA-OAEP" }, kp.privateKey, ct);
  assert.strictEqual(pt.byteLength, 0);
  ok("RSA-OAEP(SHA-1) 空消息加密/解密往返");

  // ---- SendInfo 帧往返（接收路径，非 build_msg 格式，与服务器下发帧一致）----
  const info = new SendInfo(103, new TextEncoder().encode('{"hello":1}'));
  const buf = info.toBuffer(false);
  const parsed = SendInfo.fromBuffer(buf);
  assert.strictEqual(parsed.length, 1);
  assert.strictEqual(parsed[0].type, 103);
  assert.strictEqual(new TextDecoder().decode(parsed[0].data), '{"hello":1}');
  ok("SendInfo 帧 编码/解码往返");

  // ---- SendInfo build_msg 格式（我们发给服务器的 type=118 回包）结构校验 ----
  const reply = new SendInfo(118, new TextEncoder().encode('{"a":1}'));
  const rbuf = reply.toBuffer(true);
  // 头部: type(2) + size(4) + [dataLen(4) + 8(4)] + data(6)
  assert.strictEqual(new DataView(rbuf.buffer).getUint16(0, true), 118);
  assert.strictEqual(new DataView(rbuf.buffer).getUint32(6, true), 7); // dataLen = len('{"a":1}')
  assert.strictEqual(new TextDecoder().decode(rbuf.subarray(14)), '{"a":1}');
  ok("SendInfo build_msg 回包结构正确");

  // ---- Encryption.execute：合成 REDQ 负载，验证回包是 OAEP(空) ----
  // execute 内部按固定偏移读取：payload=data[16:]，n=payload[32:32+129]，e=payload[163:163+3]
  const nPadded = new Uint8Array(129);
  nPadded.set(nBytes, 1); // 前导 0x00 + 128 字节 n（与 int.from_bytes 语义一致）
  const frameLen = 16 + 163 + 3; // 182
  const redq = new Uint8Array(frameLen);
  redq[0] = 0x51; redq[1] = 0x52; redq[2] = 0x45; redq[3] = 0x51; // "REDQ"
  redq.set(nPadded, 16 + 32); // n 位于 data[48:177]
  redq.set(eBytes, 16 + 163); // e 位于 data[179:182]
  const enc = new Encryption();
  const resp = await enc.execute(redq);
  assert.strictEqual(new DataView(resp.buffer).getUint32(0, true), 1);
  const respCt = resp.subarray(4);
  const respPt = await webcrypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    kp.privateKey,
    respCt
  );
  assert.strictEqual(respPt.byteLength, 0);
  ok("Encryption.execute 对合成 REDQ 回包正确");

  console.log(`\n全部通过：${passed} 项`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
