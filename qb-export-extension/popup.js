const exportBtn = document.getElementById("exportBtn");
const statusEl = document.getElementById("status");

exportBtn.addEventListener("click", async () => {
  exportBtn.disabled = true;
  statusEl.style.display = "block";
  statusEl.textContent = "正在导出，请稍候…";

  const tab = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab[0]) {
    chrome.scripting.executeScript({
      target: { tabId: tab[0].id },
      func: fetchAndDownloadTorrents,
    });
  }
});

function finishExport(message = "导出完成！") {
  statusEl.textContent = message;
  setTimeout(() => {
    statusEl.style.display = "none";
    exportBtn.disabled = false;
  }, 2000);
}

async function fetchAndDownloadTorrents() {
  const QB_URL = window.location.origin;

  const siteMatchMap = [
    { keyword: "m-team", site: "馒头" },
    { keyword: "ourbits", site: "我堡" },
    { keyword: "hdhome", site: "家园" },
    { keyword: "springsunday", site: "不可说" },
    { keyword: "totheglory", site: "听听歌" },
    { keyword: "chdbits", site: "彩虹岛" },
    { keyword: "rainbowisland", site: "彩虹岛" },
    { keyword: "audiences", site: "观众" },
    { keyword: "cinefiles", site: "观众" },
    { keyword: "keepfrds", site: "朋友" },
    { keyword: "hdsky", site: "天空" },
    { keyword: "hhanclub", site: "憨憨" },
    { keyword: "pterclub", site: "猫站" },
    { keyword: "open.cd", site: "OpenCD" },
    { keyword: "ubits", site: "UBits" },
    { keyword: "agsv", site: "末日" },
    { keyword: "discfan", site: "蝶粉" },
    { keyword: "rousi", site: "Rousi" },
    { keyword: "pttime", site: "PTTime" },
    { keyword: "lemonhd", site: "柠檬" },
    { keyword: "hdarea", site: "好大" },
    { keyword: "zhuque", site: "朱雀" },
    { keyword: "zmpt", site: "织梦" },
    { keyword: "btschool", site: "学校" },
    { keyword: "hddolby", site: "杜比" },
    { keyword: "pthome", site: "铂金家" },
    { keyword: "hdtime", site: "HDTime" },
    { keyword: "carpt", site: "车站" },
    { keyword: "soulvoice", site: "聆音" },
    { keyword: "cdfile", site: "CDFile" },
    { keyword: "ptchina", site: "铂金学院" },
    { keyword: "ptcafe", site: "咖啡" },
    { keyword: "njtupt", site: "njtupt" },
    { keyword: "yemapt", site: "野马" },
    { keyword: "et8", site: "TCCF" },
    { keyword: "torrentccf", site: "TCCF" },
    { keyword: "leaves.red", site: "红叶" },
    { keyword: "icc2022", site: "ICC冰淇淋" },
    { keyword: "hdpt", site: "明教" },
    { keyword: "qingwa", site: "青蛙" },
    { keyword: "hdkylin", site: "麒麟" },
    { keyword: "52dic", site: "海豚" },
    { keyword: "stackoverflow", site: "IPT" },
    { keyword: "empirehost", site: "IPT" },
    { keyword: "digitalcore", site: "digitalcore" },
    { keyword: "HUNO", site: "hawke" },
    { keyword: "oldtoons", site: "oldtoons" },
    { keyword: "pandapt", site: "熊猫高清" },
    { keyword: "byr", site: "北邮人" },
    { keyword: "ptsbao", site: "烧包" },
    { keyword: "longpt", site: "longpt" },
    { keyword: "hxpt", site: "好学" },
    { keyword: "tjupt", site: "北洋园" },
    { keyword: "hawke", site: "hawke" },
    { keyword: "si-qi", site: "思齐" },
    { keyword: "gamegamept", site: "GGPT" },
    { keyword: "tleechreload", site: "TorrentLeech" },
    { keyword: "u2.dmhy", site: "U2 (动漫)" }
  ];

  function detectSite(trackers) {
    const combinedText = trackers.join(" ").toLowerCase();
    for (const { keyword, site } of siteMatchMap) {
      if (combinedText.includes(keyword)) return site;
    }
    return "";
  }

  async function api(path, params = {}) {
    const res = await fetch(`${QB_URL}/api/v2/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
      credentials: "include",
    });
    return res.json();
  }

  const torrents = await api("torrents/info");
  const csvHeader = [
    "名称", "选定大小", "标签", "已完成", "状态",
    "已下载", "已上传", "比率", "分类", "添加于",
    "Tracker", "保存路径", "站点"
  ];
  const csvRows = [csvHeader];

  for (const t of torrents) {
    const trackers = await api("torrents/trackers", { hash: t.hash });
    const trackerList = trackers.map((trk) => trk.url);
    const trackerStr = trackerList.join(", ");
    const site = detectSite(trackerList);

    csvRows.push([
      t.name,
      (t.size / 1024 ** 3).toFixed(2) + " GiB",
      t.tags,
      (t.progress * 100).toFixed(1) + "%",
      t.state,
      (t.downloaded / 1024 ** 3).toFixed(2) + " GiB",
      (t.uploaded / 1024 ** 3).toFixed(2) + " GiB",
      t.ratio.toFixed(2),
      t.category,
      new Date(t.added_on * 1000).toLocaleString(),
      trackerStr,
      t.save_path,
      site,
    ]);
  }

  const BOM = "\uFEFF";
  const csvContent = csvRows
    .map((row) => row.map((field) => `"${String(field).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([BOM + csvContent], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "qbt_export.csv";
  a.click();
  URL.revokeObjectURL(url);

  // 通知 UI 导出完成
  chrome.runtime.sendMessage({ type: "export-complete" });
}
