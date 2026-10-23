import test from 'node:test';
import assert from 'node:assert/strict';
import {createPageNotifier} from '../page-notice.js';

test('page notices update the source document and tolerate its navigation or closure', async () => {
  const previous = globalThis.chrome;
  const calls = [];
  try {
    globalThis.chrome = {scripting:{executeScript:async request => {
      calls.push(request);
      if (calls.length > 2) throw new Error('Document no longer exists');
      return [{documentId:'original-page'}];
    }}};
    const notify = createPageNotifier(123);
    await notify('busy', '正在下载', '请稍候');
    await notify('success', '已下载至 http://qb.example', '已确认任务存在');
    assert.deepEqual(calls[0].target, {tabId:123, frameIds:[0]});
    assert.deepEqual(calls[1].target, {tabId:123, documentIds:['original-page']});
    assert.equal(calls[1].args[0].state, 'success');
    await assert.doesNotReject(notify('success', '已添加', '页面已关闭'));
    await notify('error', '不会写入新页面', '');
    assert.equal(calls.length, 3);
  } finally { globalThis.chrome = previous; }
});
