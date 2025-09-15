// ====== 存储键 ======
const STORAGE_KEYS = {
  SCHEDULE: "schedule",
  LAST_STATUS: "lastStatus", // { [taskId]: {status, reason, ts} }
  RUN_LOG: "runLog"          // [{taskId, name, status, reason, ts}]
};

const DEFAULT_SCHEDULE = { hour: 9, minute: 0 };
const ALARM_NAME = "auto-checkin-daily";

// ====== 运行控制 ======
let isRunning = false;
let abortFlag = false;

// ====== 任务（代码定义）=====
/**
 * 规范：
 * run({budgetMs}) 返回 { status, reason? }
 * 状态： success / skipped / failed / timeout
 */
const CORE_TASKS = [
  {
    id: "HHanClub",
    name: "HHanClub 签到",
    url: "https://hhanclub.top/attendance.php",
    budgetMs: 8000,
    run: async ({ budgetMs = 5000 } = {}) => {
      const url = "https://hhanclub.top/attendance.php";
      const tab = await chrome.tabs.create({ url, active: false });

      // 5 秒总预算：略等加载 + 轮询“本次签到获得”
      const phaseA = Math.min(2200, Math.max(600, Math.floor(budgetMs * 0.28)));
      const phaseC = Math.max(1200, budgetMs - phaseA - 200);
      try {
        // 用“软等待”避免 CF/重定向导致的过早 timeout
        await softWaitTabComplete(tab.id, phaseA);

        // 在页面内轮询查找“本次签到获得”，找到即 success；遇到登录提示则失败
        const injectRes = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: waitForTexts,          // ← 见下方新增的注入函数
          args: [{
            successTexts: ["本次签到获得","签到已得"],                  // 你要求的关键字
            loginTexts: ["请先登录", "登入", "登录"],         // 可按需增减
            maxWaitMs: phaseC,
            pollIntervalMs: 250
          }]
        });

        const { result } = injectRes[0] || {};
        if (!result) return { status: "failed", reason: "no_result" };
        if (result.ok)  return { status: "success" };
        if (result.reason === "login")   return { status: "failed",  reason: "need_login" };
        if (result.reason === "timeout") return { status: "timeout", reason: "success_text_timeout" };
        return { status: "failed", reason: result.reason || "unknown" };

      } catch (e) {
        return { status: "failed", reason: String(e?.message || e) };
      } finally {
        try { await chrome.tabs.remove(tab.id); } catch {}
      }
    }
  },
  {
    id: "Ourbits",
    name: "Ourbits 签到",
    url: "https://ourbits.club",
    budgetMs: 8000,
    run: async ({ budgetMs = 5000 } = {}) => {
      const url = "https://ourbits.club";
      const tab = await chrome.tabs.create({ url, active: false });

      const phaseA = Math.min(2800, Math.max(800, Math.floor(budgetMs * 0.35)));
      const phaseB = Math.min(2800, Math.max(900, Math.floor(budgetMs * 0.30)));
      const phaseC = Math.max(1200, budgetMs - phaseA - phaseB);

      try {
        await softWaitTabComplete(tab.id, phaseA);

        const result = await execWithRetry(tab.id, genericSignFlow, [{
          buttonText: "签到得魔力",
          successTexts: ["签到成功", "今日已签到", "已签到", "签到已得"],
          loginTexts: ["请先登录", "登入", "登录"],
          maxWaitForBtnMs: phaseB,
          maxWaitForSuccessMs: phaseC,
          pollIntervalMs: 250
        }], { retries: 1 });
        if (!result) return { status: "failed", reason: "no_result" };

        // 只要脚本报告 ok，就记为 success（包含 already_signed 的情况）
        if (result.ok) {
          return { status: "success", reason: result.reason || "-" };
        }

        if (result.reason === "button_not_found")   return { status: "timeout", reason: "button_not_found" };
        if (result.reason === "success_text_timeout") return { status: "timeout", reason: "success_text_timeout" };
        if (["need_login", "logged_out_midway"].includes(result.reason)) {
          return { status: "failed", reason: result.reason };
        }
        return { status: "failed", reason: result.reason || "unknown" };
      } catch (e) {
        return { status: "failed", reason: String(e && e.message || e) };
      } finally {
        try { await chrome.tabs.remove(tab.id); } catch {}
      }
    }
  },
  {
    id: "Audiences",
    name: "Audiences 签到（爆米花）",
    url: "https://audiences.me",
    budgetMs: 8000,
    run: async ({ budgetMs = 5000 } = {}) => {
      const url = "https://audiences.me";
      const tab = await chrome.tabs.create({ url, active: false });

      // 5秒总预算内分配三个阶段
      const phaseA = Math.min(2800, Math.max(800, Math.floor(budgetMs * 0.35)));
      const phaseB = Math.min(2800, Math.max(900, Math.floor(budgetMs * 0.30)));
      const phaseC = Math.max(1200, budgetMs - phaseA - phaseB);

      try {
        await softWaitTabComplete(tab.id, phaseA);
        const result = await execWithRetry(tab.id, genericSignFlow, [{
          buttonText: "签到得爆米花",
          successTexts: ["签到成功", "今日已签到", "已签到", "领取成功", "今日已领取", "已领取", "获得爆米花","签到已得"],
          loginTexts: ["请先登录", "登入", "登录"],
          maxWaitForBtnMs: phaseB,
          maxWaitForSuccessMs: phaseC,
          pollIntervalMs: 250
        }], { retries: 1 });
        if (!result) return { status: "failed", reason: "no_result" };
        if (result.ok) return { status: "success" };
        if (result.reason === "already_signed") return { status: "skipped", reason: "already_signed" };
        if (result.reason === "button_not_found") return { status: "timeout", reason: "button_not_found" };
        if (result.reason === "success_text_timeout") return { status: "timeout", reason: "success_text_timeout" };
        if (["need_login", "logged_out_midway"].includes(result.reason)) return { status: "failed", reason: result.reason };
        return { status: "failed", reason: result.reason || "unknown" };
      } catch (e) {
        return { status: "failed", reason: String(e?.message || e) };
      } finally {
        try { await chrome.tabs.remove(tab.id); } catch {}
      }
    }
  },
  {
    id: "YemaPT",
    name: "YemaPT 签到",
    url: "https://www.yemapt.org/#/consumer/checkIn",
    budgetMs: 8000,
    run: async ({ budgetMs = 7000 } = {}) => {
      const url = "https://www.yemapt.org/#/consumer/checkIn";
      const tab = await chrome.tabs.create({ url, active: false });

      const preWait = Math.min(3600, Math.max(1400, Math.floor(budgetMs * 0.55)));
      try {
        // 若很快 complete 就行；否则不报错，直接进入下一步
        await softWaitTabComplete(tab.id, 1400);
        await sleep(preWait);

        const remain = Math.max(700, budgetMs - preWait - 200);
        const result = await execWithRetry(tab.id, yemaptCheckinFlow, [{
          buttonTexts: ["签 到", "签到"],
          successTexts: ["已签到"],
          loginTexts: ["请先登录", "登入", "登录"],
          maxWaitForBtnMs: 1400,
          maxWaitForSuccessMs: remain,
          pollIntervalMs: 200
        }], { retries: 1 });
        if (result?.ok)                           return { status: "success", reason: result.reason || "-" };
        if (result?.reason === "already_signed")  return { status: "success", reason: "already_signed" };
        if (result?.reason === "button_not_found")      return { status: "timeout", reason: "button_not_found" };
        if (result?.reason === "success_text_timeout")  return { status: "timeout", reason: "success_text_timeout" };
        if (["need_login","logged_out_midway"].includes(result?.reason))
          return { status: "failed", reason: result.reason };
        return { status: "failed", reason: result?.reason || "unknown" };
      } catch (e) {
        return { status: "failed", reason: String(e?.message || e) };
      } finally {
        try { await chrome.tabs.remove(tab.id); } catch {}
      }
    }
  }


];

