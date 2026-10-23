// Self-contained: Chrome serializes this function into the source image's frame.
export function showPageFeedback(srcUrl, message, state, pageUrl) {
  if (pageUrl && location.href.split('#')[0] !== pageUrl.split('#')[0]) return;
  const id = 'pter-image-uploader-feedback';
  document.getElementById(id)?.remove();
  const host = document.createElement('div');
  host.id = id;
  host.style.cssText = 'all:initial!important;position:fixed!important;z-index:2147483647!important;display:block!important;pointer-events:none!important;';
  const root = host.attachShadow({mode:'closed'});
  const style = document.createElement('style');
  style.textContent = `
    div{box-sizing:border-box;padding:14px 20px;border:2px solid rgba(255,255,255,.9);border-radius:12px;
      background:${state === 'success' ? '#15803d' : state === 'warning' ? '#92400e' : '#b91c1c'};
      color:#fff;font:600 17px/1.5 system-ui,sans-serif;text-align:center;
      box-shadow:0 6px 24px rgba(0,0,0,.3);overflow-wrap:anywhere;}
  `;
  const text = document.createElement('div');
  text.setAttribute('role', state === 'success' ? 'status' : 'alert');
  text.textContent = (state === 'success' ? '✓ ' : '! ') + message;
  root.append(style, text);
  host.style.setProperty('width', `${Math.min(360, Math.max(1, innerWidth - 24))}px`, 'important');
  host.style.setProperty('left', '12px', 'important');
  host.style.setProperty('top', '12px', 'important');
  document.documentElement.append(host);
  const image = Array.from(document.images).find(img => {
    if (img.currentSrc !== srcUrl && img.src !== srcUrl) return false;
    const rect = img.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
  });
  const rect = image?.getBoundingClientRect();
  const size = host.getBoundingClientRect();
  const left = rect ? rect.left + (rect.width - size.width) / 2 : (innerWidth - size.width) / 2;
  const top = rect ? rect.top + Math.min(24, rect.height / 4) : 24;
  host.style.setProperty('left', `${Math.max(12, Math.min(left, innerWidth - size.width - 12))}px`, 'important');
  host.style.setProperty('top', `${Math.max(12, Math.min(top, innerHeight - size.height - 12))}px`, 'important');
  setTimeout(() => host.remove(), state === 'success' ? 5000 : 10000);
}
