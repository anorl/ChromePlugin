const $ = (id) => document.getElementById(id);

const elState      = $("state");
const elOpened     = $("opened");
const elSkipped    = $("skipped");
const elPages      = $("pages");
const elHint       = $("hint");
const elStart      = $("startPage");
const elEnd        = $("endPage");
const elThanksOk   = $("thanksOk");
const elThanksFail = $("thanksFail");
const elListTpl    = $("listTpl");
const elCurPage    = $("curPageUrl");
const elCurDetail  = $("curDetailUrl");

// ---- 配置读写 ----
async function loadConfig() {
  const {
    startPage = 1,
    endPage = 37,
    listUrlTemplate = "https://si-qi.xyz/torrents.php?page={page}",
  } = await chrome.storage.local.get(["startPage", "endPage", "listUrlTemplate"]);
  elStart.value = String(startPage);
  elEnd.value   = String(endPage);
  elListTpl.value = listUrlTemplate;
}

async function saveConfig() {
  let s = parseInt(elStart.value, 10);
  let e = parseInt(elEnd.value, 10);
  let tpl = (elListTpl.value || "").trim();

  if (!Number.isFinite(s) || s < 1) s = 1;
  if (!Number.isFinite(e) || e < s) e = Math.max(s, 1);

  // 简单校验模板是否包含 {page}
  if (!tpl.includes("{page}")) {
    alert("列表页模板必须包含 {page} 占位符，例如：https://si-qi.xyz/torrents.php?page={page}");
    return false;
  }

  await chrome.storage.local.set({ startPage: s, endPage: e, listUrlTemplate: tpl });
  elStart.value = String(s);
  elEnd.value   = String(e);
  elListTpl.value = tpl;
  return true;
}

// ---- 控件事件 ----
$("btnSave").addEventListener("click", async () => {
  await saveConfig();
});

$("btnStart").addEventListener("click", async () => {
  const ok = await saveConfig();
  if (!ok) return;
  const resp = await chrome.runtime.sendMessage({ cmd: "START" });
  if (resp && resp.ok === false) {
    let msg = "无法开始：";
    if (resp.reason === "NOT_TORRENTS_PAGE") msg += "请切到目标站的 torrents 列表页再开始。";
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

// ---- 实时广播接收 ----
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "PIPELINE_PROGRESS") return;
  renderStats(msg.payload);
});

// ---- 初始化渲染 ----
async function refreshFromStorage() {
  const {
    pipelineStats = {
      opened: 0, skipped: 0, pages: 0, running: false,
      thanksOk: 0, thanksFail: 0, currentPageUrl: "", currentDetailUrl: ""
    },
    lastCheckOk = false
  } = await chrome.storage.local.get(["pipelineStats", "lastCheckOk"]);
  renderStats(pipelineStats);
  renderHint(lastCheckOk);
}

function renderHint(ok) {
  elHint.textContent = ok
    ? "已就绪：点击“开始”即可按模板与页码范围执行。"
    : "请先在当前标签页打开目标网站的 torrents 列表页面。";
}

function setLink(el, url) {
  if (!url) {
    el.textContent = "—";
    el.removeAttribute("href");
    return;
  }
  el.textContent = url;
  el.setAttribute("href", url);
}

function renderStats(stats) {
  const {
    opened = 0, skipped = 0, pages = 0, running = false,
    thanksOk = 0, thanksFail = 0, currentPageUrl = "", currentDetailUrl = ""
  } = stats || {};
  elOpened.textContent     = String(opened);
  elSkipped.textContent    = String(skipped);
  elPages.textContent      = String(pages);
  elThanksOk.textContent   = String(thanksOk);
  elThanksFail.textContent = String(thanksFail);
  setLink(elCurPage, currentPageUrl);
  setLink(elCurDetail, currentDetailUrl);
  elState.textContent      = running ? "运行中" : "已停止";
  elState.className        = running ? "ok" : "warn";
}

// 就绪检测（是否在列表页域名上）
async function checkActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let ok = false;
  try {
    const u = new URL(tab?.url || "");
    ok = /torrents\.php$/i.test(u.pathname); // 放宽：只要在 torrents.php 上即可
  } catch {}
  await chrome.storage.local.set({ lastCheckOk: ok });
  renderHint(ok);
}

// 启动
checkActiveTab();
loadConfig();
refreshFromStorage();
