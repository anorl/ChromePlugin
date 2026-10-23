import {normalizeSettings} from './core.js';
const $ = id => document.getElementById(id);
const fields = ['qbUrl', 'savePath', 'category', 'layout'];
const read = () => normalizeSettings(Object.fromEntries(fields.map(id => [id, $(id).value])));
function feedback(text, error = false) {
  $('feedback').textContent = text;
  $('feedback').title = text;
  $('feedback').className = error ? 'error' : '';
}
function renderStatus(value) {
  $('status').textContent = value ? value.message : '尚未执行';
  $('statusTime').textContent = value ? new Date(value.time).toLocaleString() : '';
  if (value) $('statusTime').dateTime = new Date(value.time).toISOString();
  else $('statusTime').removeAttribute('datetime');
  $('status').title = $('status').textContent;
}
const saved = await chrome.storage.local.get(['settings', 'status']);
for (const field of fields) $(field).value = saved.settings?.[field] || (field === 'layout' ? 'Original' : '');
renderStatus(saved.status);
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.status) renderStatus(changes.status.newValue); });
$('settings').addEventListener('submit', async event => {
  event.preventDefault();
  try { await chrome.storage.local.set({settings:read()}); feedback('配置已保存。'); }
  catch (error) { feedback(error.message, true); }
});
$('test').addEventListener('click', async () => {
  $('test').disabled = true;
  feedback('正在测试当前填写的地址…');
  try {
    const result = await chrome.runtime.sendMessage({type:'test', settings:read()});
    if (!result?.ok) throw new Error(result?.error || '测试未返回结果。');
    feedback(`连接成功，QB ${result.version}。修改过的配置需点击“保存配置”。`);
  } catch (error) { feedback(error.message, true); }
  finally { $('test').disabled = false; }
});
$('open').addEventListener('click', () => {
  try { chrome.tabs.create({url:`${read().qbUrl}/`}); }
  catch (error) { feedback(error.message, true); }
});
