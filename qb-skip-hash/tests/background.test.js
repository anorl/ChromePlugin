import test from 'node:test';
import assert from 'node:assert/strict';

test('right-click workflow: authenticated file upload, result verification, duplicate and failure handling', async () => {
  const previous = {chrome:globalThis.chrome, fetch:globalThis.fetch};
  const listeners = {}, rules = [], calls = [], statuses = [], menus = [], notices = [];
  const settings = {qbUrl:'https://qb.example/proxy', savePath:'/media', layout:'Original'};
  const bytes = 'd4:infod6:lengthi1e4:name1:x12:piece lengthi16384e6:pieces20:abcdefghijklmnopqrstee';
  let mode = 'normal', added = false, finish;
  globalThis.chrome = {
    runtime:{id:'testextension', getURL:path => `chrome-extension://testextension/${path}`, onInstalled:{addListener:fn => listeners.install = fn}, onStartup:{addListener:fn => listeners.startup = fn}, onMessage:{addListener:fn => listeners.message = fn}},
    contextMenus:{onClicked:{addListener:fn => listeners.click = fn}, removeAll:async () => {}, create:value => menus.push(value), update:async (id, value) => menus.push({id, ...value})},
    storage:{onChanged:{addListener:fn => listeners.changed = fn}, local:{get:async () => ({settings}), set:async value => { statuses.push(value.status); if (value.status.state !== 'busy') finish?.(); }}},
    declarativeNetRequest:{updateSessionRules:async value => { rules.push(value); }},
    scripting:{executeScript:async ({target, func, args}) => {
      if (func.name === 'renderPageNotice') {
        assert.equal(target.tabId, 1);
        if (args[0].state !== 'busy') assert.deepEqual(target.documentIds, ['source-document']);
        notices.push(args[0]);
        return [{documentId:'source-document'}];
      }
      assert.deepEqual(target, {tabId:1, frameIds:[0]});
      assert.equal(func.name, 'findTorrentLink');
      return [{result:'https://pt.example/download.php?id=1&passkey=secret'}];
    }},
    action:{setBadgeText:async () => {}, setBadgeBackgroundColor:async () => {}, setTitle:async () => {}}
  };
  globalThis.fetch = async (url, init) => {
    calls.push({url, init});
    assert.equal(init.credentials, 'include');
    if (url.includes('/app/version')) return new Response('v5.1.2', {status:mode === 'auth' ? 403 : 200});
    if (url.startsWith('https://pt.example/')) return new Response(mode === 'html' ? '<html>captcha</html>' : bytes);
    if (url.includes('/torrents/info')) return Response.json(added || mode === 'duplicate' ? [{hash:'x', state:'stalledUP', save_path:'/media'}] : []);
    if (url.endsWith('/torrents/add')) {
      assert.equal(init.method, 'POST');
      assert.equal(init.body.get('skip_checking'), 'true');
      assert.equal(await init.body.get('torrents').text(), bytes);
      added = mode !== 'reject';
      return new Response(mode === 'reject' ? 'Fails.' : 'Ok.');
    }
    throw new Error('Unexpected request');
  };
  try {
    await import('../background.js');
    listeners.install();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok(menus.at(-1).title.includes(settings.qbUrl));
    listeners.changed({settings:{newValue:{qbUrl:'http://192.168.1.20:8080/qb/'}}}, 'local');
    assert.ok(menus.at(-1).title.includes('http://192.168.1.20:8080/qb'));
    listeners.changed({settings:{newValue:{}}}, 'local');
    assert.match(menus.at(-1).title, /请先配置地址/);
    const run = async (nextMode, blankPage = false) => {
      mode = nextMode; added = false; calls.length = 0; rules.length = 0;
      await new Promise(resolve => {
        finish = resolve;
        listeners.click({menuItemId:'send-to-qb', ...(!blankPage && {linkUrl:'https://pt.example/download.php?id=1&passkey=secret'}), pageUrl:'https://pt.example/details.php?id=1&secret=private'}, {id:1});
      });
      // Wait for the worker's final rule cleanup after its status write.
      await new Promise(resolve => setTimeout(resolve, 10));
      return statuses.at(-1);
    };
    assert.match((await run('normal')).message, /已进入做种队列/);
    assert.equal(notices.at(-1).title, `已下载至 ${settings.qbUrl}`);
    assert.equal(notices.at(-1).state, 'success');
    assert.ok(calls.some(call => call.url.endsWith('/torrents/add')));
    for (const rule of rules.flatMap(change => change.addRules || [])) {
      assert.deepEqual(rule.condition.initiatorDomains, ['testextension']);
      for (const header of rule.action.requestHeaders) assert.ok(!header.value.includes('secret'));
    }
    assert.deepEqual(rules.at(-1), {removeRuleIds:[1]});
    assert.match((await run('normal', true)).message, /已进入做种队列/);
    assert.ok(calls.some(call => call.url === 'https://pt.example/download.php?id=1&passkey=secret'));
    assert.match((await run('duplicate')).message, /已存在/);
    assert.match(notices.at(-1).title, /已存在于/);
    assert.ok(!calls.some(call => call.url.endsWith('/torrents/add')));
    assert.equal((await run('html')).state, 'error');
    assert.equal(notices.at(-1).state, 'error');
    assert.ok(!calls.some(call => call.url.endsWith('/torrents/add')));
    assert.equal((await run('auth')).state, 'error');
    assert.equal(calls.length, 1);
    assert.match((await run('reject')).message, /未接受/);
    assert.equal(notices.at(-1).state, 'error');
  } finally { globalThis.chrome = previous.chrome; globalThis.fetch = previous.fetch; }
});
