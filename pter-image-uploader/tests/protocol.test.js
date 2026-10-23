import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SITE, MAX_BYTES, parseToken, makeForm, parseUpload, validateSource, readImage} from '../protocol.js';

test('登录重定向不能作为可上传会话，首页令牌可以解析', () => {
  const html = 'PF.obj.config.auth_token = "abc_123";';
  assert.equal(parseToken(html, SITE + '/'), 'abc_123');
  assert.throws(() => parseToken(html, SITE + '/login'), /登录/);
  assert.throws(() => parseToken('<html>challenge</html>', SITE), /安全验证/);
});

test('上传表单符合站点前端协议，默认不公开，保留图片二进制', async () => {
  const bytes = new Uint8Array([71, 73, 70, 56]);
  const form = makeForm(new Blob([bytes], {type:'image/gif'}), 'test-token');
  assert.equal(form.get('action'), 'upload');
  assert.equal(form.get('type'), 'file');
  assert.equal(form.get('auth_token'), 'test-token');
  assert.equal(form.get('privacy'), 'private');
  assert.match(form.get('source').name, /^\d{8}_\d{6}_\d{3}_[a-f0-9]{8}\.gif$/);
  assert.deepEqual(new Uint8Array(await form.get('source').arrayBuffer()), bytes);
  assert.equal(makeForm(new Blob(), 'token', 'public').get('privacy'), 'public');
});

test('使用原图直链生成 BBCode，不使用预览页或缩略图', () => {
  assert.deepEqual(parseUpload(200, JSON.stringify({status_code:200,image:{url:'https://img.example/original.png',url_viewer:'https://s3.pterclub.net/image/1',thumb:{url:'https://img.example/thumb.png'}}})), {url:'https://img.example/original.png',bbcode:'[img]https://img.example/original.png[/img]'});
});

test('错误、伪成功、HTML 和 BBCode 注入地址均不视为成功', () => {
  assert.throws(() => parseUpload(400, JSON.stringify({status_code:400,error:{message:'Invalid auth token'}})), /Invalid auth token/);
  assert.throws(() => parseUpload(200, '<html>Login</html>'), /JSON/);
  for (const url of [undefined, 'javascript:alert(1)', 'https://x/a[/img]', 'https://x/a b']) {
    assert.throws(() => parseUpload(200, JSON.stringify({status_code:200,image:{url}})), /直链/);
  }
  assert.throws(() => parseUpload(200, JSON.stringify({status_code:403,image:{url:'https://x/a'}})), /上传失败/);
});

test('原图读取保留字节，拒绝防盗链 HTML、空文件、HTTP 错误', async () => {
  const blob = await readImage(new Response(new Uint8Array([1, 2, 3]), {headers:{'content-type':'image/png'}}));
  assert.equal(blob.type, 'image/png');
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), new Uint8Array([1, 2, 3]));
  await assert.rejects(readImage(new Response('login', {headers:{'content-type':'text/html'}})), /未返回图片/);
  await assert.rejects(readImage(new Response('', {headers:{'content-type':'image/png'}})), /为空/);
  await assert.rejects(readImage(new Response('', {status:403})), /403/);
});

test('有或没有 Content-Length 都执行大小限制，并取消超限流', async () => {
  await assert.rejects(readImage(new Response('x', {headers:{'content-type':'image/png','content-length':String(MAX_BYTES+1)}})), /20 MiB/);
  let canceled = false;
  const stream = new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(MAX_BYTES+1));},cancel() {canceled=true;}});
  await assert.rejects(readImage(new Response(stream, {headers:{'content-type':'image/png'}})), /20 MiB/);
  assert.equal(canceled, true);
});

test('来源协议仅允许网页图片', () => {
  for (const url of ['https://x/a.jpg','http://x/a.png','data:image/png;base64,AA==']) assert.doesNotThrow(() => validateSource(url));
  for (const url of ['blob:https://x/id','file:///a.png','javascript:alert(1)',undefined]) assert.throws(() => validateSource(url));
});
