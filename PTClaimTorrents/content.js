(function () {
  "use strict";

  if (globalThis.__ptClaimAssistantLoaded) return;
  globalThis.__ptClaimAssistantLoaded = true;

  const CONFIG_KEY = "ptClaimConfig";
  const RUN_KEY = "ptClaimRunState";
  const logic = globalThis.PTClaimLogic;
  let loopPromise = null;
  let generation = 0;

  function storageGet(keys) {
    return chrome.storage.local.get(keys);
  }

  function storageSet(value) {
    return chrome.storage.local.set(value);
  }

  async function getConfig() {
    const stored = await storageGet(CONFIG_KEY);
    return logic.normalizeConfig(stored[CONFIG_KEY]);
  }

  async function getRunState() {
    const stored = await storageGet(RUN_KEY);
    return {
      running: false,
      completed: 0,
      failed: 0,
      currentTorrentId: null,
      nextRunAt: 0,
      lastMessage: "尚未开始",
      ...(stored[RUN_KEY] || {})
    };
  }

  async function updateRunState(patch) {
    const state = { ...(await getRunState()), ...patch, updatedAt: Date.now() };
    await storageSet({ [RUN_KEY]: state });
    return state;
  }

  function sleep(ms, token) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, ms);
      const check = setInterval(() => {
        if (token !== generation) {
          clearTimeout(timeout);
          clearInterval(check);
          reject(new Error("STOPPED"));
        }
      }, 100);
      setTimeout(() => clearInterval(check), ms + 50);
    });
  }

  function isVisible(element) {
    if (!element || !element.isConnected) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function claimButtons() {
    return [...document.querySelectorAll("a.claim-confirm")].filter(
      (link) => link.textContent.trim() === "认领种子" && logic.torrentIdFromUrl(link.dataset.url)
    );
  }

  function dialogBoxes() {
    return [...document.querySelectorAll(".jconfirm-box")].filter(isVisible);
  }

  function dialogText(box, selector) {
    return (box.querySelector(selector)?.textContent || "").trim();
  }

  function confirmButton(box) {
    return [...box.querySelectorAll(".jconfirm-buttons button")].find(
      (button) => isVisible(button) && button.textContent.trim() === "确定"
    );
  }

  function waitFor(find, timeoutMs, token) {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      let timer;
      const observer = new MutationObserver(check);

      function finish(error, value) {
        observer.disconnect();
        clearTimeout(timer);
        error ? reject(error) : resolve(value);
      }

      function check() {
        if (token !== generation) return finish(new Error("STOPPED"));
        let value;
        try {
          value = find();
        } catch (error) {
          return finish(error);
        }
        if (value) return finish(null, value);
        if (Date.now() - startedAt >= timeoutMs) return finish(new Error("WAIT_TIMEOUT"));
      }

      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      timer = setTimeout(check, timeoutMs);
      check();
    });
  }

  function firstClaimDialog() {
    return dialogBoxes().find((box) => {
      const title = dialogText(box, ".jconfirm-title");
      const content = dialogText(box, ".jconfirm-content");
      return title.includes("确认认领") && content.includes("确定要认领") && confirmButton(box);
    });
  }

  function resultDialog(firstBox) {
    return dialogBoxes().find((box) => {
      const title = dialogText(box, ".jconfirm-title");
      return box !== firstBox && title.includes("确认认领") && confirmButton(box);
    });
  }

  async function waitUntilResultSettles(box, token) {
    return waitFor(() => {
      const content = dialogText(box, ".jconfirm-content");
      return content && content !== "..." && !content.includes("请求中")
        ? {
            title: dialogText(box, ".jconfirm-title"),
            message: content,
            button: confirmButton(box)
          }
        : null;
    }, 20000, token);
  }

  async function runOne(button, config, token) {
    const torrentId = logic.torrentIdFromUrl(button.dataset.url);
    const rowTitle = (
      button.closest("tr")?.querySelector('a[href*="details.php?id="]')?.getAttribute("title") ||
      `种子 ${torrentId}`
    ).trim();

    await updateRunState({ currentTorrentId: torrentId, lastMessage: `准备认领：${rowTitle}` });
    button.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleep(logic.randomBetween(config.minActionDelayMs, config.maxActionDelayMs), token);
    button.click();

    const firstBox = await waitFor(firstClaimDialog, 5000, token);
    await sleep(logic.randomBetween(config.minActionDelayMs, config.maxActionDelayMs), token);
    const firstConfirm = confirmButton(firstBox);
    if (!firstConfirm) throw new Error("找不到第一层确定按钮");
    firstConfirm.click();

    const secondBox = await waitFor(() => resultDialog(firstBox), 5000, token);
    const result = await waitUntilResultSettles(secondBox, token);
    const failed = logic.looksLikeFailure(result.title, result.message);
    const previous = await getRunState();
    const torrentDelay = logic.randomBetween(config.minTorrentDelayMs, config.maxTorrentDelayMs);

    await updateRunState({
      running: !failed,
      completed: previous.completed + (failed ? 0 : 1),
      failed: previous.failed + (failed ? 1 : 0),
      currentTorrentId: null,
      nextRunAt: failed ? 0 : Date.now() + torrentDelay,
      lastMessage: `${result.title || (failed ? "认领失败" : "认领完成")}：${result.message}`
    });

    // 站点在 AJAX 完成约 1 秒后刷新。短暂延迟后点击第二层确定按钮。
    await sleep(logic.randomBetween(250, 550), token);
    if (result.button?.isConnected) result.button.click();
    if (failed) throw new Error(`站点返回：${result.message}`);

    // 正常情况下站点会先刷新；这是 response.not_reload 场景的兜底。
    await sleep(1300, token);
    location.reload();
  }

  async function runLoop(token) {
    try {
      const state = await getRunState();
      if (!state.running || token !== generation) return;
      if (state.nextRunAt > Date.now()) await sleep(state.nextRunAt - Date.now(), token);

      const freshState = await getRunState();
      if (!freshState.running || token !== generation) return;

      const button = claimButtons()[0];
      if (!button) {
        await updateRunState({
          running: false,
          currentTorrentId: null,
          nextRunAt: 0,
          lastMessage: "当前列表中没有可认领的种子"
        });
        return;
      }

      await runOne(button, await getConfig(), token);
    } catch (error) {
      if (error?.message === "STOPPED") return;
      await updateRunState({
        running: false,
        currentTorrentId: null,
        nextRunAt: 0,
        lastMessage: `已暂停：${error?.message || "未知错误"}`
      });
    } finally {
      loopPromise = null;
      getRunState().then((state) => {
        if (state.running) ensureLoop();
      });
    }
  }

  function ensureLoop() {
    if (!loopPromise) {
      const token = generation;
      loopPromise = runLoop(token);
    }
    return loopPromise;
  }

  async function start(config) {
    const normalized = logic.normalizeConfig(config);
    generation += 1;
    await storageSet({ [CONFIG_KEY]: normalized });
    await updateRunState({
      running: true,
      completed: 0,
      failed: 0,
      currentTorrentId: null,
      nextRunAt: 0,
      lastMessage: `已启动，发现 ${claimButtons().length} 个可认领种子`
    });
    ensureLoop();
    return status();
  }

  async function stop() {
    generation += 1;
    await updateRunState({ running: false, currentTorrentId: null, nextRunAt: 0, lastMessage: "已由用户停止" });
    return status();
  }

  async function status() {
    return {
      state: await getRunState(),
      config: await getConfig(),
      available: claimButtons().length,
      supported: location.hostname === "pterclub.net" && location.pathname === "/userdetails.php"
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const action = message?.action;
    const operation =
      action === "start" ? start(message.config) : action === "stop" ? stop() : status();
    operation.then(sendResponse).catch((error) => sendResponse({ error: error.message }));
    return true;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[RUN_KEY]) return;
    const next = changes[RUN_KEY].newValue;
    if (next?.running) ensureLoop();
    else generation += 1;
  });

  getRunState().then((state) => {
    if (state.running) ensureLoop();
  });
})();