// 在 CF/二次导航较多的站点上，executeScript 可能拿不到 result；重试一次更稳
async function execWithRetry(tabId, func, args, { retries = 1, delayMs = 400, world = "MAIN" } = {}) {
  for (let i = 0; i <= retries; i++) {
    try {
      const arr = await chrome.scripting.executeScript({ target: { tabId }, world, func, args });
      const res = arr && arr[0] && arr[0].result;
      if (res !== undefined) return res;
    } catch (e) {
      // 忽略本次并重试
    }
    await sleep(delayMs);
  }
  return undefined; // 仍然拿不到
}


// ========== 通用“打开即关”任务配置（字符串或对象皆可） ==========
const OPEN_CLOSE_SITES = [
  // 支持两种写法：1) 只写 URL 字符串；2) 自定义 {id,name,url}
  "https://pt.keepfrds.com",
  "https://ptchdbits.co",
  "https://springsunday.net",
  { id:"M-Team", name:"M-Team 打开即关", url:"https://kp.m-team.cc" },
];

// ========== 工具：从 URL 生成简短 id/name ==========
function makeIdFromUrl(u) {
  try {
    const { hostname, pathname } = new URL(u);
    const host = hostname.replace(/^www\./, "");
    const path = pathname.replace(/\/+$/, "").split("/").filter(Boolean)[0] || "";
    return (path ? `${host}-${path}` : host)
      .replace(/[^a-zA-Z0-9\-_.]/g, "_"); // 安全化
  } catch { return `oc-${Math.random().toString(36).slice(2, 8)}`; }
}
function makeNameFromUrl(u) {
  try {
    const { hostname } = new URL(u);
    return `${hostname.replace(/^www\./, "")} 打开即关`;
  } catch { return "打开即关"; }
}

