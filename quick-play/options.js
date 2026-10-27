const $ = id => document.getElementById(id);
$('install').textContent = `powershell -NoProfile -ExecutionPolicy Bypass -File "D:\\PX\\code\\ChromePlugin\\quick-play\\native\\install.ps1" -ExtensionId ${chrome.runtime.id}`;
let defaultRow;
function syncDefault() {
  const rows = [...$('paths').children];
  if (!rows.includes(defaultRow)) defaultRow = rows.find(row => /(?:^|[\\/])WD12T-2(?:[\\/]|$)/i.test(row.querySelector('.path-input').value)) || rows[0];
  for (const row of rows) {
    const selected = row === defaultRow;
    row.querySelector('input[type="radio"]').checked = selected;
    row.classList.toggle('is-default', selected);
  }
}
function addPath(root = '') {
  const row = document.createElement('div');
  row.className = 'path-row';
  const input = document.createElement('input');
  input.type = 'text'; input.className = 'path-input';
  input.value = root; input.placeholder = '\\\\192.168.12.20\\data\\sda';
  input.required = true; input.setAttribute('aria-label', '视频目录');
  const label = document.createElement('label');
  label.className = 'default-choice';
  const radio = document.createElement('input');
  radio.type = 'radio'; radio.name = 'default-path';
  radio.onchange = () => { defaultRow = row; syncDefault(); };
  label.append(radio, '默认');
  const remove = document.createElement('button');
  remove.type = 'button'; remove.textContent = '删除';
  remove.setAttribute('aria-label', '删除此目录');
  remove.onclick = () => { row.remove(); syncDefault(); };
  row.append(input, label, remove);
  $('paths').append(row);
  syncDefault();
}
function showConfig(config) {
  $('potplayer').value = config.potplayer || '';
  $('mediainfo').value = config.mediainfo || '';
  $('paths').replaceChildren();
  (config.roots || []).forEach(addPath);
  defaultRow = [...$('paths').children].find(row => row.querySelector('.path-input').value === config.defaultRoot);
  syncDefault();
}
async function request(message) {
  $('status').textContent = '正在连接本地助手…';
  try {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok) throw new Error(result?.error || '没有响应');
    if (result.config) showConfig(result.config);
    $('status').textContent = message.action === 'configure' ? '配置已保存。刷新 PT 详情页即可使用。' : '本地助手已连接，已读取当前配置。';
  } catch (e) { $('status').textContent = e.message; }
}
$('load').onclick = () => request({action: 'status'});
$('add').onclick = () => addPath();
$('form').onsubmit = e => {
  e.preventDefault();
  const roots = [...$('paths').querySelectorAll('.path-input')].map(input => input.value.trim());
  if (!roots.length || roots.length > 20) { $('status').textContent = '请配置 1 至 20 个视频目录。'; return; }
  const defaultRoot = defaultRow?.querySelector('.path-input').value.trim();
  request({action: 'configure', config: {potplayer: $('potplayer').value.trim(), mediainfo: $('mediainfo').value.trim(), roots, defaultRoot}});
};
(async () => {
  try {
    const defaults = await (await fetch(chrome.runtime.getURL('defaults.json'))).json();
    showConfig(defaults);
    await request({action: 'status'});
  } catch (e) { $('status').textContent = `读取默认配置失败：${e.message}`; }
})();
