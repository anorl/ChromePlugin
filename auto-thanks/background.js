// ======= 可调参数（已取消固定 2 秒停留） =======
const POST_THANK_DELAY_MS = 150;  // 成功或失败判定后，为了不打断异步请求，轻微等待再关（可设为 0）
const CLOSE_DELAY_MS = 50;        // 关闭与下一个之间的间隔
const LOAD_TIMEOUT_MS = 15000;    // 列表/详情页加载等待上限
const THANK_TIMEOUT_MS = 4000;    // “说谢谢”成功/失败判定上限
// ===============================================

let stopFlag = false;

// 访问日志（详情去重）
const STATE = {
  visitedDetails: new Set(),
};

// 统计显示（含 成功/失败 计数）
const STATS = {
  opened: 0,      // 已打开详情（并处理过谢谢）
  skipped: 0,     // 因已访问而跳过
  pages: 0,       // 已处理分页
  running: false,
  thanksOk: 0,    // 成功说谢谢
  thanksFail: 0,  // 失败说谢谢
};

// —— 广播 & 存取 —— //
function broadcast() {
  chrome.storage.local.set({ pipelineStats: { ...STATS } });
  chrome.runtime.sendMessage({ type: "PIPELINE_PROGRESS", payload: { ...STATS } }).catch(() => {});
}
async function loadLogsAndStats() {
  const { visitedDetails = [], pipelineStats = null } =
    await chrome.storage.local.get(["visitedDetails", "pipelineStats"]);
  STATE.visitedDetails = new Set(visitedDetails);
  if (pipelineStats) {
    STATS.opened     = pipelineStats.opened     || 0;
    STATS.skipped    = pipelineStats.skipped    || 0;
    STATS.pages      = pipelineStats.pages      || 0;
    STATS.running    = pipelineStats.running    || false;
    STATS.thanksOk   = pipelineStats.thanksOk   || 0;
    STATS.thanksFail = pipelineStats.thanksFail || 0;
  }
}
async function saveLogs() {
  await chrome.storage.local.set({
    visitedDetails: Array.from(STATE.visitedDetails),
  });
}
async function clearLogsAndStats() {
  STATE.visitedDetails.clear();
  STATS.opened = STATS.skipped = STATS.pages = 0;
  STATS.thanksOk = STATS.thanksFail = 0;
  STATS.running = false;
  await chrome.storage.local.remove(["visitedDetails"]);
  await chrome.storage.local.set({ pipelineStats: { ...STATS } });
  broadcast();
}

// —— 规范化 key —— //
function canonDetailKey(urlStr) {
  try {
    const u = new URL(urlStr);
    if (!/details\.php$/i.test(u.pathname)) return null;
    const id = u.searchParams.get("id");
    if (!id) return null;
    const canon = new URL(u.origin + "/details.php");
    canon.searchParams.set("id", id);
    return canon.toString();
  } catch { return null; }
}

// —— Tab & 注入 —— //
function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };

    const onUpdated = (id, info) => {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        finish();
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);

    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) return;
      if (tab?.status === "complete") {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        finish();
      }
    });

    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      finish();
    }, LOAD_TIMEOUT_MS);
  });
}

// 在详情页执行“点击说谢谢，并判定是否成功”的脚本
async function thankOnDetailTab(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [THANK_TIMEOUT_MS],
    func: (THANK_TIMEOUT_MS) => {
      const url = new URL(location.href);
      const id = url.searchParams.get("id");

      const btn = document.querySelector("#saythanks") || document.querySelector("#thanksbutton input[type=button]");

      // --- 改动：无按钮或按钮已禁用，视为跳过 ---
      if (!btn && typeof window.saythanks !== "function") {
        return { skipped: true };
      }
      if (btn && (btn.disabled || btn.getAttribute("disabled") !== null)) {
        return { skipped: true };
      }

      const trigger = () => {
        try {
          if (typeof window.saythanks === "function") {
            window.saythanks(Number(id));
            return true;
          }
        } catch {}
        if (btn) { btn.click(); return true; }
        return false;
      };

      const initialHtml = (document.querySelector("#thanksbutton") || document.body).innerHTML;

      const fired = trigger();

      const successTextPatterns = ["已感谢","谢谢已发送","感谢成功","Thank","thanked","thanks"];
      const isSuccessNow = () => {
        const host = document.querySelector("#thanksbutton") || document.body;
        const html = host.innerHTML || "";
        const curBtn = document.querySelector("#saythanks") || document.querySelector("#thanksbutton input[type=button]");
        const disappeared = !curBtn;
        const disabled = curBtn && (curBtn.disabled || curBtn.getAttribute("disabled") !== null);
        const text = host.textContent || "";
        const textHit = successTextPatterns.some(k => text.toLowerCase().includes(k.toLowerCase()));
        const changed = html !== initialHtml;
        return disappeared || disabled || textHit || changed;
      };

      return new Promise((resolve) => {
        const start = Date.now();
        if (!fired) {
          resolve({ success: false });
          return;
        }
        const timer = setInterval(() => {
          if (isSuccessNow()) {
            clearInterval(timer);
            resolve({ success: true });
          } else if (Date.now() - start > THANK_TIMEOUT_MS) {
            clearInterval(timer);
            resolve({ success: false });
          }
        }, 200);
      });
    },
  });

  return result || { success: false };
}




