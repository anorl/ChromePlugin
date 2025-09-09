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
const TASKS = [
  {
    id: "HHanClub",
    name: "HHanClub 打开即关",
    url: "https://hhanclub.top/attendance.php",
    run: async ({ budgetMs = 5000 } = {}) => {
      const url = "https://hhanclub.top/attendance.php";
      const tab = await chrome.tabs.create({ url, active: false });
      const waitMs = Math.max(1000, Math.min(4500, budgetMs - 300));
      try {
        await waitTabComplete(tab.id, waitMs);
        await sleep(200);
        return { status: "success" };
      } catch (e) {
        return { status: "timeout", reason: "tab_complete_timeout" };
      } finally {
        try { await chrome.tabs.remove(tab.id); } catch {}
      }
    }
  },
  {
    id: "Ourbits",
    name: "Ourbits 签到（按钮+CF等待+成功检测）",
    url: "https://ourbits.club", 
    run: async ({ budgetMs = 5000 } = {}) => {
      const url = "https://ourbits.club";
      const tab = await chrome.tabs.create({ url, active: false });

      // 为了满足 5 秒总时限，这里将各阶段时间压缩
      const phaseA = Math.min(1500, Math.max(500, Math.floor(budgetMs * 0.3)));   // 初次加载等待
      const phaseB = Math.min(2000, Math.max(800, Math.floor(budgetMs * 0.4)));   // 等按钮
      const phaseC = Math.max(800, budgetMs - phaseA - phaseB);                   // 等成功文案

      try {
        // 阶段A：等待初步加载完成（可能仍处于CF过渡，但限时）
        await waitTabComplete(tab.id, phaseA);

        // 阶段B/C：注入页面脚本：点击“签到得魔力”，快速轮询成功字样 / 已签到
        const injectRes = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: genericSignFlow,
          args: [{
            buttonText: "签到得魔力",
            successTexts: ["签到成功", "今日已签到", "已签到"],
            loginTexts: ["请先登录", "登入", "登录"],
            maxWaitForBtnMs: phaseB,
            maxWaitForSuccessMs: phaseC,
            pollIntervalMs: 300
          }]
        });

        const { result } = injectRes[0] || {};
        if (!result) {
          return { status: "failed", reason: "no_result" };
        }
        if (result.ok) {
          return { status: "success" };
        }
        // 已手动签到/今天签过
        if (result.reason === "already_signed") {
          return { status: "skipped", reason: "already_signed" };
        }
        if (result.reason === "button_not_found") {
          return { status: "timeout", reason: "button_not_found" };
        }
        if (result.reason === "success_text_timeout") {
          return { status: "timeout", reason: "success_text_timeout" };
        }
        if (result.reason === "need_login" || result.reason === "logged_out_midway") {
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
    run: async ({ budgetMs = 5000 } = {}) => {
      const url = "https://audiences.me";
      const tab = await chrome.tabs.create({ url, active: false });

      // 5秒总预算内分配三个阶段
      const phaseA = Math.min(1500, Math.max(500, Math.floor(budgetMs * 0.3)));   // 初步加载
      const phaseB = Math.min(2000, Math.max(800, Math.floor(budgetMs * 0.4)));   // 等按钮
      const phaseC = Math.max(800, budgetMs - phaseA - phaseB);                   // 等成功文案

      try {
        await waitTabComplete(tab.id, phaseA);
        const injectRes = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: genericSignFlow,  // ← 使用通用函数
          args: [{
            buttonText: "签到得爆米花",
            // 更稳健：多放几个可能的成功文案
            successTexts: ["签到成功", "今日已签到", "已签到", "领取成功", "今日已领取", "已领取", "获得爆米花"],
            loginTexts: ["请先登录", "登入", "登录"],
            maxWaitForBtnMs: phaseB,
            maxWaitForSuccessMs: phaseC,
            pollIntervalMs: 300
          }]
        });

        const { result } = injectRes[0] || {};
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
    id: "M-Team",
    name: "M-Team 打开即关",
    url: "https://kp.m-team.cc", 
    run: async ({ budgetMs = 5000 } = {}) => {
      const url = "https://kp.m-team.cc";
      const tab = await chrome.tabs.create({ url, active: false });

      // 在 5 秒预算内分配给“等待完全加载”的时间
      const waitMs = Math.max(1000, Math.min(4500, budgetMs - 300));

      try {
        await waitTabComplete(tab.id, waitMs); // 监听 tabs.onUpdated status=complete
        await sleep(200);
        return { status: "success" };
      } catch (e) {
        return { status: "timeout", reason: "tab_complete_timeout" };
      } finally {
        try { await chrome.tabs.remove(tab.id); } catch {}
      }
    }
  },
  {
    id: "CHDBits",
    name: "CHDBits 打开即关",
    url: "https://ptchdbits.co", 
    run: async ({ budgetMs = 5000 } = {}) => {
      const url = "https://ptchdbits.co";
      const tab = await chrome.tabs.create({ url, active: false });

      // 5 秒预算内给“等待完全加载”的时间，留一点余量用于收尾
      const waitMs = Math.max(1000, Math.min(4500, budgetMs - 300));

      try {
        await waitTabComplete(tab.id, waitMs);  // 监听到 status=complete 即视为“完全打开”
        await sleep(200);
        return { status: "success" };
      } catch (e) {
        // 若站点有 Cloudflare/登录跳转导致迟迟不 complete，会在预算内给出 timeout
        return { status: "timeout", reason: "tab_complete_timeout" };
      } finally {
        try { await chrome.tabs.remove(tab.id); } catch {}
      }
    }
  },
  {
    id: "SpringSunday",
    name: "SpringSunday 打开即关",
    url: "https://springsunday.net",
    run: async ({ budgetMs = 5000 } = {}) => {
      const url = "https://springsunday.net";
      const tab = await chrome.tabs.create({ url, active: false });
      const waitMs = Math.max(1000, Math.min(4500, budgetMs - 300));

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
  }




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
      const budgetMs = 5000;
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

  // 0) 若已显示成功/已签，直接跳过
  if (pageHas(successTexts)) return { ok: true, reason: "already_signed" };
  if (pageHas(loginTexts)) return { ok: false, reason: "need_login" };

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
