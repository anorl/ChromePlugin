// background.js （在你原有实现上增加：接收 notice 页“已点击下载”并在 300ms 后关闭该 tab）
// 保留你现有的队列与下载命名逻辑，下面仅为完整文件示例（请用你现有文件整体替换以保证一致性）。

const DEFAULT_SETTINGS = {
  openIntervalMs: 3000,        // 主要用于兜底（列表页也使用 3000 ms）
  maxWaitDownloadMs: 45000,
  subDir: "HDSky",
  closeNoticeTabAfterDownload: false
};

async function getSettings() {
  return await new Promise(res => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, cfg => res({ ...DEFAULT_SETTINGS, ...cfg }));
  });
}

let queue = [];
let processing = false;
let waitingDownload = false;
let lastOpenedReferer = null;
let currentTimer = null;
let currentDeadlineTimer = null;
let stopRequested = false;
const openedNotices = new Set();

async function closeOpenedNoticeTabs() {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (t.url && [...openedNotices].some(u => t.url.startsWith(u))) {
      try { await chrome.tabs.remove(t.id); } catch {}
    }
  }
}

async function processQueue() {
  if (processing) return;
  processing = true;
  const settings = await getSettings();

  while (queue.length > 0) {
    if (stopRequested) break;
    const url = queue.shift();
    lastOpenedReferer = url;
    waitingDownload = true;

    if (stopRequested) break;
    try {
      const tab = await chrome.tabs.create({ url, active: true });
      openedNotices.add(url);
      if (tab && tab.windowId != null) {
        try { await chrome.windows.update(tab.windowId, { focused: true }); } catch {}
      }
    } catch (e) {
      console.warn("tabs.create failed:", e);
      waitingDownload = false;
    }

    // 等待下载触发或超时（此处为兜底：不会过早打开下一个）
    await new Promise(resolve => {
      let finished = false;
      function cleanup() {
        if (finished) return;
        finished = true;
        clearTimeout(currentDeadlineTimer);
        clearTimeout(currentTimer);
        currentTimer = null;
        currentDeadlineTimer = null;
        waitingDownload = false;
        resolve();
      }
      if (stopRequested) { cleanup(); return; }
      currentDeadlineTimer = setTimeout(() => {
        console.warn("download wait timeout, continue next:", url);
        cleanup();
      }, settings.maxWaitDownloadMs);
      currentTimer = setTimeout(() => {
        // openIntervalMs 为兜底最小间隔（不依赖于下载完成）
        cleanup();
      }, settings.openIntervalMs);
    });
  }

  processing = false;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "HDSKY_OPEN_NOTICE_QUEUE") {
    const urls = Array.isArray(msg.urls) ? msg.urls : [];
    const set = new Set(queue);
    urls.forEach(u => { if (typeof u === "string") set.add(u); });
    queue = Array.from(set);
    stopRequested = false;
    chrome.storage.sync.remove("HDSKY_STOP");
    processQueue();
    sendResponse({ ok: true, count: urls.length });
    return true;
  }

  if (msg?.type === "HDSKY_STOP_ALL") {
    stopRequested = true;
    queue = [];
    try { if (currentDeadlineTimer) clearTimeout(currentDeadlineTimer); } catch {}
    try { if (currentTimer) clearTimeout(currentTimer); } catch {}
    waitingDownload = false;
    currentTimer = null;
    currentDeadlineTimer = null;
    lastOpenedReferer = null;
    chrome.storage.sync.set({ HDSKY_STOP: 1 }, () => {});
    if (msg.closeTabs) {
      closeOpenedNoticeTabs().finally(() => {
        sendResponse({ ok: true });
      });
      return true;
    } else {
      sendResponse({ ok: true });
    }
    return true;
  }

  // 新增：notice 页发来“我已点击下载”通知 -> 在 300ms 后关闭该 tab（由 sender.tab 提供 tab id）
  if (msg?.type === "HDSKY_DOWNLOAD_CLICKED") {
    const tabId = sender?.tab?.id;
    if (tabId != null) {
      // 等 300ms 再关 tab（模拟短暂停留）
      setTimeout(async () => {
        try { await chrome.tabs.remove(tabId); } catch (e) { /* ignore */ }
      }, 300);
    }
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

chrome.downloads.onDeterminingFilename.addListener(async (item, suggest) => {
  const settings = await getSettings();
  const isFromHDSky =
    /hdsky\.me/i.test(item.finalUrl || "") ||
    /hdsky\.me/i.test(item.referrer || "");
  const looksTorrent =
    /\.torrent(\?.*)?$/i.test(item.filename || "") ||
    /torrent/i.test(item.mime || "") ||
    /\.torrent$/i.test((item.url || ""));

  if (isFromHDSky && looksTorrent) {
    const url = item.finalUrl || item.url || "";
    const m = url.match(/[?&](?:torrentid|id)=(\d+)/i);
    const tid = m ? m[1] : "unknown";
    const base = (item.filename || "").split(/[\\/]/).pop() || "file.torrent";
    const newName = `${settings.subDir}/${tid}-${base}`;
    suggest({ filename: newName, conflictAction: "uniquify" });
  } else {
    suggest();
  }
});

// downloads.onChanged 保留：按你的原逻辑（如果需要可补充）
chrome.downloads.onChanged.addListener(async (delta) => {
  if (!delta.state || delta.state.current !== "complete") return;
  if (!waitingDownload) return;

  const settings = await getSettings();

  try {
    const items = await chrome.downloads.search({ id: delta.id });
    const it = items && items[0];
    if (!it) return;

    const ref = it.referrer || "";
    if (lastOpenedReferer && ref && ref.startsWith(lastOpenedReferer)) {
      if (settings.closeNoticeTabAfterDownload) {
        const tabs = await chrome.tabs.query({});
        for (const t of tabs) {
          if (t.url && t.url.startsWith(lastOpenedReferer)) {
            try { await chrome.tabs.remove(t.id); } catch {}
          }
        }
      }
      if (currentDeadlineTimer) clearTimeout(currentDeadlineTimer);
      if (currentTimer) clearTimeout(currentTimer);
      waitingDownload = false;
    }
  } catch (e) {
    console.warn("downloads.onChanged error:", e);
  }
});
