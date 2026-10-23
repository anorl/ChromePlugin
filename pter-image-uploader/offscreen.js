import {SITE, parseToken, makeForm, parseUpload, validateSource, readImage} from './protocol.js';

function copy(text) {
  const input = document.getElementById('clipboard');
  input.value = text;
  input.select();
  // An offscreen document cannot be focused; execCommand works with clipboardWrite.
  if (!document.execCommand('copy')) throw new Error('自动复制失败，请在插件弹窗中点击「复制 BBCode」。');
  input.value = '';
}

async function upload(message) {
  validateSource(message.srcUrl);
  const page = await fetch(`${SITE}/`, {credentials:'include', cache:'no-store', signal:AbortSignal.timeout(25000)});
  if (!page.ok) throw new Error(`图床访问失败（HTTP ${page.status}）。请打开图床完成登录或安全验证。`);
  const token = parseToken(await page.text(), page.url);
  const response = await fetch(message.srcUrl, {credentials:'include', signal:AbortSignal.timeout(25000)});
  const blob = await readImage(response);
  const result = await new Promise((resolve, reject) => {
    // XHR runs in the offscreen document, avoiding service-worker fetch timeouts.
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${SITE}/json`);
    xhr.withCredentials = true;
    xhr.timeout = 120000;
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.onload = () => { try { resolve(parseUpload(xhr.status, xhr.responseText)); } catch (error) { reject(error); } };
    xhr.onerror = () => reject(new Error('上传连接中断。请先到图床检查是否已收到图片，避免重复上传。'));
    xhr.ontimeout = () => reject(new Error('上传超时。请先到图床检查是否已收到图片，避免重复上传。'));
    xhr.send(makeForm(blob, token, message.privacy));
  });
  // Persist the URL in the worker before attempting clipboard access.
  await chrome.runtime.sendMessage({target:'background', type:'uploaded', result});
  try { copy(result.bbcode); return {...result, copied:true}; }
  catch (error) { return {...result, copied:false, error:error.message}; }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message.target !== 'offscreen') return;
  if (message.type === 'upload') {
    upload(message).then(result => sendResponse({ok:true, ...result}), error => sendResponse({ok:false, error:error.message}));
    return true;
  }
  if (message.type === 'copy') {
    try { copy(message.text); sendResponse({ok:true}); }
    catch (error) { sendResponse({ok:false, error:error.message}); }
  }
});
