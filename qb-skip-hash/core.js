export function normalizeSettings(value = {}) {
  let url;
  try { url = new URL(value.qbUrl?.trim()); } catch { throw new Error('请先填写完整的 QB WebUI 地址（含 http:// 或 https://）。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('QB 地址只能使用 HTTP/HTTPS，不要包含账号、密码、查询参数或 #。');
  }
  return {
    qbUrl: url.href.replace(/\/+$/, ''),
    savePath: String(value.savePath || '').trim(),
    category: String(value.category || '').trim(),
    layout: ['Original', 'Subfolder', 'NoSubfolder'].includes(value.layout) ? value.layout : 'Original'
  };
}

export function httpUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('请右键 HTTP/HTTPS 种子下载链接；暂不支持磁力链接或脚本按钮。');
  }
  return url;
}

// Runs in the clicked frame. Never execute site scripts or submit site forms.
export function findTorrentLink() {
  const links = new Map();
  const page = new URL(document.URL || document.baseURI);
  const detailPage = /(?:^|\/)(?:details|torrent)\.php$/i.test(page.pathname);
  const currentId = detailPage ? page.searchParams.get('id') : null;
  for (const a of document.querySelectorAll('a[href]')) {
    let url;
    try { url = new URL(a.href, document.baseURI); } catch { continue; }
    if (!['http:', 'https:'].includes(url.protocol)) continue;
    const path = url.pathname;
    const strong = /(?:^|\/)download(?:\.php)?\/?$/i.test(path) || /\.torrent$/i.test(path) || /\/torrents?\/download(?:\/|$)/i.test(path);
    const text = `${a.textContent || ''} ${a.title || ''}`.replace(/\s+/g, ' ').trim();
    const namedDownload = /下[载載]\s*[种種]子|download\s+torrent/i.test(text);
    if (!strong && !namedDownload) continue;
    const sameSite = url.origin === page.origin;
    const linkedId = url.searchParams.get('id');
    // Ignore downloads of recommendations when viewing a specific PT torrent.
    if (currentId && sameSite && linkedId && linkedId !== currentId) continue;
    const score = (strong ? 20 : 10) + (namedDownload ? 2 : 0) + (sameSite ? 1 : 0) + (currentId && sameSite && linkedId === currentId ? 100 : 0);
    links.set(url.href, {url:url.href, score});
  }
  const candidates = [...links.values()];
  const best = candidates.filter(item => item.score === Math.max(...candidates.map(item => item.score)));
  if (best.length === 1) return best[0].url;
  throw new Error(best.length ? '页面有多个种子下载入口，请直接右键需要的下载链接。' : '未找到种子下载链接，请直接右键种子的下载链接。');
}

export async function torrentHash(buffer) {
  const bytes = new Uint8Array(buffer);
  let pos = 0, infoStart, infoEnd, info;
  const decoder = new TextDecoder();
  const fail = () => { throw new Error('下载结果不是有效的 .torrent 文件，可能是登录页、验证码或错误页面。'); };
  function read(depth = 0) {
    if (depth > 80 || pos >= bytes.length) return fail();
    const start = pos, token = bytes[pos++];
    if (token === 105) {
      const begin = pos;
      while (pos < bytes.length && bytes[pos] !== 101) pos++;
      const value = decoder.decode(bytes.subarray(begin, pos));
      if (pos >= bytes.length || !/^(0|-?[1-9]\d*)$/.test(value)) return fail();
      pos++;
      return Number(value);
    }
    if (token === 108 || token === 100) {
      const value = token === 108 ? [] : Object.create(null);
      while (pos < bytes.length && bytes[pos] !== 101) {
        if (token === 108) value.push(read(depth + 1));
        else {
          const keyBytes = read(depth + 1);
          if (!(keyBytes instanceof Uint8Array)) return fail();
          const key = decoder.decode(keyBytes), begin = pos;
          const item = read(depth + 1);
          if (Object.hasOwn(value, key)) return fail();
          value[key] = item;
          if (depth === 0 && key === 'info') { infoStart = begin; infoEnd = pos; info = item; }
        }
      }
      if (bytes[pos++] !== 101) return fail();
      return value;
    }
    pos = start;
    while (pos < bytes.length && bytes[pos] >= 48 && bytes[pos] <= 57) pos++;
    const lengthText = decoder.decode(bytes.subarray(start, pos));
    const length = Number(lengthText);
    if (!/^(0|[1-9]\d*)$/.test(lengthText) || bytes[pos++] !== 58 || !Number.isSafeInteger(length) || pos + length > bytes.length) return fail();
    const value = bytes.subarray(pos, pos + length);
    pos += length;
    return value;
  }
  const root = read();
  if (pos !== bytes.length || !root || !info || !(info.name instanceof Uint8Array) || !(info.pieces instanceof Uint8Array) && info['meta version'] !== 2) return fail();
  const algorithm = info.pieces instanceof Uint8Array ? 'SHA-1' : 'SHA-256';
  const hash = await crypto.subtle.digest(algorithm, bytes.subarray(infoStart, infoEnd));
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

export async function qbRequest(settings, endpoint, init = {}) {
  let response;
  try {
    response = await fetch(`${settings.qbUrl}/api/v2/${endpoint}`, {
      ...init, credentials:'include', redirect:'error', signal:AbortSignal.timeout(20000)
    });
  } catch {
    throw new Error('无法访问 QB（或请求超时）。请检查地址、网络、证书及浏览器的本地网络访问权限；添加请求超时后请先到 QB 检查结果，避免重复提交。');
  }
  if ([401, 403].includes(response.status)) throw new Error('QB 拒绝访问：请在同一浏览器、同一地址登录 WebUI 后重试；若仍失败，检查反向代理和 QB 的访问限制。');
  if (!response.ok) throw new Error(`QB 请求失败（HTTP ${response.status}）。`);
  return response;
}

export async function testConnection(settings) {
  const response = await qbRequest(settings, 'app/version');
  const version = (await response.text()).trim();
  if (!/^v?\d+\.\d+(?:\.\d+)?(?:[\w.+-]*)$/.test(version)) throw new Error('地址没有返回 QB 版本，请检查 WebUI 地址、登录状态和反向代理路径。');
  return version;
}

export function addForm(settings, blob) {
  const form = new FormData();
  form.append('torrents', blob, 'cross-seed.torrent');
  form.append('skip_checking', 'true');
  form.append('paused', 'false'); // qB 4.x
  form.append('stopped', 'false'); // qB 5.x
  form.append('autoTMM', 'false');
  form.append('contentLayout', settings.layout);
  if (settings.savePath) form.append('savepath', settings.savePath);
  if (settings.category) form.append('category', settings.category);
  return form;
}
