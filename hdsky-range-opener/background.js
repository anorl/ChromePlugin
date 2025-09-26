// background.js — 打开URL/启动扫描/全局停止 + 角标进度 + 日志

// 角标：根据 local 中的会话进度显示 “已打开/总数”
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.HDSKY_PROGRESS) return;
  const p = changes.HDSKY_PROGRESS.newValue || {};
  const text = p && p.running && p.total > 0 ? `${p.opened}/${p.total}` : '';
  chrome.action.setBadgeText({ text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: '#0ea5e9' }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 弹窗：让当前活动标签页开始扫描
  if (msg?.type === "HDSKY_START_ON_ACTIVE_TAB") {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const t = tabs[0];
      if (t?.id) {
        chrome.tabs.sendMessage(t.id, { type: "HDSKY_SCAN_AND_SEND" }, resp => {
          sendResponse(resp || { ok: true });
        });
      } else {
        sendResponse({ ok: false, reason: "no active tab" });
      }
    });
    return true; // 异步
  }

  // 内容脚本：请后台打开一个URL（避免被弹窗拦截）
  if (msg?.type === "HDSKY_OPEN_URL" && typeof msg.url === "string" && msg.url) {
    (async () => {
      try {
        console.log("[HDSKY_OPEN_URL] tabs.create ->", msg.url);
        const tab = await chrome.tabs.create({ url: msg.url, active: true });
        if (tab?.windowId != null) {
          try { await chrome.windows.update(tab.windowId, { focused: true }); } catch {}
        }
        sendResponse({ ok: true });
      } catch (e) {
        console.warn("[HDSKY_OPEN_URL] tabs.create FAILED:", e, msg.url);
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // 异步
  }

  // 弹窗：一键测试后台开标签（用于自检）
  if (msg?.type === "HDSKY_TEST_OPEN") {
    (async () => {
      try {
        const testUrl = msg.url || "https://hdsky.me/";
        console.log("[TEST_OPEN] tabs.create ->", testUrl);
        await chrome.tabs.create({ url: testUrl, active: true });
        sendResponse({ ok: true });
      } catch (e) {
        console.warn("[TEST_OPEN] FAILED:", e);
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  // 内容脚本/弹窗：一键停止（双保险）
  if (msg?.type === "HDSKY_STOP_ALL") {
    chrome.action.setBadgeText({ text: '' }).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }
});