// ========== 工厂：把 URL 包装成“打开即关”任务 ==========
function makeOpenCloseTask(entry) {
  const item = (typeof entry === "string") ? { url: entry } : entry;
  const url  = item.url;
  const id   = item.id   || makeIdFromUrl(url);
  const name = item.name || makeNameFromUrl(url);

  return {
    id, name, url,
    run: async ({ budgetMs = 5000 } = {}) => {
      const tab = await chrome.tabs.create({ url, active: false });
      const waitMs = Math.max(1000, Math.min(4500, budgetMs - 300)); // 完全加载语义
      try {
        await waitTabComplete(tab.id, waitMs); // 等到 status=complete
        await sleep(200);
        return { status: "success" };
      } catch (e) {
        return { status: "timeout", reason: "tab_complete_timeout" };
      } finally {
        try { await chrome.tabs.remove(tab.id); } catch {}
      }
    }
  };
}

// ========== 拼装最终任务表：复杂任务 + 打开即关任务 ==========
const TASKS = [
  ...CORE_TASKS,
  ...OPEN_CLOSE_SITES.map(makeOpenCloseTask),
];



// ====== 安装/启动：初始化定时 ======
chrome.runtime.onInstalled.addListener(async () => { await ensureSchedule(); await rescheduleAlarm(); });
chrome.runtime.onStartup.addListener(async () => { await rescheduleAlarm(); });

// ====== 存储变化：调整闹钟 ======
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "sync" && changes[STORAGE_KEYS.SCHEDULE]) {
    await rescheduleAlarm();
  }
});

// ====== 闹钟：执行全部任务（串行）=====
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  await runAllTasks();
});

// ====== 与 popup 通信 ======
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.type === "get-state") {
      const state = await getStateSnapshot();
      sendResponse({ ok: true, ...state });

    } else if (msg?.type === "run-now") {
      if (isRunning) return sendResponse({ ok: false, error: "正在运行中" });
      runAllTasks(); // 不 await
      sendResponse({ ok: true });

    } else if (msg?.type === "run-one") {
      if (isRunning) return sendResponse({ ok: false, error: "正在运行中" });
      // 单站运行：开启/结束广播与状态维护与批量一致
      (async () => {
        isRunning = true;
        broadcast({ type: "run-start" });
        try {
          const ok = await runOneTask(msg.taskId);
          sendResponse({ ok });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        } finally {
          isRunning = false;
          broadcast({ type: "run-end" });
        }
      })();
      return true; // 异步响应
      

    } else if (msg?.type === "stop-run") {
      abortFlag = true;
      sendResponse({ ok: true });

    } else if (msg?.type === "set-time") {
      const { hour, minute } = msg;
      await chrome.storage.sync.set({ [STORAGE_KEYS.SCHEDULE]: { hour, minute } });
      await rescheduleAlarm();
      sendResponse({ ok: true });

    // >>> 新增：清空运行记录 <<<
    } else if (msg?.type === "clear-logs") {
      await chrome.storage.local.set({ [STORAGE_KEYS.RUN_LOG]: [] });
      sendResponse({ ok: true });
    }
  })().catch(e => sendResponse({ ok: false, error: String(e) }));
  return true;
});