// —— 打开详情：点感谢 → 立刻判定 → (短暂保护延时) → 关闭 —— //
async function openDetailsSequentially(urls) {
  for (const url of urls) {
    if (stopFlag) return;
    const key = canonDetailKey(url);
    if (!key) continue;

    if (STATE.visitedDetails.has(key)) {
      STATS.skipped++;
      broadcast();
      continue;
    }

    const tab = await chrome.tabs.create({ url, active: false });
    await waitForTabLoad(tab.id);

    try {
      const res = await thankOnDetailTab(tab.id);

      if (res.skipped) {
        STATS.skipped++;
      } else if (res.success) {
        STATS.thanksOk++;
      } else {
        STATS.thanksFail++;
      }
      broadcast();

      if (POST_THANK_DELAY_MS > 0) {
        await new Promise((r) => setTimeout(r, POST_THANK_DELAY_MS));
      }
    } catch {
      STATS.thanksFail++;
      broadcast();
    }

    try { await chrome.tabs.remove(tab.id); } catch {}

    STATE.visitedDetails.add(key);
    STATS.opened++;
    await saveLogs();
    broadcast();

    if (CLOSE_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, CLOSE_DELAY_MS));
    }
  }
}


// —— 主流程：按 page 范围逐页 —— //
async function startPipelineFromActiveTab() {
  await loadLogsAndStats();
  stopFlag = false;
  STATS.running = true;
  broadcast();

  // 从 storage 读取起止页
  let { startPage = 1, endPage = 37 } = await chrome.storage.local.get(["startPage", "endPage"]);
  startPage = Math.max(1, parseInt(startPage, 10) || 1);
  endPage   = Math.max(startPage, parseInt(endPage, 10) || startPage);

  // 必须在 torrents 列表页上启动
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab || !activeTab.id || !activeTab.url) {
    STATS.running = false; broadcast(); return;
  }
  const base = new URL(activeTab.url);
  if (base.hostname !== "si-qi.xyz" || !/torrents\.php$/i.test(base.pathname)) {
    STATS.running = false; broadcast(); return;
  }

  const makePageUrl = (pageNum) => {
    const u = new URL("https://si-qi.xyz/torrents.php");
    u.searchParams.set("page", String(pageNum));
    return u.toString();
  };

  for (let p = startPage; p <= endPage; p++) {
    if (stopFlag) break;

    const pageUrl = makePageUrl(p);
    await chrome.tabs.update(activeTab.id, { url: pageUrl, active: true });
    await waitForTabLoad(activeTab.id);
    if (stopFlag) break;

    // 采集该页所有详情链接
    const detailUrls = await (async () => {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: () => {
          const toAbs = (href) => {
            try { const u = new URL(href, location.href); u.hash = ""; return u.toString(); }
            catch { return null; }
          };
          const anchors = Array.from(document.querySelectorAll('a[href*="details.php?id="]'));
          const set = new Set();
          for (const a of anchors) {
            const u = toAbs(a.getAttribute("href"));
            if (!u) continue;
            try {
              const url = new URL(u);
              if (!/details\.php$/i.test(url.pathname)) continue;
              const id = url.searchParams.get("id");
              if (!id) continue;
              const canon = new URL(url.origin + "/details.php");
              canon.searchParams.set("id", id);
              set.add(canon.toString());
            } catch {}
          }
          return Array.from(set);
        },
      });
      return result || [];
    })();

    await openDetailsSequentially(detailUrls);

    STATS.pages++;
    broadcast();
  }

  STATS.running = false;
  broadcast();
}

// —— 与 popup 的消息交互（带失败原因） —— //
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (!msg || !msg.cmd) return;

    if (msg.cmd === "START") {
      await loadLogsAndStats();

      // 校验当前活动页
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url) {
        STATS.running = false; broadcast();
        sendResponse({ ok: false, reason: "NO_ACTIVE_TAB" });
        return;
      }
      let isOk = false;
      try {
        const u = new URL(tab.url);
        isOk = (u.hostname === "si-qi.xyz" && /torrents\.php$/i.test(u.pathname));
      } catch {}
      if (!isOk) {
        STATS.running = false; broadcast();
        sendResponse({ ok: false, reason: "NOT_TORRENTS_PAGE" });
        return;
      }

      if (!STATS.running) {
        STATS.running = true; broadcast();
        sendResponse({ ok: true });
        startPipelineFromActiveTab().catch((e) => {
          console.error(e);
          STATS.running = false; broadcast();
        });
      } else {
        sendResponse({ ok: true });
      }
    }

    if (msg.cmd === "STOP") {
      stopFlag = true;
      STATS.running = false;
      broadcast();
      sendResponse({ ok: true });
    }

    if (msg.cmd === "CLEAR_LOGS") {
      await clearLogsAndStats();
      sendResponse({ ok: true });
    }
  })();
  return true; // 异步应答
});
