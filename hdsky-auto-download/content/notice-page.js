// content/notice-page.js —— 按两个独立开关执行：自动勾选 / 自动下载
(function () {
  const STEP_DELAY = 1000;            // 每个可视步骤至少 1s
  const AFTER_CLICK_CLOSE_MS = 300;   // 自动下载点击后，通知后台 0.3s 关闭标签
  const WAIT_BTN_ENABLE_MS = 8000;    // 仅自动下载时，最多等待按钮可点的时间

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  async function getFlags() {
    return await new Promise(res => {
      chrome.storage.sync.get(
        { HDSKY_AUTOCHECK: false, HDSKY_AUTODOWN: false },
        v => res({ autoCheck: !!v.HDSKY_AUTOCHECK, autoDown: !!v.HDSKY_AUTODOWN })
      );
    });
  }

  function toast(msg) {
    let el = document.getElementById('hdsky-step-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hdsky-step-toast';
      el.style.cssText = `
        position:fixed;right:16px;top:16px;z-index:999999;
        background:rgba(0,0,0,.75);color:#fff;padding:10px 14px;border-radius:10px;
        font-size:13px;box-shadow:0 6px 16px rgba(0,0,0,.3);max-width:40vw;
      `;
      document.body.appendChild(el);
    }
    el.textContent = msg;
  }

  function highlight(el) {
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.outline = '3px solid #3b82f6';
    setTimeout(() => { el.style.outline = ''; }, 1500);
  }

  async function waitForSelector(sel, timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const el = document.querySelector(sel);
      if (el) return el;
      await sleep(120);
    }
    return null;
  }

  async function run() {
    const { autoCheck, autoDown } = await getFlags();

    if (!autoCheck && !autoDown) {
      // 两个都关：什么都不做，仅提示
      toast('提示：自动勾选/自动下载均未启用。你可以手动操作，或回列表页开启开关。');
      setTimeout(() => { const t = document.getElementById('hdsky-step-toast'); if (t) t.remove(); }, 2000);
      return;
    }

    // Step A: 自动勾选（如果开启）
    let cb = null;
    if (autoCheck) {
      toast('步骤 A：寻找并高亮“我会提高分享率的”。');
      cb = await waitForSelector('input[type="checkbox"]#letmedown', 8000);
      if (cb) {
        highlight(cb);
        await sleep(STEP_DELAY);
        toast('步骤 A：勾选“我会提高分享率的”。');
        if (!cb.checked) cb.click();
        await sleep(STEP_DELAY);
      } else {
        toast('未找到复选框 letmedown。');
        await sleep(800);
      }
    }

    // Step B: 自动下载（如果开启）
    if (autoDown) {
      toast('步骤 B：准备点击“下载种子文件”…');
      const btn = await waitForSelector('input[type="submit"]#continuedownload', 8000);
      if (!btn) {
        toast('未找到“下载种子文件”按钮，尝试直接提交表单…');
        const form = document.querySelector('form[action="?"], form[action*="download"]');
        if (form) {
          await sleep(STEP_DELAY);
          form.submit();
          // 通知后台 0.3s 后关闭
          try { chrome.runtime.sendMessage({ type: 'HDSKY_DOWNLOAD_CLICKED' }, () => {}); } catch {}
        }
        return;
      }

      // 若未勾选且按钮处于 disabled，则等待用户手动勾选（最多 WAIT_BTN_ENABLE_MS）
      const startWait = Date.now();
      while (btn.disabled && (Date.now() - startWait) < WAIT_BTN_ENABLE_MS) {
        await sleep(120);
      }

      // 高亮按钮
      highlight(btn);
      await sleep(STEP_DELAY);

      if (!btn.disabled) {
        btn.click();
        toast('已点击“下载种子文件”。');
        try { chrome.runtime.sendMessage({ type: 'HDSKY_DOWNLOAD_CLICKED' }, () => {}); } catch {}
        await sleep(300); // 给页面/浏览器反应
      } else {
        toast('按钮仍不可用：可能未勾选确认，或站点限制。');
        await sleep(1200);
      }
    }

    // 自动勾选开启但自动下载关闭：不关闭页面，留给你人工确认
    // 自动下载开启：后台将在 0.3 秒后关闭当前标签（已在 background.js 处理）
    const t = document.getElementById('hdsky-step-toast'); if (t) t.remove();
  }

  setTimeout(run, 300);
})();
