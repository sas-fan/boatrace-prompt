// ページ側（MAIN world）で動くフック。
// プレイヤーから「今見ている動画のチャンネル ID」を取り出してコンテンツスクリプトへ渡す。
(function () {
  'use strict';
  let last = '';

  function emit(force) {
    try {
      const p = document.getElementById('movie_player');
      const r = p && typeof p.getPlayerResponse === 'function' ? p.getPlayerResponse() : null;
      const d = r && r.videoDetails;
      if (!d || !d.videoId) return;
      if (!force && d.videoId === last) return;
      last = d.videoId;
      document.dispatchEvent(
        new CustomEvent('yt-shuffle:video', {
          detail: JSON.stringify({
            videoId: d.videoId,
            channelId: d.channelId || null,
            author: d.author || '',
            title: d.title || '',
            lengthSeconds: parseInt(d.lengthSeconds, 10) || 0,
            isLive: !!d.isLive,
          }),
        })
      );
    } catch (e) {
      /* ignore */
    }
  }

  ['yt-navigate-finish', 'yt-page-data-updated', 'yt-player-updated'].forEach((ev) =>
    document.addEventListener(ev, () => setTimeout(emit, 300))
  );
  document.addEventListener('yt-shuffle:request', () => emit(true));
  setInterval(emit, 3000);
})();
