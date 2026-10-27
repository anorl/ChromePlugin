const HOST = 'com.px.quick_play';
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const settings = sender.url === chrome.runtime.getURL('options.html');
  if (!message || !['play', 'info', ...(settings ? ['configure', 'status'] : [])].includes(message.action)) {
    reply({ok: false, error: '不支持的操作'});
    return;
  }
  const request = settings ? message : {action: message.action, filename: message.filename};
  chrome.runtime.sendNativeMessage(HOST, request, result => {
    const error = chrome.runtime.lastError;
    reply(error ? {ok: false, error: `本地助手未连接：${error.message}。请在扩展设置中查看安装步骤。`} : result);
  });
  return true;
});
