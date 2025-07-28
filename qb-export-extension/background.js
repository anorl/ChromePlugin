chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "export-complete") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => {
          const statusEl = document.getElementById("status");
          const exportBtn = document.getElementById("exportBtn");
          if (statusEl && exportBtn) {
            statusEl.textContent = "导出完成！";
            setTimeout(() => {
              statusEl.style.display = "none";
              exportBtn.disabled = false;
            }, 2000);
          }
        }
      });
    });
  }
});
