import {test} from 'node:test';
import assert from 'node:assert/strict';

test('后台完整流程：读取会话、下载原图、上传、先保存链接后复制，复制失败不重新上传', async () => {
  let listener;
  let copyWorks = true;
  let uploads = 0;
  const events = [];
  const textarea = {value:'', select() {}};
  globalThis.document = {
    getElementById:() => textarea,
    execCommand(command) {assert.equal(command, 'copy'); events.push('copy'); return copyWorks;}
  };
  globalThis.chrome = {runtime:{
    id:'test-extension',
    onMessage:{addListener(fn) {listener = fn;}},
    async sendMessage(message) {
      assert.equal(message.type, 'uploaded');
      assert.equal(message.result.bbcode, '[img]https://cdn.example/original.png[/img]');
      events.push('persist');
      return {ok:true};
    }
  }};
  globalThis.fetch = async (url, options) => {
    assert.equal(options.credentials, 'include');
    if (url === 'https://s3.pterclub.net/') {
      const response = new Response('PF.obj.config.auth_token = "session-token";');
      Object.defineProperty(response, 'url', {value:url});
      return response;
    }
    assert.equal(url, 'https://source.example/picture');
    return new Response(new Uint8Array([1,2,3]), {headers:{'content-type':'image/png'}});
  };
  globalThis.XMLHttpRequest = class {
    open(method, url) {assert.equal(method, 'POST'); assert.equal(url, 'https://s3.pterclub.net/json');}
    setRequestHeader() {}
    send(form) {
      assert.equal(this.withCredentials, true);
      assert.equal(form.get('auth_token'), 'session-token');
      assert.equal(form.get('source').size, 3);
      assert.equal(form.get('privacy'), 'private');
      uploads++;
      this.status = 200;
      this.responseText = JSON.stringify({status_code:200,image:{url:'https://cdn.example/original.png'}});
      queueMicrotask(() => this.onload());
    }
  };
  await import('../offscreen.js');
  const invoke = () => new Promise(resolve => {
    const keepAlive = listener({target:'offscreen',type:'upload',srcUrl:'https://source.example/picture'}, {id:'test-extension'}, resolve);
    assert.equal(keepAlive, true);
  });
  const result = await invoke();
  assert.equal(result.ok, true);
  assert.equal(result.copied, true);
  assert.deepEqual(events, ['persist','copy']);
  copyWorks = false;
  const second = await invoke();
  assert.equal(second.ok, true);
  assert.equal(second.copied, false);
  assert.equal(second.url, 'https://cdn.example/original.png');
  assert.equal(uploads, 2);
  assert.match(second.error, /自动复制失败/);
  assert.equal(listener({target:'offscreen',type:'upload'}, {id:'other-extension'}, () => assert.fail('外部消息不应响应')), undefined);
});
