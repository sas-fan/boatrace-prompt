// Service Worker: ツールバーアイコン / ショートカット、視聴記録の書き込み窓口
importScripts('lib/util.js', 'lib/store.js');
self.YTS.isBackground = true;

const YT_RE = /^https:\/\/www\.youtube\.com\//;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return;
  if (msg.type === 'yts:mergeWatched') {
    self.YTS.store
      .mergeWatched(msg.entries || [])
      .then((added) => sendResponse({ ok: true, added }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.type === 'yts:openOptions') {
    chrome.runtime.openOptionsPage();
  }
  if (msg.type === 'yts:openYouTube') {
    openYouTubeWithPanel();
  }
});

async function sendToggle(tabId, open, tries = 1) {
  for (let i = 0; i < tries; i++) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'yts:toggle', open });
      return true;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return false;
}

function openWhenReady(tabId) {
  const listener = (id, info) => {
    if (id !== tabId || info.status !== 'complete') return;
    chrome.tabs.onUpdated.removeListener(listener);
    sendToggle(tabId, true, 12);
  };
  chrome.tabs.onUpdated.addListener(listener);
}

async function openYouTubeWithPanel() {
  const tab = await chrome.tabs.create({ url: 'https://www.youtube.com/' });
  openWhenReady(tab.id);
}

chrome.action.onClicked.addListener(async (tab) => {
  if (tab && tab.id != null && tab.url && YT_RE.test(tab.url)) {
    if (await sendToggle(tab.id, false)) return;
    // インストール前から開いていたタブにはスクリプトが入っていないので再読み込みする
    openWhenReady(tab.id);
    chrome.tabs.reload(tab.id);
    return;
  }
  openYouTubeWithPanel();
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});
