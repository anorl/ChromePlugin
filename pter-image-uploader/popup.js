const $ = id => document.getElementById(id);
let selectedUrl;

function updateSelection() {
  for (const button of $('history').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.url === selectedUrl));
  }
}

function renderHistory(history) {
  $('history').replaceChildren();
  for (const entry of history.slice(0, 5)) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.textContent = new Date(entry.time).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
    button.title = `${new Date(entry.time).toLocaleString('zh-CN')}\n${entry.url}`;
    button.dataset.url = entry.url;
    button.addEventListener('click', () => {
      showResult(entry);
      copyBBCode();
    });
    li.append(button);
    $('history').append(li);
  }
  updateSelection();
}

function showResult(entry) {
  selectedUrl = entry?.url;
  updateSelection();
  $('bbcode').value = entry?.bbcode || '';
  $('copy').disabled = !entry?.bbcode;
  $('copy-url').disabled = !entry?.url;
  $('preview').hidden = !entry?.url;
  if (!entry?.url) {
    $('preview-image').removeAttribute('src');
    return;
  }
  $('preview-link').href = entry.url;
  if ($('preview-image').getAttribute('src') !== entry.url) {
    $('preview-caption').textContent = '正在加载预览…';
    $('preview-image').hidden = false;
    $('preview-image').src = entry.url;
  }
}

$('preview-image').addEventListener('load', () => {
  $('preview-caption').textContent = '点击缩略图查看原图';
});
$('preview-image').addEventListener('error', () => {
  $('preview-image').hidden = true;
  $('preview-caption').textContent = '预览加载失败，BBCode 仍可复制。';
});

async function render() {
  const {status, lastResult, history = [], privacy = 'private'} = await chrome.storage.local.get(['status','lastResult','history','privacy']);
  $('status').textContent = status?.message || '尚未上传图片。';
  $('status').dataset.state = status?.state || '';
  $('status').hidden = status?.state === 'success';
  if (status?.state === 'uploading' && Date.now() - status.startedAt > 180000) {
    $('status').textContent = '上次任务可能已中断。请到图床检查，并查看下面是否保留了上传结果，再决定是否重试。';
  }
  $('privacy').value = privacy;
  showResult(lastResult);
  renderHistory(history);
}

$('privacy').addEventListener('change', () => chrome.storage.local.set({privacy:$('privacy').value}));
async function copyBBCode() {
  try {
    await navigator.clipboard.writeText($('bbcode').value);
    showCopyStatus('BBCode 已复制。', 'success');
  } catch {
    $('bbcode').focus(); $('bbcode').select();
    showCopyStatus('复制失败，已选中 BBCode，请按 Ctrl+C 复制。', 'warning');
  }
}
function showCopyStatus(message, state) {
  $('copy-status').textContent = message;
  $('copy-status').dataset.state = state;
  $('copy-status').hidden = false;
}
$('copy').addEventListener('click', copyBBCode);
$('copy-url').addEventListener('click', async () => {
  if (!selectedUrl) return;
  try {
    await navigator.clipboard.writeText(selectedUrl);
    showCopyStatus('图片地址已复制。', 'success');
  } catch {
    showCopyStatus('图片地址复制失败，请重试。', 'warning');
  }
});
chrome.storage.onChanged.addListener((_changes, area) => { if (area === 'local') render(); });
render();
