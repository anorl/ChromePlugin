const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const base = path.join(__dirname, '..');
const defaults = JSON.parse(fs.readFileSync(path.join(base, 'defaults.json'), 'utf8'));
async function settings(t, saved) {
  const dom = new JSDOM(fs.readFileSync(path.join(base, 'options.html'), 'utf8'), {url: 'https://extension.test/options.html', runScripts: 'outside-only'});
  t.after(() => dom.window.close());
  const calls = [];
  dom.window.fetch = async () => ({json: async () => structuredClone(defaults)});
  dom.window.chrome = {runtime: {id: 'a'.repeat(32), getURL: file => file, sendMessage: async message => {
    calls.push(message);
    return {ok: true, config: message.action === 'configure' ? message.config : structuredClone(saved || defaults)};
  }}};
  dom.window.eval(fs.readFileSync(path.join(base, 'options.js'), 'utf8'));
  await new Promise(resolve => setTimeout(resolve, 0));
  return {document: dom.window.document, dom, calls};
}

test('six editable path rows render with WD12T-2 selected', async t => {
  const {document, dom, calls} = await settings(t);
  assert.equal(document.querySelectorAll('.path-row').length, 6);
  const selected = document.querySelector('input[type="radio"]:checked').closest('.path-row');
  assert.equal(selected.querySelector('.path-input').value, '\\\\192.168.12.20\\data\\WD12T-2\\down');
  const input = document.querySelector('.path-input');
  input.value = '\\\\192.168.12.20\\data\\sda\\movies';
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
  assert.equal(checked[0].closest('.path-row').querySelector('.path-input').value, '\\\\192.168.12.20\\data\\WD12T-2\\down');
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
