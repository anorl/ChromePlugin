const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const base = path.join(__dirname, '..');
const defaults = JSON.parse(fs.readFileSync(path.join(base, 'defaults.json'), 'utf8'));
const sample = {potplayer: 'C:\\Player.exe', mediainfo: 'C:\\MediaInfo.exe', roots: ['D:\\Movies', 'E:\\Series'], defaultRoot: 'E:\\Series'};
async function settings(t, saved = sample, connected = true) {
  const dom = new JSDOM(fs.readFileSync(path.join(base, 'options.html'), 'utf8'), {url: 'https://extension.test/options.html', runScripts: 'outside-only'});
  t.after(() => dom.window.close());
  const calls = [];
  dom.window.fetch = async () => ({json: async () => structuredClone(defaults)});
  dom.window.chrome = {runtime: {id: 'a'.repeat(32), getURL: file => file, sendMessage: async message => {
    calls.push(message);
    return connected ? {ok: true, config: message.action === 'configure' ? message.config : structuredClone(saved)} : {ok: false, error: 'Local helper is not installed'};
  }}};
  dom.window.eval(fs.readFileSync(path.join(base, 'options.js'), 'utf8'));
  await new Promise(resolve => setTimeout(resolve, 0));
  return {document: dom.window.document, dom, calls};
}

test('saved path rows render with the saved default selected', async t => {
  const {document, dom, calls} = await settings(t);
  assert.equal(document.querySelectorAll('.path-row').length, 2);
  const selected = document.querySelector('input[type="radio"]:checked').closest('.path-row');
  assert.equal(selected.querySelector('.path-input').value, 'E:\\Series');
  const input = document.querySelector('.path-input');
  input.value = 'D:\\NewMovies';
  document.getElementById('form').dispatchEvent(new dom.window.Event('submit', {cancelable: true}));
  const saved = calls.at(-1).config;
  assert.equal(saved.roots[0], input.value);
  assert.equal(saved.defaultRoot, selected.querySelector('.path-input').value);
});

test('switching, editing, and removing the default path keeps exactly one selection', async t => {
  const {document, dom, calls} = await settings(t);
  document.querySelector('input[type="radio"]').click();
  document.querySelector('.path-input').value = 'D:\\Movies';
  document.getElementById('form').dispatchEvent(new dom.window.Event('submit', {cancelable: true}));
  assert.equal(calls.at(-1).config.defaultRoot, 'D:\\Movies');
  await new Promise(resolve => setTimeout(resolve, 0));
  document.querySelector('.path-row button').click();
  const checked = document.querySelectorAll('input[type="radio"]:checked');
  assert.equal(checked.length, 1);
  assert.equal(checked[0].closest('.path-row').querySelector('.path-input').value, 'E:\\Series');
});

test('first install opens the guide with program defaults and a blank video directory', async t => {
  const {document} = await settings(t, defaults, false);
  assert.equal(document.getElementById('setup').open, true);
  assert.equal(document.querySelectorAll('.path-row').length, 1);
  assert.equal(document.querySelector('.path-input').value, '');
  assert.equal(document.getElementById('potplayer').value, defaults.potplayer);
  assert.equal(document.getElementById('mediainfo').value, defaults.mediainfo);
  assert.match(document.getElementById('setup').textContent, /install\.cmd/);
  assert.ok(document.querySelector('#mediainfo-help a[href="https://mediaarea.net/en/MediaInfo/Download/Windows"]'));
});

test('saved paths stay intact; add and remove remain available', async t => {
  const {document, calls} = await settings(t, {roots: ['D:\\Custom'], potplayer: 'C:\\Player.exe', defaultRoot: 'D:\\Custom'});
  assert.equal(document.querySelectorAll('.path-row').length, 1);
  assert.equal(document.querySelector('.path-input').value, 'D:\\Custom');
  assert.equal(calls.length, 1);
  document.getElementById('add').click();
  assert.equal(document.querySelectorAll('.path-row').length, 2);
  document.querySelector('.path-row:last-child button').click();
  assert.equal(document.querySelectorAll('.path-row').length, 1);
});