// ====== 主执行器（5秒超时、可停止、状态记录）=====
async function runAllTasks() {
  isRunning = true;
  abortFlag = false;
  broadcast({ type: "run-start" });

  for (const t of TASKS) {
    if (abortFlag) {
      await recordStatus(t, { status: "skipped", reason: "stopped" });
      broadcast({ type: "run-progress", entry: await getLastStatusEntry(t.id) });
      break;
    }

    // 执行单任务（总预算 5 秒）
    let result = null;
    try {
      const budgetMs = t.budgetMs || 5000;
      result = await t.run({ budgetMs });
      // 若任务内部未在预算内完成，这里仍然接到返回值；我们用内部时间裁剪保证不超过5秒
      if (!result || !result.status) result = { status: "failed", reason: "no_result" };
    } catch (e) {
      result = { status: "failed", reason: String(e && e.message || e) };
    }

    await recordStatus(t, result);
    broadcast({ type: "run-progress", entry: await getLastStatusEntry(t.id) });

    // 小间隔，避免连击过快
    await sleep(200);
  }

  isRunning = false;
  broadcast({ type: "run-end" });
}

// 新增：只执行一个任务（按当前 TASKS 中的配置）
async function runOneTask(taskId) {
  const t = TASKS.find(x => x.id === taskId);
  if (!t) throw new Error("unknown_task: " + taskId);
  let result;
  try {
    const budgetMs = t.budgetMs || 5000;
    result = await t.run({ budgetMs });
    if (!result || !result.status) result = { status: "failed", reason: "no_result" };
  } catch (e) {
    result = { status: "failed", reason: String(e?.message || e) };
  }
  await recordStatus(t, result);
  broadcast({ type: "run-progress", entry: await getLastStatusEntry(t.id) });
  await sleep(100);
  return true;
}

// ====== 工具：状态记录与查询 ======
async function recordStatus(task, { status, reason }) {
  const ts = Date.now();
  // 更新 lastStatus
  const state = await chrome.storage.local.get([STORAGE_KEYS.LAST_STATUS, STORAGE_KEYS.RUN_LOG]);
  const lastStatus = state[STORAGE_KEYS.LAST_STATUS] || {};
  lastStatus[task.id] = { status, reason, ts, name: task.name, url: task.url };
  await chrome.storage.local.set({ [STORAGE_KEYS.LAST_STATUS]: lastStatus });

  // 追加 log（保留最近 100 条）
  const log = state[STORAGE_KEYS.RUN_LOG] || [];
  log.push({ taskId: task.id, name: task.name, status, reason, ts , url: task.url});
  while (log.length > 100) log.shift();
  await chrome.storage.local.set({ [STORAGE_KEYS.RUN_LOG]: log });
}

async function getLastStatusEntry(taskId) {
  const st = await chrome.storage.local.get(STORAGE_KEYS.LAST_STATUS);
  const m = st[STORAGE_KEYS.LAST_STATUS] || {};
  const e = m[taskId];
  if (!e) return null;
  return { taskId, name: e.name, status: e.status, reason: e.reason, ts: e.ts };
}

async function getStateSnapshot() {
  const last = (await chrome.storage.local.get(STORAGE_KEYS.LAST_STATUS))[STORAGE_KEYS.LAST_STATUS] || {};
  const log = (await chrome.storage.local.get(STORAGE_KEYS.RUN_LOG))[STORAGE_KEYS.RUN_LOG] || [];
  const schedule = (await chrome.storage.sync.get(STORAGE_KEYS.SCHEDULE))[STORAGE_KEYS.SCHEDULE] || DEFAULT_SCHEDULE;
  return {
    running: isRunning,
    schedule,
    tasks: TASKS.map(t => ({ id: t.id, name: t.name , url: t.url})),
    lastStatus: last,
    runLog: log.slice(-20) // 只回传最近 20 条
  };
}

