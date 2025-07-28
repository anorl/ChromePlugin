document.getElementById("deleteBtn").addEventListener("click", async () => {
  const inputText = document.getElementById("keywords").value.trim();
  if (!inputText) {
    alert("请输入至少一个种子名称关键词！");
    return;
  }

  const keywords = inputText
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [keywords],
    func: async (keywords) => {
      try {
        const res = await fetch("/api/v2/torrents/info", { credentials: "include" });
        const torrents = await res.json();

        const matched = torrents.filter(t =>
          keywords.some(kw => t.name.includes(kw))
        );

        if (matched.length === 0) {
          alert("未匹配到任何种子！");
          return;
        }

        const hashes = matched.map(t => t.hash).join("|");

        console.log("即将删除种子：", matched.map(t => t.name));

        const delRes = await fetch("/api/v2/torrents/delete", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            hashes,
            deleteFiles: "true"
          }),
          credentials: "include"
        });

        if (delRes.ok) {
          alert(`✅ 已成功删除 ${matched.length} 个种子及其文件`);
        } else {
          alert("❌ 删除失败，可能权限不足或未登录");
        }
      } catch (err) {
        alert("❌ 执行出错：" + err.message);
      }
    }
  });
});
