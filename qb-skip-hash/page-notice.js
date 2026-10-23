// Injected in the originating page. Text is never interpreted as HTML.
export function renderPageNotice({state, title, message}) {
  const id = '__qb_cross_seed_notice__';
  document.getElementById(id)?.remove();
  const host = document.createElement('div');
  host.id = id;
  host.style.cssText = 'all:initial!important;position:fixed!important;right:24px!important;bottom:24px!important;z-index:2147483647!important;display:block!important;width:min(560px,calc(100vw - 48px))!important;';
  const root = host.attachShadow({mode:'closed'});
  const color = state === 'error' ? '#b91c1c' : state === 'busy' ? '#1d4ed8' : '#15803d';
  const style = document.createElement('style');
  style.textContent = `
    :host{font-family:system-ui,"Microsoft YaHei",sans-serif;color-scheme:light}
    *{box-sizing:border-box}
    .notice{position:relative;background:#fff;color:#172033;border:2px solid ${color};border-left-width:7px;border-radius:12px;padding:20px 48px 20px 20px;box-shadow:0 8px 36px #0004;text-align:left;overflow-wrap:anywhere}
    .title{font-size:20px;font-weight:700;line-height:1.5;color:${color};margin:0 0 8px;white-space:pre-wrap}
    .message{font-size:16px;line-height:1.6;margin:0;white-space:pre-wrap}
    button{position:absolute;top:8px;right:8px;width:32px;height:32px;border:0;border-radius:6px;background:#f1f5f9;color:#475569;font:24px/1 system-ui;cursor:pointer}
    button:focus-visible{outline:2px solid ${color};outline-offset:2px}
  `;
  const box = document.createElement('div');
  box.className = 'notice';
  box.setAttribute('role', state === 'error' ? 'alert' : 'status');
  box.setAttribute('aria-live', state === 'error' ? 'assertive' : 'polite');
  const heading = document.createElement('p');
  heading.className = 'title';
  heading.textContent = title;
  const detail = document.createElement('p');
  detail.className = 'message';
  detail.textContent = message;
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', '关闭 QB 操作提示');
  close.addEventListener('click', () => host.remove());
  box.append(heading, detail, close);
  root.append(style, box);
  document.documentElement.append(host);
}

export function createPageNotifier(tabId) {
  let documentId, unavailable = false;
  return async (state, title, message) => {
    if (unavailable || !Number.isInteger(tabId)) return;
    try {
      const results = await chrome.scripting.executeScript({
        target:documentId ? {tabId, documentIds:[documentId]} : {tabId, frameIds:[0]},
        func:renderPageNotice, args:[{state, title, message}]
      });
      // Pin later updates to this document so navigation cannot mark another page.
      if (!documentId) documentId = results[0]?.documentId;
      if (!documentId) unavailable = true;
    } catch {
      unavailable = true;
      // Closing/navigating the page must not turn a successful QB add into failure.
      console.warn('无法在来源网页显示 QB 操作提示。');
    }
  };
}
