(() => {
  if (window.__pxQuickPlay) return;
  window.__pxQuickPlay = true;
  let cachedFile = '', pageKey = location.href;
  const fileLabel = /^(种子文件|種子檔案|種子文件|文件列表|Torrent files?)\s*[:：]?$/i;
  function checkPage() {
    if (pageKey !== location.href) { cachedFile = ''; pageKey = location.href; }
  }
  const media = /(?:^|[\\/\s])?([^\r\n<>]+\.(?:mkv|mp4|avi|mov|m2ts|ts|wmv|flv|webm|mpg|mpeg|m4v))(?=$|\s)/i;
  function filename(cell) {
    const clone = cell.cloneNode(true);
    clone.querySelectorAll('[data-quick-play],script,style').forEach(n => n.remove());
    clone.querySelectorAll('br').forEach(n => n.replaceWith('\n'));
    for (const line of clone.textContent.split(/\r?\n/)) {
      const match = line.trim().match(media);
      if (match) return match[1].trim();
    }
    return '';
  }
  function firstFile(cell) {
    // The list may be an inline table or a detached modal response.
    const tables = cell.matches('table') ? [cell] : [...cell.querySelectorAll('table')];
    for (const table of tables) {
      for (const row of table.rows) {
        if (row.cells.length && !/^路径$|^path$/i.test(row.cells[0].textContent.trim())) {
          const found = filename(row.cells[0]);
          if (found) return found;
        }
      }
    }
    return filename(cell);
  }
  function dialogs() {
    const found = [];
    const seen = new Set();
    for (const box of document.querySelectorAll('.jconfirm-box,[role="dialog"],dialog,.layui-layer')) {
      const title = box.querySelector('.jconfirm-title,.layui-layer-title')?.textContent || box.getAttribute('aria-label') || '';
      if (!fileLabel.test(title.trim()) || box.closest('[hidden],[aria-hidden="true"]') || getComputedStyle(box).display === 'none') continue;
      const content = box.querySelector('.jconfirm-content,.layui-layer-content') || box;
      if (!seen.has(content)) { seen.add(content); found.push(content); }
    }
    return found;
  }
  function availableFile(cell) {
    checkPage();
    let name = firstFile(cell);
    if (!name) {
      for (const content of dialogs()) { name = firstFile(content); if (name) break; }
    }
    if (name) cachedFile = name;
    return name || cachedFile;
  }
  async function loadPterList(link) {
    // PTer opens a jQuery dialog, outside the seed-file cell. Read its same-origin
    // endpoint instead of trying to execute a javascript: URL in an isolated world.
    if (!/^(www\.)?pterclub\.net$/i.test(location.hostname)) return null;
    const match = (link.getAttribute('href') || '').match(/^javascript:\s*viewfilelist\(\s*(\d+)\s*(?:,\s*(['"])[^'"]*\2\s*)?\)\s*;?\s*$/i);
    if (!match) return null;
    const url = new URL('/viewfilelist.php', location.origin);
    url.searchParams.set('id', match[1]);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url.href, {credentials: 'same-origin', signal: controller.signal});
      if (!response.ok) throw new Error(`文件列表读取失败：HTTP ${response.status}`);
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const tables = [...doc.querySelectorAll('table')].filter(table => /^(路径|路徑|Path|文件名|Filename)$/i.test(table.rows[0]?.cells[0]?.textContent.trim() || ''));
      for (const table of tables) { const name = firstFile(table); if (name) return name; }
      throw new Error('文件列表中未找到支持的视频。请确认站点登录仍有效，或手动打开列表查看。');
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('文件列表读取超时，请稍后重试。');
      throw error;
    } finally { clearTimeout(timer); }
  }
  function panel() {
    const host = document.createElement('div');
    host.dataset.quickPlay = 'panel';
    document.documentElement.append(host);
    const shadow = host.attachShadow({mode: 'closed'});
    shadow.innerHTML = `<style>:host{all:initial}[hidden]{display:none!important}section{position:fixed;z-index:2147483647;right:24px;bottom:24px;width:min(650px,90vw);max-height:80vh;overflow:auto;padding:20px;border:1px solid #aab5c7;border-radius:12px;background:white;color:#172339;box-shadow:0 8px 40px #0004;font:16px/1.6 system-ui}button{font:inherit;cursor:pointer;margin:0 10px 10px 0;padding:6px 14px;border:1px solid #1c5eaf;border-radius:4px;background:#1c5eaf;color:white}button:hover{background:#174e92}button:focus-visible{outline:2px solid #1c5eaf;outline-offset:2px}label{display:block;margin:4px 0 10px;cursor:pointer}input{accent-color:#1c5eaf}textarea{box-sizing:border-box;width:100%;height:45vh;font:14px/1.5 monospace}p{white-space:pre-wrap;overflow-wrap:anywhere}</style><section role="status"><button id="close">关闭</button><button id="copy" hidden>复制mediainfo</button><label id="wrap-option" hidden><input id="wrap" type="checkbox" checked> 添加 [hide=mediainfo] 标签</label><p></p><textarea readonly hidden aria-label="mediainfo"></textarea></section>`;
    shadow.getElementById('close').onclick = () => host.remove();
    const status = shadow.querySelector('p'), area = shadow.querySelector('textarea');
    let report = '';
    const renderReport = () => { area.value = shadow.getElementById('wrap').checked ? `[hide=mediainfo]\n${report}\n[/hide]` : report; };
    shadow.getElementById('wrap').onchange = renderReport;
    shadow.getElementById('copy').onclick = async () => {
      renderReport();
      const text = area.value;
      try {
        if (!navigator.clipboard || !window.isSecureContext) throw new Error();
        await navigator.clipboard.writeText(text);
      } catch {
        area.value = text; area.focus(); area.select();
        try { if (!document.execCommand('copy')) throw new Error(); }
        catch { status.textContent = '请按 Ctrl+C 复制已选中的内容。'; return; }
      }
      renderReport();
      status.textContent = '已复制mediainfo，可粘贴到发布页面。';
    };
    return {show(text) { status.textContent = text; }, info(text) { report = text; renderReport(); area.hidden = false; shadow.getElementById('copy').hidden = false; shadow.getElementById('wrap-option').hidden = false; }};
  }
  async function run(cell, action, button) {
    const ui = panel();
    button.disabled = true;
    try {
      let name = availableFile(cell);
      if (!name) {
        const link = [...cell.querySelectorAll('a,button')].find(n => /查看列表|文件列表|show.*files/i.test(n.textContent) && !n.closest('[data-quick-play]'));
        if (link) {
          ui.show('正在读取文件列表…');
          const loaded = await loadPterList(link);
          if (loaded !== null) { name = loaded; cachedFile = name; }
          else {
            link.click();
            const deadline = Date.now() + 12000;
            while (!name && Date.now() < deadline) {
              await new Promise(resolve => setTimeout(resolve, 250));
              name = availableFile(cell.isConnected ? cell : document.querySelector('[data-quick-play-cell]') || cell);
            }
          }
        }
      }
      if (!name) throw new Error('没有找到视频文件名。请手动打开文件列表，使用弹窗内的快捷播放按钮。');
      ui.show(`正在查找本地文件：${name}`);
      const result = await chrome.runtime.sendMessage({action, filename: name});
      if (!result?.ok) throw new Error(result?.error || '本地助手没有响应');
      ui.show(action === 'play' ? `已请求 PotPlayer 打开：\n${result.path}` : `已读取：\n${result.path}\n点击“复制mediainfo”后粘贴到发布页面。`);
      if (action === 'info') ui.info(result.text);
    } catch (e) { ui.show(e.message); }
    finally { button.disabled = false; }
  }
  function addButtons(cell, kind = 'buttons') {
    if (cell.querySelector(`[data-quick-play="${kind}"]`)) return;
    const holder = document.createElement('span');
    holder.dataset.quickPlay = kind;
    holder.style.cssText = 'display:inline-flex;gap:8px;margin:6px 12px;vertical-align:middle';
    for (const [action, title] of [['play', '播 · 快捷播放'], ['info', '获取mediainfo']]) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = title;
      button.style.cssText = 'font:14px/1.5 system-ui;padding:4px 10px;cursor:pointer;background:#1c5eaf;color:#fff;border:1px solid #1c5eaf;border-radius:4px';
      button.addEventListener('click', () => run(cell, action, button));
      holder.append(button);
    }
    cell.prepend(holder);
  }
  function scan() {
    checkPage();
    for (const row of document.querySelectorAll('tr')) {
      const label = row.cells[0];
      if (!label || !fileLabel.test(label.textContent.trim())) continue;
      const cell = row.cells[1];
      if (!cell || cell.querySelector('[data-quick-play="buttons"]')) continue;
      cell.dataset.quickPlayCell = '';
      addButtons(cell);
    }
    for (const content of dialogs()) {
      const name = firstFile(content);
      if (name) { cachedFile = name; addButtons(content, 'dialog-buttons'); }
    }
  }
  let timer;
  const observer = new MutationObserver(records => {
    if (records.every(r => r.target.closest?.('[data-quick-play]'))) return;
    clearTimeout(timer); timer = setTimeout(scan, 200);
  });
  observer.observe(document.documentElement, {childList: true, subtree: true});
  scan();
})();
