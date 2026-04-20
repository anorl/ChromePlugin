function sanitizeFilename(filename) {
  return filename.replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 200);
}

async function fetchAndDownloadBlob(url, filename) {
  try {
    const response = await fetch(url, {
      credentials: 'include',
      referrer: 'https://www.bilibili.com/',
      referrerPolicy: 'no-referrer-when-downgrade'
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    chrome.downloads.download({
      url: objectUrl,
      filename,
      conflictAction: 'uniquify',
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.warn('Blob 下载失败：', chrome.runtime.lastError.message);
      }
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
    });
  } catch (error) {
    console.warn('fetch fallback 失败：', error);
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.action !== 'download') return;

  const url = message.url;
  const filename = sanitizeFilename(message.filename || 'bilibili_video.mp4');

  chrome.downloads.download({
    url,
    filename,
    conflictAction: 'uniquify',
    saveAs: false
  }, async (downloadId) => {
    if (chrome.runtime.lastError) {
      console.warn('直接下载失败：', chrome.runtime.lastError.message);
      await fetchAndDownloadBlob(url, filename);
    }
  });
});
