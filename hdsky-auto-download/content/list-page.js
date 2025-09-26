// content/list-page.js —— 扫描不变；逐个打开（3s间隔）；新增“自动勾选/自动下载”两个独立开关

(function () {
  /*** UI ***/
  function injectPanel() {
    if (document.getElementById("hdsky-helper-panel")) return;

    const box = document.createElement("div");
    box.id = "hdsky-helper-panel";
    box.style.cssText = `
      position: fixed; right: 16px; bottom: 24px; z-index: 999999;
      background: rgba(0,0,0,.75); color: #fff; border-radius: 10px;
      padding: 10px 12px; font-size: 13px; box-shadow: 0 6px 16px rgba(0,0,0,.3);
    `;
    box.innerHTML = `
      <div style="font-weight:600;margin-bottom:6px">HDSky 批量助手</div>
      <div class="muted" id="hdsky-count">待识别链接：—</div>
      <div class="muted" id="hdsky-progress">已打开：0</div>
      <div style="display:flex; gap:6px; flex-wrap:wrap; margin:6px 0;">
        <button class="primary" id="hdsky-scan" style="padding:6px 10px;border-radius:8px;border:none;background:#3b82f6;color:#fff;cursor:pointer">扫描本页</button>
        <button class="secondary" id="hdsky-open" style="padding:6px 10px;border-radius:8px;border:none;background:#525252;color:#fff;cursor:pointer">开始批量打开</button>
        <button class="secondary" id="hdsky-debug" style="padding:6px 10px;border-radius:8px;border:none;background:#525252;color:#fff;cursor:pointer">调试：打印匹配</button>
      </div>
      <div style="margin-top:6px; display:grid; grid-template-columns: 1fr 1fr; gap:6px;">
        <button id="hdsky-auto-check-toggle" style="padding:6px 10px;border-radius:8px;border:none;background:#0ea5e9;color:#fff;cursor:pointer">启用自动勾选</button>
        <button id="hdsky-auto-down-toggle"  style="padding:6px 10px;border-radius:8px;border:none;background:#22c55e;color:#fff;cursor:pointer">启用自动下载</button>
        <div id="hdsky-auto-check-state" style="color:#ddd;">勾选：已停止</div>
        <div id="hdsky-auto-down-state"  style="color:#ddd;">下载：已停止</div>
      </div>
      <label class="muted" style="display:block;margin-top:8px;">
        <input id="hdsky-closeTabsOnStop" type="checkbox" checked>
        停止时关闭已打开的提示页
      </label>
      <button class="secondary" id="hdsky-stop" style="background:#ef4444;margin-top:6px;padding:6px 10px;border-radius:8px;border:none;color:#fff;cursor:pointer">停止</button>
      <div class="muted" style="margin-top:6px;opacity:.85">流程：扫描 → 开始批量打开（每个间隔3秒）。下载页行为由“自动勾选/自动下载”两开关决定。</div>
    `;
    document.body.appendChild(box);

    document.getElementById("hdsky-scan").addEventListener("click", scanPage);
    document.getElementById("hdsky-open").addEventListener("click", openQueue);
    document.getElementById("hdsky-debug").addEventListener("click", () => {
      console.table(debugRows);
      alert("已在控制台打印匹配结果（F12→Console）");
    });
    document.getElementById("hdsky-stop").addEventListener("click", () => {
      const closeTabs = document.getElementById("hdsky-closeTabsOnStop").checked;
      chrome.runtime.sendMessage({ type: "HDSKY_STOP_ALL", closeTabs }, (resp) => {
        alert(resp?.ok ? "已发送停止指令" : "停止指令发送失败");
      });
    });

    // 独立开关：自动勾选
    document.getElementById("hdsky-auto-check-toggle").addEventListener("click", async () => {
      const cur = await getFlag("HDSKY_AUTOCHECK");
      const next = !cur;
      await setFlag("HDSKY_AUTOCHECK", next);
      syncToggleUI();
    });
    // 独立开关：自动下载
    document.getElementById("hdsky-auto-down-toggle").addEventListener("click", async () => {
      const cur = await getFlag("HDSKY_AUTODOWN");
      const next = !cur;
      await setFlag("HDSKY_AUTODOWN", next);
      syncToggleUI();
    });

    syncToggleUI();
  }

  async function getFlag(key) {
    return await new Promise(r => chrome.storage.sync.get({ [key]: false }, v => r(!!v[key])));
  }
  async function setFlag(key, val) {
    return await new Promise(r => chrome.storage.sync.set({ [key]: !!val }, () => r()));
  }
  function syncToggleUI() {
    chrome.storage.sync.get({ HDSKY_AUTOCHECK: false, HDSKY_AUTODOWN: false }, v => {
      const ac = !!v.HDSKY_AUTOCHECK;
      const ad = !!v.HDSKY_AUTODOWN;
      document.getElementById("hdsky-auto-check-state").textContent = `勾选：${ac ? "运行中" : "已停止"}`;
      document.getElementById("hdsky-auto-down-state").textContent  = `下载：${ad ? "运行中" : "已停止"}`;
      document.getElementById("hdsky-auto-check-toggle").textContent = ac ? "停止自动勾选" : "启用自动勾选";
      document.getElementById("hdsky-auto-down-toggle").textContent  = ad ? "停止自动下载" : "启用自动下载";
    });
  }

  /*** 扫描 ***/
  let tasks = [];
  let debugRows = [];
  let opened = 0;

  function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

  function scanPage() {
    tasks = [];
    debugRows = [];
    opened = 0;

    const inputs = Array.from(document.querySelectorAll('input.download[type="image"]'));
    const candidates = inputs.filter(el => {
      const t = (el.getAttribute('title') || el.getAttribute('alt') || '').trim();
      return t.includes('下载本种') || t.toLowerCase().includes('download');
    });

    for (const btn of candidates) {
      const form = btn.closest('form');

      if (form) {
        const action = form.getAttribute('action') || '';
        const method = (form.getAttribute('method') || 'get').toLowerCase();
        debugRows.push({ kind: 'form', method, action, hasHiddenId: !!form.querySelector('input[name="id"],input[name="torrentid"]') });
        tasks.push(async () => submitFormInNewTab(form));
        continue;
      }

      const onclick = btn.getAttribute('onclick') || '';
      const urlFromOnclick = extractDownloadUrl(onclick);
      if (urlFromOnclick) {
        const full = new URL(urlFromOnclick, location.origin).toString();
        debugRows.push({ kind: 'onclick', url: full });
        tasks.push(async () => openNewTab(full));
        continue;
      }

      const parentWithOnclick = btn.closest('[onclick]');
      if (parentWithOnclick) {
        const u2 = extractDownloadUrl(parentWithOnclick.getAttribute('onclick') || '');
        if (u2) {
          const full = new URL(u2, location.origin).toString();
          debugRows.push({ kind: 'parent-onclick', url: full });
          tasks.push(async () => openNewTab(full));
          continue;
        }
      }

      debugRows.push({ kind: 'fallback-click', note: 'direct click()' });
      tasks.push(async () => {
        const ev = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
        btn.dispatchEvent(ev);
      });
    }

    const countEl = document.getElementById("hdsky-count");
    if (countEl) countEl.textContent = `已识别按钮：${tasks.length} 个`;
    alert(`扫描完成，识别到 ${tasks.length} 个“下载本种”按钮。`);
  }

  function extractDownloadUrl(s) {
    if (!s) return null;
    const m1 = s.match(/['"](\/?download(?:notice)?\.php[^'"]*)['"]/i);
    if (m1) return m1[1];
    const m2 = s.match(/window\.open\((['"])(\/?download(?:notice)?\.php[^'"]*)\1/i);
    if (m2) return m2[2];
    return null;
  }

  function openNewTab(url) {
    chrome.runtime.sendMessage({ type: 'HDSKY_OPEN_NOTICE_QUEUE', urls: [url] }, () => {});
  }

  function submitFormInNewTab(form) {
    return new Promise(resolve => {
      const oldTarget = form.getAttribute('target');
      try {
        form.setAttribute('target', '_blank');

        const imgBtn = form.querySelector('input[type="image"]');
        if (imgBtn && imgBtn.name) {
          const hx = document.createElement('input');
          hx.type = 'hidden'; hx.name = imgBtn.name + '.x'; hx.value = '8';
          const hy = document.createElement('input');
          hy.type = 'hidden'; hy.name = imgBtn.name + '.y'; hy.value = '8';
          form.appendChild(hx); form.appendChild(hy);
          setTimeout(() => { hx.remove(); hy.remove(); }, 2000);
        }

        form.submit();
      } catch (e) {
        console.warn('submitFormInNewTab error', e);
      } finally {
        if (oldTarget == null) form.removeAttribute('target'); else form.setAttribute('target', oldTarget);
        resolve();
      }
    });
  }

  /*** 逐个打开：每个间隔 3s ***/
  async function openQueue() {
    if (!tasks.length) {
      alert("请先点击【扫描本页】。");
      return;
    }

    opened = 0;
    for (let i = 0; i < tasks.length; i++) {
      try { await tasks[i](); } catch (e) { console.warn('open task error', e); }
      opened++;
      const prog = document.getElementById('hdsky-progress');
      if (prog) prog.textContent = `已打开：${opened}`;
      await sleep(3000); // 固定 3 秒
    }
    alert(`已依次打开 ${opened} 个 notice/下载页面（按 3 秒间隔）。`);
  }

  injectPanel();
})();
