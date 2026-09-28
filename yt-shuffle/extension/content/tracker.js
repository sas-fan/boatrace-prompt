// 視聴した動画を自動で記録する（30 秒以上 or 短い動画は半分以上再生したら「視聴済み」）
(function (root) {
  'use strict';
  const YTS = root.YTS;
  const TICK = 2000;
  const details = new Map(); // videoId → page-hook から届いた情報
  let current = null;
  let enabled = true;

  YTS.store.getSettings().then((s) => (enabled = s.trackWatching !== false));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) enabled = (changes.settings.newValue || {}).trackWatching !== false;
  });

  document.addEventListener('yt-shuffle:video', (ev) => {
    try {
      const d = JSON.parse(ev.detail);
      if (!d || !d.videoId) return;
      details.set(d.videoId, d);
      if (details.size > 50) details.delete(details.keys().next().value);
    } catch (e) {
      /* ignore */
    }
  });
  document.dispatchEvent(new CustomEvent('yt-shuffle:request'));

  function currentVideoId() {
    if (location.pathname !== '/watch') return null;
    return new URLSearchParams(location.search).get('v');
  }

  function fromDom(id) {
    const a = document.querySelector('ytd-watch-metadata ytd-channel-name a, #owner ytd-channel-name a');
    const h1 = document.querySelector('ytd-watch-metadata h1');
    return {
      videoId: id,
      channelId: null,
      author: (a && a.textContent.trim()) || '',
      title: (h1 && h1.textContent.trim()) || '',
      lengthSeconds: 0,
    };
  }

  setInterval(() => {
    if (!enabled) return;
    const id = currentVideoId();
    if (!id) {
      current = null;
      return;
    }
    if (!current || current.id !== id) current = { id, played: 0, recorded: false };
    if (current.recorded) return;
    const player = document.getElementById('movie_player');
    const video = document.querySelector('#movie_player video') || document.querySelector('video.html5-main-video');
    const ad = player && player.classList.contains('ad-showing');
    if (video && !video.paused && !ad && video.readyState >= 2) current.played += TICK / 1000;
    const d = details.get(id);
    const len = (d && d.lengthSeconds) || (video && !ad && Number.isFinite(video.duration) ? video.duration : 0);
    const need = len > 0 ? Math.min(30, len * 0.5) : 30;
    if (current.played < need) return;
    current.recorded = true;
    const info = d || fromDom(id);
    YTS.store.mergeWatched([
      { id, t: Date.now(), channelId: info.channelId || null, channelName: info.author || '', title: info.title || '' },
    ]);
  }, TICK);
})(globalThis);
