const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {JSDOM} = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
function page(body, url = 'https://pt.example/details.php?id=1') {
  const dom = new JSDOM(body, {url, runScripts: 'outside-only'});
  const calls = [];
  dom.window.chrome = {runtime: {sendMessage: async msg => { calls.push(msg); return {ok: true, path: 'D:\\Movie.mkv', text: 'General\nVideo'}; }}};
  dom.window.eval(source);
  return {dom, calls, document: dom.window.document};
}
const tick = () => new Promise(resolve => setTimeout(resolve, 350));

test('single filename, mutation idempotence, and play request', async t => {
  const p = page('<table><tr><td>种子文件</td><td>家族 2022.H264-HDSWEB.mp4</td></tr></table>');
  t.after(() => p.dom.window.close());
  const buttons = p.document.querySelectorAll('[data-quick-play="buttons"] button');
  assert.equal(buttons.length, 2);
  assert.equal(buttons[1].textContent, '获取mediainfo');
  assert.equal(buttons[0].style.background, 'rgb(28, 94, 175)');
  assert.equal(buttons[0].style.color, 'rgb(255, 255, 255)');
  buttons[0].click();
  await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(p.calls)), [{action: 'play', filename: '家族 2022.H264-HDSWEB.mp4'}]);
  assert.equal(p.document.querySelectorAll('[data-quick-play="buttons"]').length, 1);
});

test('copy mediainfo wraps by default, supports raw text, and preserves wrapping in fallback', async t => {
  const p = page('<table><tr><td>种子文件</td><td>movie.mkv</td></tr></table>');
  t.after(() => p.dom.window.close());
  let shadow, copied;
  const attach = p.dom.window.Element.prototype.attachShadow;
  p.dom.window.Element.prototype.attachShadow = function (options) { shadow = attach.call(this, options); return shadow; };
  Object.defineProperty(p.dom.window, 'isSecureContext', {value: true});
  Object.defineProperty(p.dom.window.navigator, 'clipboard', {value: {writeText: async text => { copied = text; }}});
  p.document.querySelectorAll('[data-quick-play="buttons"] button')[1].click();
  await tick();
  assert.equal(shadow.getElementById('copy').textContent, '复制mediainfo');
  const option = shadow.getElementById('wrap');
  const copy = shadow.getElementById('copy');
  const area = shadow.querySelector('textarea');
  const readStatus = shadow.getElementById('read-status');
  const initialStatus = readStatus.textContent;
  assert.match(initialStatus, /已读取：[\s\S]*D:\\Movie.mkv/);
  assert.equal(option.checked, true);
  assert.equal(area.value, '[hide=mediainfo]\nGeneral\nVideo\n[/hide]');
  copy.click(); await new Promise(setImmediate);
  assert.equal(copied, '[hide=mediainfo]\nGeneral\nVideo\n[/hide]');
  assert.equal(readStatus.textContent, initialStatus);
  assert.match(shadow.getElementById('copy-status').textContent, /已复制mediainfo/);
  assert.equal(area.value, '[hide=mediainfo]\nGeneral\nVideo\n[/hide]');
  option.click();
  assert.equal(area.value, 'General\nVideo');
  copy.click(); await new Promise(setImmediate);
  assert.equal(copied, 'General\nVideo');
  option.click();
  assert.equal(area.value, '[hide=mediainfo]\nGeneral\nVideo\n[/hide]');
  p.dom.window.navigator.clipboard.writeText = async () => { throw new Error('denied'); };
  p.document.execCommand = () => { copied = area.value; return true; };
  copy.click(); await new Promise(setImmediate);
  assert.equal(copied, '[hide=mediainfo]\nGeneral\nVideo\n[/hide]');
  assert.equal(area.value, '[hide=mediainfo]\nGeneral\nVideo\n[/hide]');
  p.document.execCommand = () => false;
  copy.click(); await new Promise(setImmediate);
  assert.equal(area.value, '[hide=mediainfo]\nGeneral\nVideo\n[/hide]');
  assert.equal(readStatus.textContent, initialStatus);
  copy.click(); await new Promise(setImmediate);
  assert.equal(area.value, '[hide=mediainfo]\nGeneral\nVideo\n[/hide]');
});

test('expand async list and skip nonmedia in page order', async t => {
  const p = page('<table><tr><td>种子文件</td><td id="files">文件数：3个文件 <a href="#">查看列表</a></td></tr></table>');
  t.after(() => p.dom.window.close());
  p.document.querySelector('a').onclick = e => {
    e.preventDefault();
    p.dom.window.setTimeout(() => p.document.querySelector('#files').insertAdjacentHTML('beforeend', '<table><tr><th>路径</th><th>size</th></tr><tr><td>cover.jpg</td><td>1 MB</td></tr><tr><td>电影/first.mkv</td><td>5 GB</td></tr><tr><td>second.mp4</td><td>5 GB</td></tr></table>'), 30);
  };
  p.document.querySelectorAll('button')[1].click();
  await tick();
  assert.equal(p.calls.length, 1);
  assert.equal(p.calls[0].action, 'info');
  assert.equal(p.calls[0].filename, '电影/first.mkv');
});

