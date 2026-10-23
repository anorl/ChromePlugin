import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourceRule, withSourceReferer} from '../request-context.js';

const srcUrl = 'https://img9.doubanio.com/view/photo/l_ratio_poster/public/p2888100566.jpg';

test('豆瓣原图请求补充网页来源头，只匹配当前 URL 与插件自己的 GET', () => {
  const rule = sourceRule({srcUrl, pageUrl:'https://movie.douban.com/subject/123/?private=secret'}, 'extension-id');
  assert.deepEqual(rule.action.requestHeaders, [{header:'Referer', operation:'set', value:'https://movie.douban.com/'}]);
  assert.deepEqual(rule.condition.initiatorDomains, ['extension-id']);
  assert.deepEqual(rule.condition.resourceTypes, ['xmlhttprequest']);
  assert.deepEqual(rule.condition.requestMethods, ['get']);
  const regex = new RegExp(rule.condition.regexFilter);
  assert.equal(regex.test(srcUrl), true);
  assert.equal(regex.test(srcUrl + '?other=1'), false);
  assert.equal(regex.test(srcUrl.replace('img9.doubanio.com', 'img9XdoubanioXcom')), false);
});

test('直接图片页面、框架、data URL 和 HTTPS 降级分别处理', () => {
  const ref = info => sourceRule(info, 'id')?.action.requestHeaders[0].value;
  assert.equal(ref({srcUrl}), 'https://img9.doubanio.com/');
  assert.equal(ref({srcUrl, pageUrl:'https://outer.example/path', frameUrl:'https://frame.example/path'}), 'https://frame.example/');
  assert.equal(sourceRule({srcUrl:'data:image/png;base64,AA=='}, 'id'), null);
  assert.equal(ref({srcUrl:'http://image.example/a.jpg', pageUrl:'https://private.example/path'}), 'http://image.example/');
});

test('只有安装临时规则后才读取图片，任务成功或失败均清理规则', async () => {
  for (const fail of [false, true]) {
    const events = [];
    const api = {runtime:{id:'extension-id'}, declarativeNetRequest:{async updateSessionRules(update) {events.push(update);}}};
    const operation = withSourceReferer({srcUrl}, async () => {
      assert.equal(events.length, 1);
      assert.equal(events[0].addRules.length, 1);
      if (fail) throw new Error('HTTP 418');
      return 'uploaded';
    }, api);
    if (fail) await assert.rejects(operation, /418/);
    else assert.equal(await operation, 'uploaded');
    assert.deepEqual(events[1], {removeRuleIds:[1]});
  }
});

test('精确匹配含查询参数、括号和 fragment 的原图', () => {
  const url = 'https://img.example/a(1).jpg?size=2&token=a+b#fragment';
  const rule = sourceRule({srcUrl:url}, 'id');
  const regex = new RegExp(rule.condition.regexFilter);
  assert.equal(regex.test(url.split('#')[0]), true);
  assert.equal(regex.test('https://img.example/a1.jpg?size=2&token=ab'), false);
});
