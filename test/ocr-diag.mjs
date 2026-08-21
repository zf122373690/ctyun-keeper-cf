// 诊断脚本：测试 天翼验证码 → 第三方OCR 的识别链路是否正常（不做真实登录）
const BASE_URL = "https://desk.ctyun.cn:8810";
const ORC_URL = "https://orc.1999111.xyz/ocr";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
const H = {
  "User-Agent": UA,
  "ctg-devicetype": "60",
  "ctg-version": "103020001",
  "ctg-devicecode": "web_diagnostictest0000000000000000001",
  referer: "https://pc.ctyun.cn/",
};

function bytesToBase64(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function once(i) {
  const t0 = Date.now();
  const url =
    `${BASE_URL}/api/auth/client/captcha?height=36&width=85` +
    `&userInfo=13800138000&mode=auto&_t=${Date.now()}&_r=${Math.floor(Math.random() * 1e9)}`;
  const imgResp = await fetch(url, { headers: H });
  const imgBytes = new Uint8Array(await imgResp.arrayBuffer());
  if (imgBytes.length === 0) {
    console.log(`#${i} 验证码图片为空 HTTP=${imgResp.status}`);
    return;
  }
  const b64 = bytesToBase64(imgBytes);
  const boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
  const body =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="image"\r\n\r\n` +
    `${b64}\r\n` +
    `--${boundary}--\r\n`;
  const ocrResp = await fetch(ORC_URL, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "User-Agent": UA,
      "ctg-devicetype": "60",
      "ctg-version": "103020001",
      "ctg-devicecode": H["ctg-devicecode"],
      referer: "https://pc.ctyun.cn/",
    },
    body,
  });
  const result = await ocrResp.json();
  const text = (result?.data ?? "").toString().trim();
  console.log(
    `#${i} 图片 ${imgBytes.length}B HTTP=${ocrResp.status} OCR="${text}" 耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`
  );
}

for (let i = 1; i <= 4; i++) {
  try {
    await once(i);
  } catch (e) {
    console.log(`#${i} 异常: ${e}`);
  }
  await new Promise((r) => setTimeout(r, 800));
}
