const KEY = "HDSKY_AUTOCHECK_ONLY";

function setBadge(on) {
  if (!chrome.action?.setBadgeText) return;
  chrome.action.setBadgeText({ text: on ? "ON" : "" });
  if (on && chrome.action.setBadgeBackgroundColor) {
    chrome.action.setBadgeBackgroundColor({ color: "#16a34a" });
  }
}

function refreshUI() {
  chrome.storage.sync.get({ [KEY]: false }, (v) => {
    const enabled = !!v[KEY];
    const statusEl = document.getElementById("status");
    const btn = document.getElementById("toggle");

    statusEl.textContent = enabled ? "启用" : "未启用";
    statusEl.className = "status " + (enabled ? "on" : "off");
    btn.textContent = enabled ? "停用" : "启用";
    btn.className = enabled ? "btn-off" : "btn-on";

    setBadge(enabled);
  });
}

document.getElementById("toggle").addEventListener("click", () => {
  chrome.storage.sync.get({ [KEY]: false }, (v) => {
    const enabled = !v[KEY];
    chrome.storage.sync.set({ [KEY]: enabled }, refreshUI);
  });
});

document.addEventListener("DOMContentLoaded", refreshUI);
