// ======= 可调参数 =======
const POST_THANK_DELAY_MS = 150;  // 感谢判定后的小保护延时
const CLOSE_DELAY_MS = 50;        // 关闭与下一个之间的间隔
const LOAD_TIMEOUT_MS = 15000;    // 页面加载等待上限
const THANK_TIMEOUT_MS = 4000;    // “说谢谢”成功/失败判定上限
// =======================

let stopFlag = false;

// 访问日志（详情去重）
const STATE = {
  visitedDetails: new Set(),
};

// 统计显示（含当前页/当前详情）
const STATS = {
  opened: 0,
  skipped: 0,
  pages: 0,
  running: false,
  thanksOk: 0,
  thanksFail: 0,
  currentPageUrl: "",
  currentDetailUrl: "",
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
    STATS.opened        = pipelineStats.opened        || 0;
    STATS.skipped       = pipelineStats.skipped       || 0;
    STATS.pages         = pipelineStats.pages         || 0;
    STATS.running       = pipelineStats.running       || false;
    STATS.thanksOk      = pipelineStats.thanksOk      || 0;
    STATS.thanksFail    = pipelineStats.thanksFail    || 0;
    STATS.currentPageUrl   = pipelineStats.currentPageUrl   || "";
    STATS.currentDetailUrl = pipelineStats.currentDetailUrl || "";
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
  STATS.currentPageUrl = "";
  STATS.currentDetailUrl = "";
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

// 在详情页执行“点击说谢谢”，并根据“按钮含有【感谢】【成功】”来判定成功
async function thankOnDetailTab(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [THANK_TIMEOUT_MS],
    func: (THANK_TIMEOUT_MS) => {
      const url = new URL(location.href);
      const id = url.searchParams.get("id");

      const host = document.querySelector("#thanksbutton") || document.body;
      const btn  = document.querySelector("#saythanks") || document.querySelector("#thanksbutton input[type=button]");

      // —— 打开即“跳过”：无按钮且无函数，或按钮初始禁用 —— //
      if (!btn && typeof window.saythanks !== "function") {
        return { skipped: true };
      }
      if (btn && (btn.disabled || btn.getAttribute("disabled") !== null)) {
        return { skipped: true };
      }

      // —— 触发 —— //
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

      // 检查“按钮样元素”的文本是否同时包含【感谢】【成功】
      const hasThankSuccessButton = () => {
        // 候选：真正的按钮 / input / a.btn / span.btn / [role=button]
        const cands = Array.from(document.querySelectorAll(
          'button, input[type="button"], a.btn, span.btn, [role="button"], #saythanks, #thanksbutton input[type="button"]'
        ));
        return cands.some(el => {
          let text = "";
          if (el.tagName.toLowerCase() === "input") {
            text = (el.value || "").trim();
          } else {
            text = (el.textContent || "").trim();
          }
          return text.includes("感谢") && text.includes("成功");
        });
      };

      // 兜底：按钮消失/禁用 或 区域 DOM 变化 也视作成功（不同站点可能不是文字提示）
      const initialHtml = host.innerHTML;
      const isSuccessNow = () => {
        const curBtn = document.querySelector("#saythanks") || document.querySelector("#thanksbutton input[type=button]");
        const disappeared = !curBtn;
        const disabled    = curBtn && (curBtn.disabled || curBtn.getAttribute("disabled") !== null);
        const changed     = (document.querySelector("#thanksbutton") || document.body).innerHTML !== initialHtml;
        return hasThankSuccessButton() || disappeared || disabled || changed;
      };

      const fired = trigger();

      return new Promise((resolve) => {
        const start = Date.now();
        if (!fired) { resolve({ success: false }); return; }
        const timer = setInterval(() => {
          if (isSuccessNow()) {
            clearInterval(timer);
            resolve({ success: true });
          } else if (Date.now() - start > THANK_TIMEOUT_MS) {
            clearInterval(timer);
            resolve({ success: false }); // 超时未出现“感谢…成功”按钮，也未消失/禁用 → 失败
          }
        }, 200);
      });
    },
  });

  return result || { success: false };
}




// —— 打开详情：点感谢 → 判定 → 关页（记录当前详情网址） —— //
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
    STATS.currentDetailUrl = url;
    broadcast();

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
    STATS.currentDetailUrl = ""; // 清空当前详情显示
    await saveLogs();
    broadcast();

    if (CLOSE_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, CLOSE_DELAY_MS));
    }
  }
}

// —— 采集列表页详情链接 —— //
async function collectDetailsOnTab(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
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
}

// —— 生成列表页 URL（基于模板 {page}） —— //
function makePageUrlByTemplate(template, pageNum) {
  // 简单替换 {page}；如果用户没写 {page}，fallback 在末尾追加 ?page= 或 &page=
  if (template.includes("{page}")) {
    return template.replaceAll("{page}", String(pageNum));
  }
  try {
    const u = new URL(template);
    if (u.search && u.search.length > 1) {
      u.searchParams.set("page", String(pageNum));
    } else {
      u.search = `?page=${pageNum}`;
    }
    return u.toString();
  } catch {
    // 模板不是绝对 URL，则直接拼接
    return template + (template.includes("?") ? "&" : "?") + "page=" + pageNum;
  }
}

// —— 主流程：按模板与页码范围逐页 —— //
async function startPipelineFromActiveTab() {
  await loadLogsAndStats();
  stopFlag = false;
  STATS.running = true;
  broadcast();

  // 读取配置
  let {
    startPage = 1,
    endPage = 37,
    listUrlTemplate = "https://si-qi.xyz/torrents.php?page={page}",
  } = await chrome.storage.local.get(["startPage", "endPage", "listUrlTemplate"]);
  startPage = Math.max(1, parseInt(startPage, 10) || 1);
  endPage   = Math.max(startPage, parseInt(endPage, 10) || startPage);
  if (!listUrlTemplate || typeof listUrlTemplate !== "string") {
    listUrlTemplate = "https://si-qi.xyz/torrents.php?page={page}";
  }

  // 校验当前活动页（放宽为 torrents.php 页面即可）
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab || !activeTab.id || !activeTab.url) {
    STATS.running = false; broadcast(); return;
  }
  try {
    const u = new URL(activeTab.url);
    if (!/torrents\.php$/i.test(u.pathname)) {
      STATS.running = false; broadcast(); return;
    }
  } catch {
    STATS.running = false; broadcast(); return;
  }

  for (let p = startPage; p <= endPage; p++) {
    if (stopFlag) break;

    const pageUrl = makePageUrlByTemplate(listUrlTemplate, p);
    STATS.currentPageUrl = pageUrl;
    broadcast();

    await chrome.tabs.update(activeTab.id, { url: pageUrl, active: true });
    await waitForTabLoad(activeTab.id);
    if (stopFlag) break;

    const detailUrls = await collectDetailsOnTab(activeTab.id);
    await openDetailsSequentially(detailUrls);

    STATS.pages++;
    broadcast();
  }

  STATS.currentPageUrl = "";
  STATS.running = false;
  broadcast();
}

// —— 与 popup 的消息交互（带失败原因） —— //
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (!msg || !msg.cmd) return;

    if (msg.cmd === "START") {
      await loadLogsAndStats();

      // 校验当前活动页（torrents.php）
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url) {
        STATS.running = false; broadcast();
        sendResponse({ ok: false, reason: "NO_ACTIVE_TAB" });
        return;
      }
      let isOk = false;
      try {
        const u = new URL(tab.url);
        isOk = /torrents\.php$/i.test(u.pathname);
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
