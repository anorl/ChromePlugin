// content/list-page.js
(function () {
  const DEFAULTS = { enabled: false, minGB: 1, maxGB: 20 };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const getCfg = () =>
    new Promise(r => chrome.storage.sync.get(DEFAULTS, v => r({ ...DEFAULTS, ...v })));

  // ---- 停止标记 / 进度（local）----
  async function isStopped() {
    return await new Promise(r =>
      chrome.storage.local.get({ HDSKY_STOP: 0 }, v => r(!!v.HDSKY_STOP))
    );
  }
  async function clearStop() {
    try { await new Promise(r => chrome.storage.local.set({ HDSKY_STOP: 0 }, r)); } catch(_) {}
  }
  async function setProgress({ running, opened, total }) {
    try {
      await new Promise(r =>
        chrome.storage.local.set({ HDSKY_PROGRESS: { running, opened, total } }, r)
      );
    } catch (_) {}
  }

  // ---- 会话去重（local 保存）----
  async function loadVisitedSet() {
    return await new Promise(res => {
      chrome.storage.local.get({ HDSKY_VISITED_TIDS: [] }, v => {
        res(new Set(v.HDSKY_VISITED_TIDS || []));
      });
    });
  }
  async function saveVisitedSet(set) {
    try {
      await new Promise(r =>
        chrome.storage.local.set({ HDSKY_VISITED_TIDS: Array.from(set) }, r)
      );
    } catch (_) {}
  }

  // ---- 解析大小文本为 GB ----
  function parseSizeToGB(text) {
    if (!text) return null;
    const s = String(text).replace(/[\u00A0\u3000]/g, ' ').replace(/\s+/g, ' ').trim();
    const m = s.match(/([\d.]+)\s*(TB|GB|MB)/i);
    if (!m) return null;
    const val = parseFloat(m[1]); if (Number.isNaN(val)) return null;
    const unit = m[2].toUpperCase();
    if (unit === 'TB') return val * 1024;
    if (unit === 'GB') return val;
    if (unit === 'MB') return val / 1024;
    return null;
  }

  // ---- 找“大小”列 ----
  function findSizeColumnIndex(table) {
    const header = table.querySelector('tr');
    if (!header) return -1;
    const cells = Array.from(header.children);
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (cell.querySelector('img.size')) return i;
      const hasText = /大小/i.test((cell.textContent || '').trim());
      const hasImgTitle = Array.from(cell.querySelectorAll('img'))
        .some(img => /大小/i.test(img.title || img.alt || ''));
      if (hasText || hasImgTitle) return i;
    }
    return -1;
  }

  // ---- 从当前行提取 details 的 id ----
  function extractIdFromRow(tr) {
    const a = tr.querySelector('a[href*="details.php?id="], a[href*="details.php?"]');
    if (!a) return null;
    try {
      const u = new URL(a.getAttribute('href'), location.origin);
      return u.searchParams.get('id') || null;
    } catch { return null; }
  }

  // ---- 用 id 构造下载提示页 URL ----
  function buildNoticeUrlById(id) {
    if (!id) return null;
    const url = new URL('/downloadnotice.php', location.origin);
    url.searchParams.set('id', id);
    url.searchParams.set('torrentid', id); // 兼容不同站点字段
    url.searchParams.set('type', 'ratio');
    return url.toString();
  }

  // ---- 后台打开；失败则回退 window.open ----
  async function openWithFallback(url) {
    const ok = await new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({ type: 'HDSKY_OPEN_URL', url }, (resp) => {
          if (chrome.runtime.lastError) {
            console.warn("[OPEN_URL] runtime error:", chrome.runtime.lastError.message);
            resolve(false);
          } else {
            resolve(!!resp?.ok);
          }
        });
      } catch (e) {
        console.warn("[OPEN_URL] sendMessage threw:", e);
        resolve(false);
      }
    });
    if (ok) return true;
    try {
      console.warn("[OPEN_URL] fallback window.open ->", url);
      window.open(url, "_blank", "noopener");
      return true;
    } catch (e) {
      console.warn("[OPEN_URL] window.open failed:", e);
      return false;
    }
  }

  // ---- 主流程 ----
  async function scanAndOpen() {
    const { enabled, minGB, maxGB } = await getCfg();
    if (!enabled) {
      alert("扩展未启用：请先在面板点击“启用”。");
      return { ok: false, reason: 'disabled' };
    }

    await clearStop();
    const visited = await loadVisitedSet();

    const table =
      document.querySelector('table.torrents.progresstable') ||
      document.querySelector('table.torrents');
    if (!table) {
      alert("未找到种子列表表格（.torrents.progresstable）。");
      await setProgress({ running: false, opened: 0, total: 0 });
      return { ok: true, count: 0 };
    }

    const sizeIdx = findSizeColumnIndex(table);
    if (sizeIdx < 0) {
      alert("未能定位“大小”列（img.size）。");
      await setProgress({ running: false, opened: 0, total: 0 });
      return { ok: true, count: 0 };
    }

    const rows = Array.from(table.querySelectorAll('tr.progresstr'));
    const tasks = [];

    for (const tr of rows) {
      const tds = Array.from(tr.querySelectorAll('td'));
      if (!tds.length) continue;

      let sizeGB = null;
      if (tds[sizeIdx]) sizeGB = parseSizeToGB(tds[sizeIdx].innerText || tds[sizeIdx].textContent || '');
      if (sizeGB == null) sizeGB = parseSizeToGB(tr.innerText || tr.textContent || '');
      if (sizeGB == null) continue;
      if (sizeGB < minGB || sizeGB > maxGB) continue;

      const id = extractIdFromRow(tr);
      if (!id) continue;
      if (visited.has(id)) continue; // 会话去重

      const noticeUrl = buildNoticeUrlById(id);
      if (!noticeUrl) continue;

      tasks.push(async () => {
        console.log("[OPEN] id=", id, " -> ", noticeUrl);
        const ok = await openWithFallback(noticeUrl);
        if (ok) {
          visited.add(id);
          await saveVisitedSet(visited);
        }
      });
    }

    if (!tasks.length) {
      alert(`未在本页找到大小介于 ${minGB}–${maxGB} GB 的“下载本种”。`);
      await setProgress({ running: false, opened: 0, total: 0 });
      return { ok: true, count: 0 };
    }

    await setProgress({ running: true, opened: 0, total: tasks.length });

    alert(`识别到 ${tasks.length} 条（${minGB}–${maxGB} GB）。将按 3 秒间隔依次打开。`);
    let opened = 0;

    for (let i = 0; i < tasks.length; i++) {
      const cfgNow = await getCfg();
      const stopNow = await isStopped();
      if (!cfgNow.enabled || stopNow) {
        await setProgress({ running: false, opened, total: tasks.length });
        chrome.runtime.sendMessage({ type: "HDSKY_STOP_ALL" }, () => {});
        alert("已停止。");
        return { ok: false, stopped: true, opened };
      }

      try { await tasks[i](); opened++; } catch (e) { console.warn('open task error', e); }
      await setProgress({ running: true, opened, total: tasks.length });

      await sleep(3000);
    }

    await setProgress({ running: false, opened, total: tasks.length });
    chrome.runtime.sendMessage({ type: "HDSKY_STOP_ALL" }, () => {});
    await new Promise(r => chrome.storage.sync.set({ enabled: false }, r));

    alert(`已依次打开 ${opened} 个下载页面。`);
    return { ok: true, count: opened };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "HDSKY_SCAN_AND_SEND") {
      scanAndOpen().then(sendResponse);
      return true;
    }
  });
})();
