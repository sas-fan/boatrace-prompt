// YouTube からのデータ取得（www.youtube.com 上のコンテンツスクリプトで動く）。
// 同一オリジンの fetch なので、ログイン中のセッション（Cookie）がそのまま使われる。
// API キーや Google Cloud の設定は不要。
(function (root) {
  'use strict';
  const YTS = (root.YTS = root.YTS || {});
  const X = YTS.extract;
  const ORIGIN = 'https://www.youtube.com';

  let cfgCache = null;

  async function fetchText(path, timeoutMs = 20000) {
    const url = /^https?:/.test(path) ? path : ORIGIN + path;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { credentials: 'include', signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} (${path})`);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }

  async function getPage(path) {
    const html = await fetchText(path);
    const cfg = X.extractYtcfg(html);
    if (cfg.INNERTUBE_CONTEXT) cfgCache = cfg;
    return { html, cfg, data: X.extractInitialData(html) };
  }

  // ---------- InnerTube（続きのページ取得用） ----------

  function parseCookies(str) {
    const out = {};
    for (const part of String(str || '').split(/;\s*/)) {
      const i = part.indexOf('=');
      if (i <= 0) continue;
      try {
        out[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1));
      } catch (e) {
        out[part.slice(0, i)] = part.slice(i + 1);
      }
    }
    return out;
  }

  async function sha1Hex(s) {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // ログイン済みリクエスト用の Authorization ヘッダ（YouTube の Web クライアントと同じ形式）
  async function buildAuthHeader(cookies, ts, origin = ORIGIN) {
    const parts = [];
    const add = async (scheme, val) => {
      if (val) parts.push(`${scheme} ${ts}_${await sha1Hex(`${ts} ${val} ${origin}`)}`);
    };
    await add('SAPISIDHASH', cookies.SAPISID || cookies['__Secure-3PAPISID']);
    await add('SAPISID1PHASH', cookies['__Secure-1PAPISID']);
    await add('SAPISID3PHASH', cookies['__Secure-3PAPISID']);
    return parts.length ? parts.join(' ') : null;
  }

  function cfgFromDocument() {
    if (typeof document === 'undefined') return null;
    for (const s of document.scripts) {
      const t = s.textContent;
      if (t && t.includes('ytcfg.set') && t.includes('INNERTUBE_CONTEXT')) {
        const cfg = X.extractYtcfg(t);
        if (cfg.INNERTUBE_CONTEXT) return cfg;
      }
    }
    return null;
  }

  async function innertube(endpoint, body, cfg) {
    cfg = cfg && cfg.INNERTUBE_CONTEXT ? cfg : cfgCache || cfgFromDocument();
    if (!cfg || !cfg.INNERTUBE_CONTEXT) throw new Error('YouTube の設定情報（ytcfg）が見つかりません');
    const key = cfg.INNERTUBE_API_KEY;
    const url = `${ORIGIN}/youtubei/v1/${endpoint}?prettyPrint=false${key ? '&key=' + encodeURIComponent(key) : ''}`;
    const client = cfg.INNERTUBE_CONTEXT.client || {};
    const headers = {
      'Content-Type': 'application/json',
      'X-Youtube-Client-Name': String(cfg.INNERTUBE_CONTEXT_CLIENT_NAME || 1),
      'X-Youtube-Client-Version': String(cfg.INNERTUBE_CLIENT_VERSION || client.clientVersion || ''),
      'X-Origin': ORIGIN,
      'X-Goog-AuthUser': String(cfg.SESSION_INDEX != null ? cfg.SESSION_INDEX : 0),
    };
    const auth = await buildAuthHeader(parseCookies(document.cookie), Math.floor(Date.now() / 1000));
    if (auth) headers.Authorization = auth;
    if (cfg.VISITOR_DATA) headers['X-Goog-Visitor-Id'] = cfg.VISITOR_DATA;
    if (cfg.DELEGATED_SESSION_ID) headers['X-Goog-PageId'] = cfg.DELEGATED_SESSION_ID;
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify(Object.assign({ context: cfg.INNERTUBE_CONTEXT }, body)),
    });
    if (!res.ok) throw new Error(`InnerTube ${endpoint} HTTP ${res.status}`);
    return res.json();
  }

  function assertLoggedIn(cfg, data) {
    if (X.isLoggedIn(cfg, data) === false) {
      const e = new Error('NOT_LOGGED_IN');
      e.code = 'NOT_LOGGED_IN';
      throw e;
    }
  }

  // ---------- 登録チャンネル ----------

  async function fetchSubscriptions(onProgress, maxPages = 80) {
    const { cfg, data } = await getPage('/feed/channels');
    assertLoggedIn(cfg, data);
    if (!data) throw new Error('登録チャンネルのページを読み取れませんでした');
    const map = new Map();
    X.collectChannels(data).forEach((c) => map.set(c.id, c));
    let token = X.findContinuation(data);
    let pages = 1;
    let partial = false;
    if (onProgress) onProgress({ text: `登録チャンネルを取得中… ${map.size}件` });
    while (token && pages < maxPages) {
      try {
        const json = await innertube('browse', { continuation: token }, cfg);
        const chs = X.collectChannels(json);
        chs.forEach((c) => map.set(c.id, c));
        token = X.findContinuation(json);
        pages++;
        if (onProgress) onProgress({ text: `登録チャンネルを取得中… ${map.size}件` });
        if (!chs.length) break;
      } catch (e) {
        partial = true;
        break;
      }
    }
    return { channels: [...map.values()], partial };
  }

  // ---------- 視聴履歴 ----------

  async function fetchHistory(maxPages = 10, onProgress) {
    const now = Date.now();
    const { cfg, data } = await getPage('/feed/history');
    assertLoggedIn(cfg, data);
    if (!data) throw new Error('視聴履歴のページを読み取れませんでした');
    const items = X.collectHistory(data, now);
    let token = X.findContinuation(data);
    let pages = 1;
    if (onProgress) onProgress({ text: `視聴履歴を取得中… ${items.length}件` });
    while (token && pages < maxPages) {
      try {
        const json = await innertube('browse', { continuation: token }, cfg);
        const more = X.collectHistory(json, now);
        if (!more.length) break;
        items.push(...more);
        token = X.findContinuation(json);
        pages++;
        if (onProgress) onProgress({ text: `視聴履歴を取得中… ${items.length}件` });
      } catch (e) {
        break;
      }
    }
    // 日付見出しが取れなかったものは直前の日付で埋める（新しい順に並んでいる）
    let last = now;
    for (const v of items) {
      if (v.watchedAt) last = v.watchedAt;
      else v.watchedAt = last;
    }
    return items;
  }

  // ---------- チャンネルの人気動画 ----------
  // UC... のチャンネルには、自動生成の「人気の動画」再生リスト UULP... がある。
  //  1. 再生リストのページ（最大 100 件・視聴済みバー付き）
  //  2. 再生リストの RSS（上位 15 件）
  //  3. チャンネルの「動画」タブ（最新約 30 件 → 再生回数順）
  //  4. チャンネルの RSS（最新 15 件 → 再生回数順）
  async function fetchPopular(channelId) {
    const suffix = channelId.slice(2);
    const own = (vids) => vids.map((v) => Object.assign(v, { channelId }));
    const byViews = (vids) => vids.slice().sort((a, b) => (b.views || 0) - (a.views || 0));
    try {
      const { data } = await getPage(`/playlist?list=UULP${suffix}`);
      const vids = data ? X.collectVideos(data) : [];
      if (vids.length) return { source: 'popular', videos: own(vids) };
    } catch (e) {
      /* 次へ */
    }
    try {
      const feed = YTS.rss.parseFeed(await fetchText(`/feeds/videos.xml?playlist_id=UULP${suffix}`));
      if (feed && feed.videos.length) return { source: 'popular-rss', videos: own(feed.videos) };
    } catch (e) {
      /* 次へ */
    }
    try {
      const { data } = await getPage(`/channel/${channelId}/videos`);
      const vids = data ? X.collectVideos(data) : [];
      if (vids.length) return { source: 'latest', videos: own(byViews(vids)) };
    } catch (e) {
      /* 次へ */
    }
    const feed = YTS.rss.parseFeed(await fetchText(`/feeds/videos.xml?channel_id=${channelId}`));
    return { source: 'latest-rss', videos: own(byViews((feed && feed.videos) || [])) };
  }

  // ---------- 動画ページ（関連動画・投稿者） ----------

  async function fetchWatch(videoId, { related = true } = {}) {
    const html = await fetchText(`/watch?v=${encodeURIComponent(videoId)}`);
    const player = X.extractPlayerResponse(html);
    const d = (player && player.videoDetails) || {};
    let rel = [];
    if (related) {
      const data = X.extractInitialData(html);
      rel = data ? X.collectVideos(X.relatedRoot(data)).filter((v) => v.id !== videoId) : [];
    }
    return {
      owner: X.isChannelId(d.channelId) ? { channelId: d.channelId, name: d.author || '' } : null,
      title: d.title || '',
      related: rel,
    };
  }

  const api = {
    fetchText,
    getPage,
    parseCookies,
    buildAuthHeader,
    innertube,
    fetchSubscriptions,
    fetchHistory,
    fetchPopular,
    fetchWatch,
  };
  YTS.api = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
