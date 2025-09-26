const DEFAULTS = {
  openIntervalMs: 1500,
  subDir: "HDSky",
  closeNoticeTabAfterDownload: true
};

function load() {
  chrome.storage.sync.get(DEFAULTS, cfg => {
    document.getElementById("openIntervalMs").value = cfg.openIntervalMs;
    document.getElementById("subDir").value = cfg.subDir;
    document.getElementById("closeNoticeTabAfterDownload").checked = cfg.closeNoticeTabAfterDownload;
  });
}

function save() {
  const openIntervalMs = parseInt(document.getElementById("openIntervalMs").value, 10) || DEFAULTS.openIntervalMs;
  const subDir = (document.getElementById("subDir").value || "HDSky").trim();
  const closeNoticeTabAfterDownload = document.getElementById("closeNoticeTabAfterDownload").checked;

  chrome.storage.sync.set({ openIntervalMs, subDir, closeNoticeTabAfterDownload }, () => {
    const tip = document.getElementById("savedTip");
    tip.textContent = "已保存";
    setTimeout(() => tip.textContent = "", 1200);
  });
}

document.getElementById("saveBtn").addEventListener("click", save);
document.addEventListener("DOMContentLoaded", load);