function broadcast(payload) {
  try { chrome.runtime.sendMessage(payload); } catch {}
}

// ====== 定时工具 ======
async function ensureSchedule() {
  const st = await chrome.storage.sync.get(STORAGE_KEYS.SCHEDULE);
  if (!st[STORAGE_KEYS.SCHEDULE]) {
    await chrome.storage.sync.set({ [STORAGE_KEYS.SCHEDULE]: DEFAULT_SCHEDULE });
  }
}
async function rescheduleAlarm() {
  const { [STORAGE_KEYS.SCHEDULE]: schedule = DEFAULT_SCHEDULE } = await chrome.storage.sync.get(STORAGE_KEYS.SCHEDULE);
  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.create(ALARM_NAME, { when: nextTime(schedule.hour, schedule.minute), periodInMinutes: 1440 });
}
function nextTime(hour, minute) {
  const now = new Date();
  const t = new Date();
  t.setHours(hour, minute, 0, 0);
  if (t <= now) t.setDate(t.getDate() + 1);
  return t.getTime();
}

// 软等待：到达 timeout 就算了，不抛错，后续继续走点击&轮询
async function softWaitTabComplete(tabId, timeoutMs) {
  try { await waitTabComplete(tabId, timeoutMs); } catch (e) { /* ignore */ }
}

// ====== 标签页完成等待 ======
function waitTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("waitTabComplete timeout"));
    }, timeoutMs);

    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        if (done) return;
        done = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ====== 注入脚本：Ourbits 签到流程（5秒预算友好）======
// 通用“点击按钮并等待成功文案”的页面注入函数
async function genericSignFlow(opts) {
  const {
    buttonText = "",
    successTexts = ["签到成功", "已签到", "今日已签到"],
    loginTexts = ["请先登录", "登入", "登录"],
    maxWaitForBtnMs = 2000,
    maxWaitForSuccessMs = 3000,
    pollIntervalMs = 300
  } = opts || {};

  const wait = ms => new Promise(r => setTimeout(r, ms));
  const getBodyText = () =>
    (document.body && (document.body.innerText || document.body.textContent)) ? (document.body.innerText || document.body.textContent) : "";

  const pageHas = (texts) => {
    const txt = getBodyText();
    return texts.some(t => t && txt.includes(t));
  };

  const findClickable = (predicate) => {
    const nodes = Array.from(document.querySelectorAll("button, input[type=button], a, [role=button], [onclick]"));
    return nodes.find(predicate);
  };

  // 0) 进入就判：已签到/需登录
  if (pageHasVisible(successTexts)) return { ok: true, reason: "already_signed" };
  if (pageHasVisible(loginTexts))   return { ok: false, reason: "need_login" };

  // 1) 等按钮，限时（先精确、再模糊）
  const t0 = Date.now();
  let btn = null;
  while (Date.now() - t0 < maxWaitForBtnMs) {
    btn = findClickable(el => {
      const it = (el.innerText || "").trim();
      const iv = (el.value || "").trim();
      return (buttonText && (it === buttonText || iv === buttonText));
    }) || findClickable(el => {
      const it = el.innerText || "";
      const iv = el.value || "";
      return (buttonText && (it.includes(buttonText) || String(iv).includes(buttonText)));
    });
    if (btn) break;
    if (pageHas(successTexts)) return { ok: true, reason: "already_signed" };
    await wait(pollIntervalMs);
  }
  if (!btn) return { ok: false, reason: "button_not_found" };

  try { btn.scrollIntoView({ block: "center" }); } catch {}
  btn.click();

  // 2) 轮询成功文案（或被踢登录）
  const t1 = Date.now();
  while (Date.now() - t1 < maxWaitForSuccessMs) {
    if (pageHas(successTexts)) return { ok: true };
    if (pageHas(loginTexts)) return { ok: false, reason: "logged_out_midway" };
    await wait(pollIntervalMs);
  }
  return { ok: false, reason: "success_text_timeout" };
}

