export const SITE = 'https://s3.pterclub.net';
export const MAX_BYTES = 20 * 1024 * 1024;

export function parseToken(html, finalUrl) {
  if (new URL(finalUrl).pathname.match(/^\/(login|account\/awaiting-confirmation)(\/|$)/)) {
    throw new Error('请先点击「登录图床」，在 Chrome 中完成登录后重试。');
  }
  const token = html.match(/(?:PF\.obj\.config\.)?auth_token\s*=\s*["']([a-zA-Z0-9_-]+)["']/)?.[1];
  if (!token) throw new Error('未找到上传令牌。请打开图床，完成登录或安全验证后重试。');
  return token;
}

export function makeForm(blob, token, privacy) {
  const extensions = {'image/jpeg':'jpg','image/png':'png','image/gif':'gif','image/webp':'webp','image/avif':'avif','image/bmp':'bmp'};
  const timestamp = Date.now();
  // Asia/Shanghai is UTC+8. Include milliseconds and a random suffix for bursts.
  const time = new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().replace(/\D/g, '');
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(4)), byte => byte.toString(16).padStart(2, '0')).join('');
  const filename = `${time.slice(0, 8)}_${time.slice(8, 14)}_${time.slice(14, 17)}_${suffix}.${extensions[blob.type] || 'png'}`;
  const form = new FormData();
  form.append('source', blob, filename);
  for (const [key, value] of Object.entries({action:'upload', type:'file', auth_token:token, timestamp, privacy:privacy === 'public' ? 'public' : 'private', nsfw:0})) {
    form.append(key, String(value));
  }
  return form;
}

export function parseUpload(status, body) {
  let data;
  try { data = JSON.parse(body); } catch {
    throw new Error(`图床未返回 JSON（HTTP ${status}）。请检查登录状态或安全验证；不要直接重试，以免重复上传。`);
  }
  if (status < 200 || status >= 300 || data.error || Number(data.status_code) !== 200) {
    throw new Error(`上传失败：${String(data.error?.message || data.status_txt || `HTTP ${status}`).slice(0, 250)}`);
  }
  const url = data.image?.url;
  if (typeof url !== 'string' || !/^https?:\/\/[^\s\[\]]+$/i.test(url)) {
    throw new Error('图床返回成功，但缺少有效的图片直链。请到图床检查，避免重复上传。');
  }
  return {url, bbcode:`[img]${url}[/img]`};
}

export function validateSource(url) {
  if (typeof url !== 'string' || !/^(https?:\/\/|data:image\/)/i.test(url)) {
    throw new Error('目前支持 HTTP、HTTPS 和 data 图片；blob 临时图片请先保存后通过图床上传。');
  }
}

export async function readImage(response) {
  if (!response.ok) throw new Error(`无法读取原图（HTTP ${response.status}）。图片可能有防盗链或登录限制。`);
  const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!type.startsWith('image/')) throw new Error('原图地址未返回图片，可能被登录页或防盗链拦截。');
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('图片超过插件的 20 MiB 大小限制。');
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('图片超过插件的 20 MiB 大小限制。');
      parts.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  if (!size) throw new Error('图片内容为空。');
  return new Blob(parts, {type});
}
