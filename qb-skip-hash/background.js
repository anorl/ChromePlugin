import {normalizeSettings, httpUrl, findTorrentLink, torrentHash, qbRequest, testConnection, addForm} from './core.js';
import {createPageNotifier} from './page-notice.js';

const MENU = 'send-to-qb';
let queue = Promise.resolve();
const serialize = work => { const result = queue.then(work); queue = result.catch(() => {}); return result; };

function menuTitle(settings) {
  let address;
  try { address = normalizeSettings(settings).qbUrl; } catch { /* Not configured yet. */ }
  return address ? `下载至 QB：${address}（跳过哈希校验）` : '下载至 QB（请先配置地址）';
}

async function createMenu() {
  const {settings} = await chrome.storage.local.get('settings');
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({id:MENU, title:menuTitle(settings), contexts:['page', 'link'], documentUrlPatterns:['http://*/*', 'https://*/*']});
}

chrome.runtime.onInstalled.addListener(() => { createMenu().catch(console.error); });
chrome.runtime.onStartup.addListener(() => { createMenu().catch(console.error); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) {
    chrome.contextMenus.update(MENU, {title:menuTitle(changes.settings.newValue)}).catch(() => createMenu().catch(console.error));
  }
});

function refererRule(id, base, referer, origin = false) {
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {id, priority:1, action:{type:'modifyHeaders', requestHeaders:[
    {header:'Referer', operation:'set', value:referer},
    ...(origin ? [{header:'Origin', operation:'set', value:new URL(base).origin}] : [])
  ]}, condition:{regexFilter:`^${escaped}`, isUrlFilterCaseSensitive:true, initiatorDomains:[chrome.runtime.id], resourceTypes:['xmlhttprequest']}};
}

async function withQb(settings, work) {
  await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[1], addRules:[refererRule(1, `${settings.qbUrl}/api/v2/`, `${settings.qbUrl}/`, true)]});
  try { return await work(); }
  finally { await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[1]}); }
}

async function status(state, message) {
  await chrome.storage.local.set({status:{state, message, time:Date.now()}});
  await Promise.all([
    chrome.action.setBadgeText({text:state === 'busy' ? '…' : state === 'error' ? '!' : 'OK'}),
    chrome.action.setBadgeBackgroundColor({color:state === 'error' ? '#b91c1c' : state === 'busy' ? '#2563eb' : '#15803d'}),
    chrome.action.setTitle({title:message})
  ]);
}

async function downloadTorrent(url, pageUrl) {
  const source = httpUrl(url);
  const page = httpUrl(pageUrl);
  const referer = source.protocol === 'http:' && page.protocol === 'https:' ? `${source.origin}/` : `${page.origin}/`;
  await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[2], addRules:[refererRule(2, `${source.origin}/`, referer)]});
  try {
    const response = await fetch(source.href, {credentials:'include', signal:AbortSignal.timeout(20000)});
    if (!response.ok) throw new Error(`种子下载失败（HTTP ${response.status}），请先登录种子站。`);
    // Stream with a limit: a mistaken media URL must not consume unbounded memory.
    const reader = response.body.getReader(), chunks = [];
    let length = 0;
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 20 * 1024 * 1024) { await reader.cancel(); throw new Error('下载结果超过 20 MB，请确认右键的是种子文件链接。'); }
      chunks.push(value);
    }
    return new Blob(chunks, {type:'application/x-bittorrent'});
  } catch (error) {
    if (['TimeoutError', 'TypeError'].includes(error.name)) throw new Error('无法下载种子，请检查站点登录、网络或验证码。');
    throw error;
  } finally { await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[2]}); }
}

async function torrentInfo(settings, hash) {
  const response = await qbRequest(settings, `torrents/info?hashes=${hash}`);
  const result = await response.json().catch(() => null);
  if (!Array.isArray(result)) throw new Error('QB 没有返回种子列表，请检查登录状态和地址。');
  return result[0];
}

async function run(info, tab) {
  const notify = createPageNotifier(tab?.id);
  let destination = '';
  try {
    await notify('busy', '正在下载种子至 QB…', '正在读取种子并检查 QB 连接，请稍候。');
    await status('busy', '正在读取种子并提交到 QB…');
    const {settings:stored} = await chrome.storage.local.get('settings');
    const settings = normalizeSettings(stored);
    destination = settings.qbUrl;
    await notify('busy', `正在下载至 ${destination}`, '正在读取种子并检查 QB 连接，请稍候。');
    let link = info.linkUrl;
    if (!link) {
      const results = await chrome.scripting.executeScript({target:{tabId:tab.id, frameIds:[info.frameId || 0]}, func:findTorrentLink});
      link = results[0]?.result;
      if (!link) throw new Error('未找到唯一的下载入口，请直接右键种子下载链接。');
    }
    httpUrl(link);
    await withQb(settings, async () => {
      await testConnection(settings);
      const blob = await downloadTorrent(link, info.frameUrl || info.pageUrl || tab.url);
      const hash = await torrentHash(await blob.arrayBuffer());
      if (await torrentInfo(settings, hash)) {
        await status('success', 'QB 中已存在这个种子，未重复添加，也未修改现有任务。');
        await notify('success', `该种子已存在于 ${destination}`, '未重复添加，也未修改现有任务。');
        return;
      }
      const response = await qbRequest(settings, 'torrents/add', {method:'POST', body:addForm(settings, blob)});
      if ((await response.text()).trim() !== 'Ok.') throw new Error('QB 未接受种子文件，请检查种子是否有效。');
      let added;
      for (let attempt = 0; attempt < 4; attempt++) {
        added = await torrentInfo(settings, hash);
        if (added) break;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (!added) throw new Error('QB 已接受添加请求，但暂未查到任务。请到 WebUI 确认后再操作。');
      const seeding = ['uploading', 'stalledUP', 'queuedUP', 'forcedUP'].includes(added.state);
      const detail = `保存位置：${added.save_path || settings.savePath || 'QB 默认路径'}；状态：${added.state}`;
      const message = `${seeding ? '已添加，QB 已进入做种队列' : '已添加并请求跳过哈希校验，请在 QB 确认文件路径及做种状态'}。${detail}`;
      await status('success', message);
      await notify('success', `已下载至 ${destination}`, message);
    });
  } catch (error) {
    const message = error.message || '操作失败，请检查配置。';
    await status('error', message);
    await notify('error', destination ? `下载至 ${destination} 失败或未确认` : '下载至 QB 失败', message);
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU) serialize(() => run(info, tab));
});

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('options.html') || message.type !== 'test') return;
  serialize(async () => {
    const settings = normalizeSettings(message.settings);
    return withQb(settings, async () => ({ok:true, version:await testConnection(settings)}));
  }).then(reply, error => reply({ok:false, error:error.message}));
  return true;
});
