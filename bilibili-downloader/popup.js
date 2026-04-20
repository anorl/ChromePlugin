function setStatus(text) {
  const status = document.getElementById('status');
  status.textContent = text;
}

function sanitizeFileName(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 200);
}

async function queryVideoInfo(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async function () {
      const titleElement = document.querySelector('h1.title, .video-title, .tit, h1.video-title') || document.querySelector('title');
      const title = titleElement?.innerText?.trim() || document.title.replace(/_?哔哩哔哩.*$/i, '').trim();

      function parseState(state) {
        if (!state) return null;
        const bvid = state.bvid || state.videoData?.bvid || state.aid || state.ep?.bvid;
        const cid = state.videoData?.cid || state.cid || state.ep?.cid;
        return { bvid, cid };
      }

      const pageState = window.__INITIAL_STATE__ || window.__playinfo__ || null;
      const ids = parseState(pageState);
      if (ids?.bvid && ids?.cid) {
        return { title, bvid: ids.bvid, cid: ids.cid };
      }

      for (const script of Array.from(document.scripts)) {
        const text = script.textContent || '';
        const match = text.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?/);
        if (!match) continue;
        try {
          const json = JSON.parse(match[1]);
          const ids2 = parseState(json);
          if (ids2?.bvid && ids2?.cid) {
            return { title, bvid: ids2.bvid, cid: ids2.cid };
          }
        } catch (e) {
          // ignore parse errors
        }
      }

      return { title, bvid: null, cid: null };
    }
  });

  if (!result) {
    return { title: '', url: null };
  }

  const title = result.title || '';
  if (result.bvid && result.cid) {
    const apiUrl = `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(result.bvid)}&cid=${encodeURIComponent(result.cid)}&qn=120&fnval=16&fourk=1`;
    const response = await fetch(apiUrl, { credentials: 'include' });
    const json = await response.json();
    const data = json.data || {};
    if (Array.isArray(data.durl) && data.durl[0]?.url) {
      return { title, url: data.durl[0].url };
    }
    if (Array.isArray(data.dash?.video) && data.dash.video[0]?.baseUrl) {
      return { title, url: data.dash.video[0].baseUrl };
    }
    if (Array.isArray(data.dash?.audio) && data.dash.audio[0]?.baseUrl) {
      return { title, url: data.dash.audio[0].baseUrl, audioOnly: true };
    }
  }

  return { title, url: null };
}

async function startDownload() {
  setStatus('正在检测当前标签页……');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    setStatus('无法获取当前标签页。');
    return;
  }
  if (!/bilibili\.com\/video\//.test(tab.url)) {
    setStatus('当前标签页不是 Bilibili 视频页，请先打开视频页面。');
    return;
  }

  setStatus('正在提取视频信息...');
  let info;
  try {
    info = await queryVideoInfo(tab.id);
  } catch (err) {
    setStatus('提取失败：' + err.message);
    return;
  }
  if (!info?.url) {
    setStatus('未能提取下载链接，可能是 Bilibili 页面结构已更新。');
    return;
  }

  const safeTitle = sanitizeFileName(info.title || 'bilibili_video');
  const extension = info.url.match(/\.(mp4|m4s|flv|m3u8)(\?|$)/i)?.[1] || 'mp4';
  const filename = `${safeTitle}.${extension}`;

  chrome.runtime.sendMessage({ action: 'download', url: info.url, filename });
  setStatus('已开始下载：' + filename + '\n如果下载未开始，请检查页面是否已登录并刷新后再试。');
}

document.getElementById('downloadBtn').addEventListener('click', startDownload);
