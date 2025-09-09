const STORAGE_KEYS = { SCHEDULE: "schedule" };

const timeEl = document.getElementById("time");
const saveTimeBtn = document.getElementById("saveTime");
const runNowBtn = document.getElementById("runNow");
const stopRunBtn = document.getElementById("stopRun");
const runFlag = document.getElementById("runFlag");

const recordBody = document.getElementById("recordBody");
const emptyHint = document.getElementById("emptyHint");

init().catch(console.error);

async function init() {
  await refreshState();

  saveTimeBtn.addEventListener("click", async () => {
    const { hour, minute } = fromTimeValue(timeEl.value);
    const r = await chrome.runtime.sendMessage({ type: "set-time", hour, minute });
    alert(r?.ok ? `已保存：每日 ${pad(hour)}:${pad(minute)}` : ("保存失败：" + (r?.error||"未知")));
    await refreshState();
  });

  // popup.js 片段
  runNowBtn.addEventListener("click", async () => {
    // 若正在运行，直接提示，不清空
    const st = await chrome.runtime.sendMessage({ type: "get-state" });
    if (!st?.ok) return alert("获取状态失败");
    if (st.running) return alert("当前正在运行中，稍后再试");

    // 先清空记录（表格立即清空）
    const clr = await chrome.runtime.sendMessage({ type: "clear-logs" });
    if (!clr?.ok) return alert("清空记录失败");
    recordBody.innerHTML = "";
    emptyHint.style.display = "block";

    // 再执行
    const r = await chrome.runtime.sendMessage({ type: "run-now" });
    if (!r?.ok) {
      alert("无法执行：" + (r?.error || "未知错误"));
    } else {
      setRunning(true);
    }
  });


  stopRunBtn.addEventListener("click", async () => {
    const r = await chrome.runtime.sendMessage({ type: "stop-run" });
    if (r?.ok) setRunning(false);
  });

  // 后台推送：开始/结束/单条进度
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "run-start") setRunning(true);
    if (msg?.type === "run-end") { setRunning(false); refreshState(); }
    if (msg?.type === "run-progress" && msg.entry) prependRecord(msg.entry);
  });
}

let taskUrlMap = {};
async function refreshState() {
  const res = await chrome.runtime.sendMessage({ type: "get-state" });
  if (!res?.ok) return;

  // 建立 taskId → url 映射（用于老日志没有 url 的兜底）
  taskUrlMap = {};
  (res.tasks || []).forEach(t => { taskUrlMap[t.id] = t.url; });

  timeEl.value = toTimeValue(res.schedule.hour, res.schedule.minute);
  renderRecords(res.runLog);
  setRunning(res.running);
}

function renderRecords(logs) {
  recordBody.innerHTML = "";
  if (!logs || logs.length === 0) {
    emptyHint.style.display = "block";
    return;
  }
  emptyHint.style.display = "none";

  logs.forEach(e => prependRecord(e));
}

function prependRecord(e) {
  emptyHint.style.display = "none";
  const row = document.createElement("div");
  row.className = "tr";

  const url = e.url || taskUrlMap[e.taskId] || "";
  const idCell = url
    ? `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(e.taskId)}</a>`
    : `${escapeHtml(e.taskId)}`;

  row.innerHTML = `
    <div>${idCell}</div>
    <div>${escapeHtml(e.name || "")}</div>
    <div>${fmtTime(e.ts)}</div>
    <div class="${statusClass(e.status)}">${escapeHtml(e.status)}</div>
    <div>${escapeHtml(e.reason || "-")}</div>
  `;
  recordBody.prepend(row);
}

// 新增：用于安全写入 href 的转义
function escapeAttr(s){ return String(s ?? "").replace(/"/g, "&quot;"); }

function setRunning(flag) {
  runFlag.textContent = flag ? "运行中" : "闲置";
  runFlag.classList.toggle("running", !!flag);
  runFlag.classList.toggle("idle", !flag);
}

function statusClass(s) {
  return ({
    success: "status-success",
    skipped: "status-skipped",
    timeout: "status-timeout",
    failed : "status-failed"
  }[s]) || "";
}

function toTimeValue(hour, minute){ return `${pad(hour)}:${pad(minute)}`; }
function fromTimeValue(val){ const [h,m]=(val||"09:00").split(":").map(x=>parseInt(x,10)); return {hour:isFinite(h)?h:9, minute:isFinite(m)?m:0}; }
function pad(n){ return String(n).padStart(2,"0"); }
function fmtTime(ts){ const d=new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
function escapeHtml(s){ return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c])); }