test('unrelated tables do not receive buttons', t => {
  const p = page('<table><tr><td>路径</td><td>movie.mkv</td></tr></table>');
  t.after(() => p.dom.window.close());
  assert.equal(p.document.querySelectorAll('button').length, 0);
});

const seedRow = '<table><tr><td>种子文件</td><td>文件数：1个文件 <a href="javascript: viewfilelist(903354, \'种子文件\')">[查看列表]</a></td></tr></table>';
const fileTable = '<table><tr><td>路径</td><td>size</td></tr><tr><td>cover.jpg</td><td>1 MB</td></tr><tr><td class="filename">格斗之王.Mortal.Kombat.1995.mkv</td><td>5.09 GB</td></tr></table>';
const modal = `<div class="jconfirm"><div class="jconfirm-box" role="dialog"><span class="jconfirm-title">种子文件</span><div class="jconfirm-content">${fileTable}</div></div></div>`;

test('PTer retrieves actual modal endpoint without executing javascript href', async t => {
  const p = page(seedRow, 'https://pterclub.net/details.php?id=903354');
  t.after(() => p.dom.window.close());
  let fetched, clicks = 0;
  p.dom.window.fetch = async (url, options) => {
    fetched = {url, credentials: options.credentials};
    return {ok: true, text: async () => fileTable};
  };
  p.document.querySelector('a').onclick = () => clicks++;
  p.document.querySelector('[data-quick-play="buttons"] button').click();
  await tick();
  assert.equal(fetched.url, 'https://pterclub.net/viewfilelist.php?id=903354');
  assert.equal(fetched.credentials, 'same-origin');
  assert.equal(clicks, 0);
  assert.equal(p.calls[0].filename, '格斗之王.Mortal.Kombat.1995.mkv');
  assert.equal(p.calls[0].action, 'play');
});

test('manual modal gets its own buttons and closing it preserves the selected file', async t => {
  const p = page(seedRow, 'https://pterclub.net/details.php?id=903354');
  t.after(() => p.dom.window.close());
  p.document.body.insertAdjacentHTML('beforeend', modal);
  await tick();
  const buttons = p.document.querySelectorAll('[data-quick-play="dialog-buttons"] button');
  assert.equal(buttons.length, 2);
  buttons[1].click();
  await tick();
  assert.equal(p.calls[0].action, 'info');
  assert.equal(p.calls[0].filename, '格斗之王.Mortal.Kombat.1995.mkv');
  p.document.querySelector('.jconfirm').remove();
  p.document.querySelector('[data-quick-play="buttons"] button').click();
  await tick();
  assert.equal(p.calls[1].filename, '格斗之王.Mortal.Kombat.1995.mkv');
});

test('generic async expansion discovers a modal outside the seed-file cell', async t => {
  const p = page(seedRow);
  t.after(() => p.dom.window.close());
  p.document.querySelector('a').onclick = e => {
    e.preventDefault();
    p.dom.window.setTimeout(() => p.document.body.insertAdjacentHTML('beforeend', modal), 30);
  };
  p.document.querySelector('[data-quick-play="buttons"] button').click();
  await tick();
  assert.equal(p.calls[0].filename, '格斗之王.Mortal.Kombat.1995.mkv');
});

test('an unrelated dialog and a login response cannot be mistaken for a file list', async t => {
  const p = page(seedRow + '<div role="dialog" aria-label="影片参数"><table><tr><td>other.mkv</td></tr></table></div>', 'https://pterclub.net/details.php?id=903354');
  t.after(() => p.dom.window.close());
  p.dom.window.fetch = async () => ({ok: true, text: async () => '<h1>请登录</h1><p>other.mkv</p>'});
  p.document.querySelector('[data-quick-play="buttons"] button').click();
  await tick();
  assert.equal(p.calls.length, 0);
  assert.equal(p.document.querySelectorAll('[data-quick-play="dialog-buttons"]').length, 0);
});

test('only extension settings can configure native host', () => {
  let listener;
  const sent = [];
  const chrome = {action: {onClicked: {addListener() {}}}, runtime: {
    onMessage: {addListener(fn) { listener = fn; }},
    getURL: name => `chrome-extension://abc/${name}`,
    sendNativeMessage: (host, message, reply) => { sent.push(message); reply({ok: true}); }
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8'), {chrome});
  let response;
  listener({action: 'configure', config: {}}, {url: 'https://pt.example'}, r => response = r);
  assert.equal(response.ok, false);
  assert.equal(sent.length, 0);
  listener({action: 'play', filename: 'movie.mkv', config: {roots: ['C:\\']}}, {url: 'https://pt.example'}, () => {});
  assert.equal(sent[0].config, undefined);
  listener({action: 'configure', config: {}}, {url: 'chrome-extension://abc/options.html'}, () => {});
  assert.equal(sent[1].action, 'configure');
});
