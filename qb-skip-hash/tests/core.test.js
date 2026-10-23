import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {normalizeSettings, httpUrl, torrentHash, addForm, testConnection, findTorrentLink} from '../core.js';

const info = 'd6:lengthi1e4:name1:x12:piece lengthi16384e6:pieces20:abcdefghijklmnopqrste';
const torrent = `d4:info${info}e`;
const buffer = text => new TextEncoder().encode(text).buffer;

test('normalizes base path without losing reverse proxy prefix', () => {
  assert.deepEqual(normalizeSettings({qbUrl:' https://qb.example/qb/// ', savePath:' /data ', category:' movie '}), {
    qbUrl:'https://qb.example/qb', savePath:'/data', category:'movie', layout:'Original'
  });
  for (const qbUrl of ['', 'ftp://qb', 'http://user:password@qb', 'http://qb/?secret=x', 'http://qb/#x']) {
    assert.throws(() => normalizeSettings({qbUrl}));
  }
  assert.throws(() => httpUrl('magnet:?xt=urn:btih:x'));
  assert.throws(() => httpUrl('javascript:alert(1)'));
});

test('hashes original info bytes and handles v2 truncated hash', async () => {
  assert.equal(await torrentHash(buffer(torrent)), createHash('sha1').update(info).digest('hex'));
  const v2 = 'd12:meta versioni2e4:name1:xe';
  assert.equal(await torrentHash(buffer(`d4:info${v2}e`)), createHash('sha256').update(v2).digest('hex').slice(0, 40));
});

test('rejects HTML, truncated files, trailing junk, malformed bencode and duplicate info', async () => {
  for (const text of ['<html>login</html>', torrent.slice(0, -1), torrent + 'junk', 'd4:infoi1ee', 'd4:infod4:name1:xee', `d4:info${info}4:info${info}e`, 'd1:xi03ee']) {
    await assert.rejects(torrentHash(buffer(text)), /有效的/);
  }
});

test('form fixes skip checking and startup, keeps manual existing-data path', async () => {
  const settings = normalizeSettings({qbUrl:'http://qb', savePath:'/data', category:'movie', layout:'NoSubfolder'});
  const form = addForm(settings, new Blob([torrent]));
  assert.equal(form.get('skip_checking'), 'true');
  assert.equal(form.get('paused'), 'false');
  assert.equal(form.get('stopped'), 'false');
  assert.equal(form.get('autoTMM'), 'false');
  assert.equal(form.get('savepath'), '/data');
  assert.equal(form.get('contentLayout'), 'NoSubfolder');
  assert.equal(form.get('category'), 'movie');
  assert.equal(await form.get('torrents').text(), torrent);
  const defaults = addForm(normalizeSettings({qbUrl:'http://qb'}), new Blob());
  assert.equal(defaults.has('savepath'), false);
  assert.equal(defaults.has('category'), false);
});

test('connection uses browser credentials and rejects 403 and login HTML', async () => {
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, 'https://qb.example/proxy/api/v2/app/version');
      assert.equal(init.credentials, 'include');
      assert.equal(init.redirect, 'error');
      return new Response('v5.1.2');
    };
    const settings = normalizeSettings({qbUrl:'https://qb.example/proxy'});
    assert.equal(await testConnection(settings), 'v5.1.2');
    globalThis.fetch = async () => new Response('Forbidden', {status:403});
    await assert.rejects(testConnection(settings), /同一浏览器/);
    globalThis.fetch = async () => new Response('<html>login</html>');
    await assert.rejects(testConnection(settings), /版本/);
    globalThis.fetch = async () => { throw new TypeError('network'); };
    await assert.rejects(testConnection(settings), /无法访问 QB/);
  } finally { globalThis.fetch = oldFetch; }
});

test('detail-page discovery accepts one entry, deduplicates and refuses ambiguous pages', () => {
  const oldDocument = globalThis.document;
  let links = [];
  globalThis.document = {baseURI:'https://pt.example/details.php?id=1', querySelectorAll:() => links};
  const link = href => ({href, textContent:'下载', title:''});
  try {
    links = [link('https://pt.example/download.php?id=1'), link('https://pt.example/download.php?id=1')];
    assert.equal(findTorrentLink(), 'https://pt.example/download.php?id=1');
    links.push(link('https://pt.example/download.php?id=2'));
    assert.equal(findTorrentLink(), 'https://pt.example/download.php?id=1');
    globalThis.document.baseURI = 'https://pt.example/torrents.php';
    assert.throws(findTorrentLink, /多个/);
    links = [link('javascript:download()')];
    assert.throws(findTorrentLink, /未找到/);
  } finally { globalThis.document = oldDocument; }
});

test('PTerClub blank-page discovery matches the supplied download link and current torrent ID', () => {
  const oldDocument = globalThis.document;
  let links = [];
  globalThis.document = {
    URL:'https://pterclub.net/details.php?id=901553&hit=1',
    baseURI:'https://pterclub.net/', querySelectorAll:() => links
  };
  try {
    links = [
      {href:'/download.php?id=901553', textContent:'下载种子', title:'下载种子'},
      {href:'/download.php?id=100000', textContent:'下载种子', title:'推荐种子'},
      {href:'/torrents.php', textContent:'种子列表', title:''}
    ];
    assert.equal(findTorrentLink(), 'https://pterclub.net/download.php?id=901553');
    links[0] = {href:'/download.php?id=901553&passkey=example', textContent:'', title:'下载种子'};
    assert.equal(findTorrentLink(), 'https://pterclub.net/download.php?id=901553&passkey=example');
    links.shift();
    assert.throws(findTorrentLink, /未找到/);
  } finally { globalThis.document = oldDocument; }
});
