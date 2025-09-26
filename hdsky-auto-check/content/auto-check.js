// 仅负责在 downloadnotice.php 页面自动勾选复选框（不点击下载按钮）

(function () {
  const KEY = "HDSKY_AUTOCHECK_ONLY";
  const STEP_DELAY = 600;        // 每个动作之间的最小间隔（毫秒）
  const MAX_WAIT_MS = 8000;      // 等待复选框出现的最长时间

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function toast(msg) {
    let el = document.getElementById("hdsky-step-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "hdsky-step-toast";
      el.style.cssText = `
        position: fixed; right: 16px; top: 16px; z-index: 999999;
        background: rgba(0,0,0,.75); color: #fff; padding: 8px 12px;
        border-radius: 10px; font-size: 12px; box-shadow: 0 6px 16px rgba(0,0,0,.3);
      `;
      document.body.appendChild(el);
    }
    el.textContent = msg;
    // 2 秒后自动消失
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.remove(); }, 2000);
  }

  async function getEnabled() {
    return await new Promise(res => {
      chrome.storage.sync.get({ [KEY]: false }, v => res(!!v[KEY]));
    });
  }

  async function waitFor(selector, timeout = MAX_WAIT_MS) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const el = document.querySelector(selector);
      if (el) return el;
      await sleep(120);
    }
    return null;
  }

  async function run() {
    const enabled = await getEnabled();
    if (!enabled) return; // 未启用则什么也不做

    // 找到“我会提高分享率的”复选框（id=letmedown）
    toast("自动勾选：查找复选框…");
    const cb = await waitFor('input[type="checkbox"]#letmedown');
    if (!cb) {
      toast("未找到复选框（letmedown），请检查页面。");
      return;
    }

    // 可视化：滚到中间并高亮一下
    cb.scrollIntoView({ behavior: "smooth", block: "center" });
    cb.style.outline = "3px solid #3b82f6";
    setTimeout(() => { cb.style.outline = ""; }, 1200);

    await sleep(STEP_DELAY);

    // 勾选
    if (!cb.checked) {
      cb.click();
      toast("已勾选：我会提高分享率的");
    } else {
      toast("已是勾选状态");
    }
  }

  // 页面加载稍等片刻再执行
  setTimeout(run, 300);
})();
