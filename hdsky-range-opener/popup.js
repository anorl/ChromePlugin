// popup.js — 控制启用/关闭/开始 + 进度显示 + 测试打开

const DEFAULTS = { enabled: false, minGB: 1, maxGB: 20 };
const $ = (id) => document.getElementById(id);

function refreshUI() {
  chrome.storage.sync.get(DEFAULTS, cfg => {
    const enabled = !!cfg.enabled;
    $("status").textContent = enabled ? "启用" : "关闭";
    $("toggle").textContent = enabled ? "关闭" : "启用";
    $("minGB").value = cfg.minGB;
    $("maxGB").value = cfg.maxGB;
  });
}

function refreshProgressUI() {
  chrome.storage.local.get({ HDSKY_PROGRESS: { running: false, opened: 0, total: 0 } }, v => {
    const p = v.HDSKY_PROGRESS || {};
    $("runState").textContent = p.running ? "运行中" : "已停止";
    $("runProgress").textContent = (p.total || 0) > 0 ? `${p.opened || 0} / ${p.total}` : "—";
  });
}

document.addEventListener("DOMContentLoaded", () => {
  refreshUI();
  refreshProgressUI();
  setInterval(refreshProgressUI, 500);
});

// 启用/关闭
$("toggle").addEventListener("click", async () => {
  const cur = await new Promise(r => chrome.storage.sync.get(DEFAULTS, v => r(v)));
  const next = !cur.enabled;
  await new Promise(r => chrome.storage.sync.set({ enabled: next }, r));
  if (!next) {
    await new Promise(r => chrome.storage.local.set({ HDSKY_STOP: 1 }, r));
    chrome.runtime.sendMessage({ type: "HDSKY_STOP_ALL" }, () => {});
  }
  refreshUI();
  refreshProgressUI();
});

// 保存配置
$("save").addEventListener("click", async () => {
  const minGB = parseFloat($("minGB").value) || 1;
  const maxGB = parseFloat($("maxGB").value) || 20;
  await new Promise(r => chrome.storage.sync.set({ minGB, maxGB }, r));
  alert("已保存配置");
});

// 开始处理当前页
$("start").addEventListener("click", () => {
  chrome.storage.local.set(
    { HDSKY_STOP: 0, HDSKY_PROGRESS: { running: true, opened: 0, total: 0 }, HDSKY_VISITED_TIDS: [] },
    () => {
      chrome.runtime.sendMessage({ type: "HDSKY_START_ON_ACTIVE_TAB" }, (resp) => {
        if (chrome.runtime.lastError) {
          alert("发送指令失败：" + chrome.runtime.lastError.message);
          return;
        }
        if (!resp?.ok) alert("未在 HDSky 列表页或内容脚本未注入。");
      });
    }
  );
});

// 测试打开（直接走后台 tabs.create）
$("test").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "HDSKY_TEST_OPEN", url: "https://hdsky.me/" }, (resp) => {
    if (!resp?.ok && chrome.runtime.lastError) {
      alert("测试失败：" + chrome.runtime.lastError.message);
    }
  });
});
