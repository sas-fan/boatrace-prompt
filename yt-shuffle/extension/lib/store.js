// chrome.storage.local のラッパー。
// 視聴済み動画は件数が多くなるので、動画 ID の先頭文字で 64 分割して保存する。
(function (root) {
  'use strict';
  const YTS = (root.YTS = root.YTS || {});

  const SHARD_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const SHARD_KEYS = [...SHARD_CHARS].map((c) => 'wv_' + c);
  const MAX_TITLES = 4000;
  const MAX_RECENT_CHANNELS = 80;
  const MAX_RECENT_SEEDS = 20;

  const DEFAULT_SETTINGS = {
    channelsPerShuffle: 15, // 1 回のシャッフルで調べる登録チャンネル数
    resultCount: 20, // 表示する動画数
    maxPerChannel: 2, // 1 チャンネルあたりの最大表示数
    popularityWeight: 50, // 再生回数の重視度
    interestWeight: 30, // 興味（視聴履歴のタイトルとの近さ）の重視度
    randomness: 20, // ランダム度
    excludeShorts: true,
    minDurationSec: 60,
    maxDurationMin: 0, // 0 = 上限なし
    minViews: 0,
    watchedThreshold: 20, // この % 以上再生済みなら「視聴済み」とみなす
    skipDays: 30, // 「スキップ」した動画を出さない日数
    neglectDays: 90, // これ以上見ていない登録チャンネルを「ご無沙汰」とみなす
    includeFrequent: true, // よく見るチャンネルも低確率で混ぜる
    historyPages: 10, // 同期時に読む視聴履歴のページ数
    similarSeeds: 5, // 近いチャンネル探索で起点にする登録チャンネル数
    similarChannels: 6, // 近いチャンネルとして人気動画まで掘るチャンネル数
    cacheDays: 3, // チャンネル人気動画リストのキャッシュ日数
    periodValue: 0, // 投稿日の期間（0 = すべての期間）
    periodUnit: 'month', // hour / day / week / month / year
    panelWidth: 720, // パネルの幅（px）
    showFab: true, // YouTube 画面右下の 🎲 ボタン
    trackWatching: true, // 視聴した動画を自動で記録
  };

  const local = () => chrome.storage.local;
  const get = (keys) => local().get(keys);
  const set = (obj) => local().set(obj);

  // ---------- 設定 ----------
  async function getSettings() {
    const { settings } = await get('settings');
    return Object.assign({}, DEFAULT_SETTINGS, settings || {});
  }
  async function saveSettings(patch) {
    const next = Object.assign(await getSettings(), patch);
    await set({ settings: next });
    return next;
  }

  // ---------- 登録チャンネル ----------
  async function getSubs() {
    const { subs } = await get('subs');
    return subs || { updatedAt: 0, channels: [], source: null };
  }
  async function saveSubs(channels, source) {
    await set({ subs: { updatedAt: Date.now(), channels, source: source || 'youtube' } });
  }

  // ---------- 視聴済み動画 ----------
  function shardKey(id) {
    return 'wv_' + id[0];
  }

  // → Map(videoId → { t, c: channelId|null, n: channelName })
  async function loadWatched() {
    const data = await get(SHARD_KEYS);
    const map = new Map();
    for (const k of SHARD_KEYS) {
      const s = data[k];
      if (!s) continue;
      for (const id in s) map.set(id, s[id]);
    }
    return map;
  }

  // entries: [{ id, t, channelId, channelName, title }]
  async function mergeWatchedDirect(entries) {
    const valid = (entries || []).filter((e) => e && /^[\w-]{11}$/.test(e.id));
    if (!valid.length) return 0;
    const keys = [...new Set(valid.map((e) => shardKey(e.id)))];
    const cur = await get(keys);
    let added = 0;
    for (const e of valid) {
      const k = shardKey(e.id);
      const shard = (cur[k] = cur[k] || {});
      const prev = shard[e.id];
      const t = Number.isFinite(e.t) ? e.t : 0;
      if (!prev) {
        shard[e.id] = { t, c: e.channelId || null, n: e.channelName || '' };
        added++;
      } else {
        if (t > (prev.t || 0)) prev.t = t;
        if (!prev.c && e.channelId) prev.c = e.channelId;
        if (!prev.n && e.channelName) prev.n = e.channelName;
      }
    }
    const withTitle = valid.filter((e) => e.title);
    if (withTitle.length) {
      const { titles } = await get('titles');
      const byId = new Map((titles || []).map((x) => [x[1], x]));
      for (const e of withTitle) {
        const prev = byId.get(e.id);
        const t = Number.isFinite(e.t) ? e.t : 0;
        if (!prev || t > prev[0]) byId.set(e.id, [t, e.id, e.title]);
      }
      cur.titles = [...byId.values()].sort((a, b) => b[0] - a[0]).slice(0, MAX_TITLES);
    }
    await set(cur);
    return added;
  }

  // Service Worker（background.js）で直列に書き込む。書き込みの競合を避けるため。
  let queue = Promise.resolve();
  async function mergeWatched(entries) {
    if (!entries || !entries.length) return 0;
    if (YTS.isBackground) {
      const p = queue.then(() => mergeWatchedDirect(entries));
      queue = p.catch(() => {});
      return p;
    }
    try {
      const res = await chrome.runtime.sendMessage({ type: 'yts:mergeWatched', entries });
      if (res && res.ok) return res.added;
    } catch (e) {
      /* SW が応答しない場合は直接書く */
    }
    return mergeWatchedDirect(entries);
  }

  async function getTitles() {
    const { titles } = await get('titles');
    return (titles || []).map((x) => x[2]);
  }

  // ---------- 動画リストのキャッシュ ----------
  // kind: 'pop'（人気順）/ 'lat'（最新）/ 'feed'（登録チャンネルの新着）
  async function getListCache(kind, id) {
    const key = `${kind}_${id}`;
    const data = await get(key);
    return data[key] || null;
  }
  async function setListCache(kind, id, entry) {
    await set({ [`${kind}_${id}`]: entry });
  }
  async function getPopCache(channelIds) {
    const keys = channelIds.map((id) => 'pop_' + id);
    const data = await get(keys);
    const out = {};
    for (const id of channelIds) if (data['pop_' + id]) out[id] = data['pop_' + id];
    return out;
  }
  async function setPopCache(channelId, entry) {
    await setListCache('pop', channelId, entry);
  }
  async function allKeys() {
    if (typeof local().getKeys === 'function') return local().getKeys();
    return Object.keys(await get(null));
  }
  async function prunePopCache(maxAgeMs) {
    const keys = (await allKeys()).filter((k) => /^(pop|lat|feed)_/.test(k));
    if (!keys.length) return 0;
    const data = await get(keys);
    const now = Date.now();
    const stale = keys.filter((k) => !data[k] || now - (data[k].t || 0) > maxAgeMs);
    if (stale.length) await local().remove(stale);
    return stale.length;
  }

  // ---------- 非表示（興味なし）・スキップ ----------
  async function getHidden() {
    const { hidden } = await get('hidden');
    const h = hidden || {};
    return { videos: h.videos || {}, channels: h.channels || {}, skips: h.skips || {} };
  }
  // スキップ: 指定日数だけ出さない（期限切れは書き込み時に掃除）
  async function skipVideo(id, days) {
    const h = await getHidden();
    const now = Date.now();
    for (const [k, until] of Object.entries(h.skips)) if (until <= now) delete h.skips[k];
    h.skips[id] = now + Math.max(1, Number(days) || 30) * 86400000;
    await set({ hidden: h });
  }
  async function clearSkips() {
    const h = await getHidden();
    h.skips = {};
    await set({ hidden: h });
  }
  function activeSkipCount(h, now = Date.now()) {
    return Object.values(h.skips || {}).filter((until) => until > now).length;
  }
  async function hideVideo(id) {
    const h = await getHidden();
    h.videos[id] = Date.now();
    await set({ hidden: h });
  }
  async function hideChannel(id, name) {
    const h = await getHidden();
    h.channels[id] = { t: Date.now(), name: name || '' };
    await set({ hidden: h });
  }
  async function unhideChannel(id) {
    const h = await getHidden();
    delete h.channels[id];
    await set({ hidden: h });
  }
  async function clearHiddenVideos() {
    const h = await getHidden();
    h.videos = {};
    await set({ hidden: h });
  }

  // ---------- 最近表示したチャンネル（連続で同じものが出ないように） ----------
  async function getRecent() {
    const { recent } = await get('recent');
    return Object.assign({ channels: [], seeds: [] }, recent || {});
  }
  async function pushRecent({ channels = [], seeds = [] }) {
    const r = await getRecent();
    const merge = (list, add, max) => [...new Set([...add, ...list])].slice(0, max);
    r.channels = merge(r.channels, channels, MAX_RECENT_CHANNELS);
    r.seeds = merge(r.seeds, seeds, MAX_RECENT_SEEDS);
    await set({ recent: r });
  }

  // ---------- 最後の結果・メタ情報 ----------
  async function getLast(mode) {
    const key = 'last_' + mode;
    const data = await get(key);
    return data[key] || null;
  }
  async function saveLast(mode, value) {
    await set({ ['last_' + mode]: value });
  }
  async function getMeta() {
    const { meta } = await get('meta');
    return meta || {};
  }
  async function saveMeta(patch) {
    const next = Object.assign(await getMeta(), patch);
    await set({ meta: next });
    return next;
  }

  async function summary() {
    const [subs, watched, hidden, meta] = await Promise.all([getSubs(), loadWatched(), getHidden(), getMeta()]);
    return {
      subs: subs.channels.length,
      subsUpdatedAt: subs.updatedAt,
      subsSource: subs.source,
      watched: watched.size,
      hiddenVideos: Object.keys(hidden.videos).length,
      hiddenChannels: Object.keys(hidden.channels).length,
      skipped: activeSkipCount(hidden),
      historySyncedAt: meta.historySyncedAt || 0,
    };
  }

  async function clearWatched() {
    await local().remove([...SHARD_KEYS, 'titles']);
  }
  async function clearAllData() {
    const { settings } = await get('settings');
    await local().clear();
    if (settings) await set({ settings });
  }

  const store = {
    DEFAULT_SETTINGS,
    SHARD_KEYS,
    getSettings,
    saveSettings,
    getSubs,
    saveSubs,
    loadWatched,
    mergeWatched,
    mergeWatchedDirect,
    getTitles,
    getListCache,
    setListCache,
    getPopCache,
    setPopCache,
    prunePopCache,
    getHidden,
    hideVideo,
    hideChannel,
    unhideChannel,
    clearHiddenVideos,
    skipVideo,
    clearSkips,
    activeSkipCount,
    getRecent,
    pushRecent,
    getLast,
    saveLast,
    getMeta,
    saveMeta,
    summary,
    clearWatched,
    clearAllData,
  };
  YTS.store = store;
  if (typeof module !== 'undefined' && module.exports) module.exports = store;
})(typeof globalThis !== 'undefined' ? globalThis : this);