// 在页面内轮询查找文本：命中 successTexts 则 ok=true；命中 loginTexts 判为需要登录；超时则 timeout
async function waitForTexts(opts) {
  const {
    successTexts = [],
    loginTexts = [],
    maxWaitMs = 2500,
    pollIntervalMs = 250
  } = opts || {};

  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const getBodyText = () =>
    (document.body && (document.body.innerText || document.body.textContent))
      ? (document.body.innerText || document.body.textContent)
      : "";

  const pageHas = (texts) => {
    const txt = getBodyText();
    return texts.some(t => t && txt.includes(t));
  };

  // 进入时先快速判断一次
  if (pageHas(successTexts)) return { ok: true };
  if (pageHas(loginTexts))   return { ok: false, reason: "login" };

  const t0 = Date.now();
  while (Date.now() - t0 < maxWaitMs) {
    if (pageHas(successTexts)) return { ok: true };
    if (pageHas(loginTexts))   return { ok: false, reason: "login" };
    await wait(pollIntervalMs);
  }
  return { ok: false, reason: "timeout" };
}

async function yemaptCheckinFlow(opts) {
  const {
    buttonTexts = ["签 到", "签到"],
    successTexts = ["已签到"],
    loginTexts = ["请先登录", "登入", "登录"],
    maxWaitForBtnMs = 1200,
    maxWaitForSuccessMs = 2000,
    pollIntervalMs = 200
  } = opts || {};

  const wait = ms => new Promise(r => setTimeout(r, ms));
  const norm = s => String(s || "").replace(/\s+/g, "").trim();

  const getBodyText = () =>
    (document.body && (document.body.innerText || document.body.textContent))
      ? (document.body.innerText || document.body.textContent)
      : "";
  const isVisible = (el) => {
    if (!(el instanceof HTMLElement)) return false;
    const r = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
  };
  const pageHasVisible = (texts) => {
    const wanted = texts.map(norm);
    const all = Array.from(document.querySelectorAll("*"));
    for (const el of all) {
      if (!isVisible(el)) continue;
      const txt = norm(el.innerText || el.textContent || "");
      if (txt && wanted.some(w => txt.includes(w))) return true;
    }
    return false;
  };

  // 0) 进入就判：已签到/需登录
  if (pageHas(successTexts)) return { ok: true, reason: "already_signed" };
  if (pageHas(loginTexts))   return { ok: false, reason: "need_login" };

  // 1) 找按钮（优先可交互元素，退化到“任何包含文本的可见元素”）
  const findClickable = () => {
    const wanted = buttonTexts.map(norm);
    const list = Array.from(document.querySelectorAll(
      "button, a, [role=button], [onclick], .btn, .button"
    ));
    const hit = list.find(el => {
      if (!isVisible(el)) return false;
      const it = norm(el.innerText);
      const iv = norm(el.value);
      return wanted.some(w => it.includes(w) || (iv && iv.includes(w)));
    });
    if (hit) return hit;

    // 广义 fallback：任何可见元素包含“签 到/签到”
    const all = Array.from(document.querySelectorAll("*"));
    return all.find(el => {
      if (!(el instanceof HTMLElement)) return false;
      if (!isVisible(el)) return false;
      const txt = norm(el.innerText || el.textContent || "");
      return txt && wanted.some(w => txt.includes(w));
    });
  };

  // 2) 在限时内寻找按钮
  const t0 = Date.now(); let btn = null;
  while (Date.now() - t0 < maxWaitForBtnMs) {
    btn = findClickable();
    if (btn) break;
    if (pageHasVisible(successTexts)) return { ok: true, reason: "already_signed" };
    await wait(pollIntervalMs);
  }
  if (!btn) return { ok: false, reason: "button_not_found" };

  try { btn.scrollIntoView({ block: "center" }); } catch {}
  btn.click();

  // 3) 轮询“已签到”
  const t1 = Date.now();
  while (Date.now() - t1 < maxWaitForSuccessMs) {
    if (pageHasVisible(successTexts)) return { ok: true };
    if (pageHasVisible(loginTexts))   return { ok: false, reason: "logged_out_midway" };
    await wait(pollIntervalMs);
  }
  return { ok: false, reason: "success_text_timeout" };
}
