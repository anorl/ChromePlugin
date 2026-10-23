import {withSourceReferer} from './request-context.js';
import {showPageFeedback} from './page-feedback.js';

const MENU = 'pter-upload-image';
let creating;
let queue = Promise.resolve();

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({id:MENU, title:'上传至 PTerClub 并复制 BBCode', contexts:['image']});
  });
});

async function offscreen() {
  const contexts = await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'], documentUrls:[chrome.runtime.getURL('offscreen.html')]});
  if (contexts.length) return;
  if (!creating) creating = chrome.offscreen.createDocument({url:'offscreen.html', reasons:['CLIPBOARD', 'DOM_PARSER'], justification:'上传图片并自动复制 BBCode 到剪贴板'}).finally(() => { creating = null; });
  await creating;
}

async function badge(text, title, color) {
  await Promise.all([chrome.action.setBadgeText({text}), chrome.action.setBadgeBackgroundColor({color}), chrome.action.setTitle({title})]);
}

async function notifyPage(info, tabId, message, state) {
  if (!Number.isInteger(tabId)) return;
  try {
    await chrome.scripting.executeScript({
      target:{tabId, frameIds:[info.frameId ?? 0]},
      func:showPageFeedback,
      args:[info.srcUrl, message, state, info.frameUrl || info.pageUrl || '']
    });
  } catch {
    // A closed tab or a restricted browser page cannot display feedback.
    // The upload result remains available in the popup and toolbar badge.
  }
}

async function run(info, tabId) {
  try {
    await chrome.storage.local.set({status:{state:'uploading', message:'正在读取并上传图片…', startedAt:Date.now()}});
    await badge('…', '正在上传图片…', '#2563eb');
    await offscreen();
    const {privacy = 'private'} = await chrome.storage.local.get('privacy');
    const result = await withSourceReferer(info, () => chrome.runtime.sendMessage({target:'offscreen', type:'upload', srcUrl:info.srcUrl, privacy}));
    if (!result?.ok) throw new Error(result?.error || '上传进程未返回结果。请先到图床检查是否上传成功。');
    const message = result.copied ? '上传成功，BBCode 已复制。' : result.error;
    await chrome.storage.local.set({status:{state:result.copied ? 'success' : 'warning', message}});
    await badge(result.copied ? 'OK' : '!', message, result.copied ? '#15803d' : '#b45309');
    await notifyPage(info, tabId, result.copied ? '上传成功，BBCode 已复制' : `图片已上传，但${result.error}`, result.copied ? 'success' : 'warning');
  } catch (error) {
    await chrome.storage.local.set({status:{state:'error', message:error.message}});
    await badge('!', error.message, '#b91c1c');
    await notifyPage(info, tabId, error.message, 'error');
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU) return;
  queue = queue.then(() => run(info, tab?.id)).catch(console.error);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message.target !== 'background') return;
  if (message.type === 'uploaded' && sender.url === chrome.runtime.getURL('offscreen.html')) {
    (async () => {
      const {history = []} = await chrome.storage.local.get('history');
      const entry = {...message.result, time:Date.now()};
      await chrome.storage.local.set({lastResult:entry, history:[entry, ...history].slice(0, 5)});
      return {ok:true};
    })().then(sendResponse, error => sendResponse({ok:false, error:error.message}));
    return true;
  }
});
