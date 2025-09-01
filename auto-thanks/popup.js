const $ = (id) => document.getElementById(id);
const elState     = $("state");
const elOpened    = $("opened");
const elSkipped   = $("skipped");
const elPages     = $("pages");
const elHint      = $("hint");
const elStart     = $("startPage");
const elEnd       = $("endPage");
const elThanksOk  = $("thanksOk");
const elThanksFail= $("thanksFail");

// 加载/保存配置
async function loadConfig() {
  const { startPage = 1, endPage = 37 } = await chrome.storage.local.get(["startPage", "endPage"]);
  elStart.value = String(startPage);
  elEnd.value   = String(endPage);
}
async function saveConfig() {
  let s = parseInt(elStart.value, 10);
  let e = parseInt(elEnd.value, 10);
  if (!Number.isFinite(s) || s < 1) s = 1;
  if (!Number.isFinite(e) || e < s) e = Math.max(s, 1);
  await chrome.storage.local.set({ startPage: s, endPage: e });
  elStart.value = String(s);
  elEnd.value   = String(e);
}

$("btnStart").addEventListener("click", async () => {
  await saveConfig();
  const resp = await chrome.runtime.sendMessage({ cmd: "START" });
  if (resp && resp.ok === false) {
    let msg = "无法开始：";
    if (resp.reason === "NOT_TORRENTS_PAGE") msg += "请切到 si-qi.xyz 的 torrents 列表页再开始。";
    else if (resp.reason === "NO_ACTIVE_TAB") msg += "未找到活动标签页。";
    else msg += "未知原因。";
    alert(msg);
  }
});
$("btnStop").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ cmd: "STOP" });
});
$("btnClear").addEventListener("click", async () => {
  const ok = confirm("确定清空访问日志与统计吗？");
  if (!ok) return;
  await chrome.runtime.sendMessage({ cmd: "CLEAR_LOGS" });
  await refreshFromStorage();
});

// 接收后台实时广播
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "PIPELINE_PROGRESS") return;
  renderStats(msg.payload);
});

async function refreshFromStorage() {
  const {
    pipelineStats = { opened: 0, skipped: 0, pages: 0, running: false, thanksOk: 0, thanksFail: 0 },
    lastCheckOk = false
  } = await chrome.storage.local.get(["pipelineStats", "lastCheckOk"]);
  renderStats(pipelineStats);
  renderHint(lastCheckOk);
}

function renderHint(ok) {
  elHint.textContent = ok
    ? "已就绪：点击“开始”即可按设定页码范围执行。"
    : "请先在当前标签页打开 si-qi.xyz 的 torrents 列表页面。";
}

function renderStats(stats) {
  const {
    opened = 0, skipped = 0, pages = 0, running = false,
    thanksOk = 0, thanksFail = 0
  } = stats || {};
  elOpened.textContent     = String(opened);
  elSkipped.textContent    = String(skipped);
  elPages.textContent      = String(pages);
  elThanksOk.textContent   = String(thanksOk);
  elThanksFail.textContent = String(thanksFail);
  elState.textContent      = running ? "运行中" : "已停止";
  elState.className        = running ? "ok" : "warn";
}

// 就绪检测
async function checkActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let ok = false;
  try {
    const u = new URL(tab?.url || "");
    ok = (u.hostname === "si-qi.xyz" && /torrents\.php$/i.test(u.pathname));
  } catch {}
  await chrome.storage.local.set({ lastCheckOk: ok });
  renderHint(ok);
}

checkActiveTab();
loadConfig();
refreshFromStorage();
