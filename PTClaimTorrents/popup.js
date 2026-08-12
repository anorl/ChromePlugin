"use strict";

const elements = {
  pageStatus: document.querySelector("#pageStatus"),
  available: document.querySelector("#available"),
  completed: document.querySelector("#completed"),
  failed: document.querySelector("#failed"),
  actionMin: document.querySelector("#actionMin"),
  actionMax: document.querySelector("#actionMax"),
  torrentMin: document.querySelector("#torrentMin"),
  torrentMax: document.querySelector("#torrentMax"),
  message: document.querySelector("#message"),
  start: document.querySelector("#start"),
  stop: document.querySelector("#stop")
};

let activeTabId = null;
let initializedInputs = false;

function seconds(milliseconds) {
  return milliseconds / 1000;
}

function render(result) {
  if (!result || result.error) {
    elements.pageStatus.textContent = "请打开 PTerClub 用户详情页";
    elements.message.textContent = result?.error || "扩展未连接到目标页面";
    elements.start.disabled = true;
    elements.stop.disabled = true;
    return;
  }

  const { state, config, available, supported } = result;
  elements.pageStatus.textContent = supported ? (state.running ? "正在串行认领" : "已连接目标页面") : "当前页面不受支持";
  elements.available.textContent = available;
  elements.completed.textContent = state.completed;
  elements.failed.textContent = state.failed;
  elements.message.textContent = state.lastMessage;
  elements.start.disabled = !supported || state.running;
  elements.stop.disabled = !state.running;

  if (!initializedInputs) {
    elements.actionMin.value = seconds(config.minActionDelayMs);
    elements.actionMax.value = seconds(config.maxActionDelayMs);
    elements.torrentMin.value = seconds(config.minTorrentDelayMs);
    elements.torrentMax.value = seconds(config.maxTorrentDelayMs);
    initializedInputs = true;
  }
}

async function send(action, extra) {
  if (activeTabId == null) return render({ error: "找不到当前标签页" });
  try {
    const result = await chrome.tabs.sendMessage(activeTabId, { action, ...extra });
    render(result);
  } catch (_) {
    render({ error: "请在 PTerClub 用户详情页刷新一次后重试" });
  }
}

function readConfig() {
  return {
    minActionDelayMs: Number(elements.actionMin.value) * 1000,
    maxActionDelayMs: Number(elements.actionMax.value) * 1000,
    minTorrentDelayMs: Number(elements.torrentMin.value) * 1000,
    maxTorrentDelayMs: Number(elements.torrentMax.value) * 1000
  };
}

elements.start.addEventListener("click", () => send("start", { config: readConfig() }));
elements.stop.addEventListener("click", () => send("stop"));

(async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id ?? null;
  await send("status");
  setInterval(() => send("status"), 750);
})();
