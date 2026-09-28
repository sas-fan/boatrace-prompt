// おすすめのロジック（純粋関数のみ。通信や保存はしない）
(function (root) {
  'use strict';
  const YTS = (root.YTS = root.YTS || {});
  const U = YTS.util || (typeof require === 'function' ? require('./util.js') : null);
  const { tokenize, normName, weightedSample, clamp, DAY } = U;

  // ---------- 視聴履歴 → チャンネルごとの視聴本数 ----------
  function channelKeyOf(channelId, channelName) {
    if (channelId) return channelId;
    if (channelName) return 'n:' + normName(channelName);
    return null;
  }

  // watched: Map(videoId → { t, c, n })
  function channelStats(watched) {
    const m = new Map();
    for (const e of watched.values()) {
      const k = channelKeyOf(e.c, e.n);
      if (!k) continue;
      const s = m.get(k) || { count: 0, last: 0 };
      s.count++;
      if ((e.t || 0) > s.last) s.last = e.t || 0;
      m.set(k, s);
    }
    return m;
  }

  // 登録チャンネル 1 件分の視聴状況（ID 一致 + 名前一致を合算）
  function statsForChannel(stats, ch) {
    const a = stats.get(ch.id);
    const b = ch.title ? stats.get('n:' + normName(ch.title)) : null;
    return {
      count: ((a && a.count) || 0) + ((b && b.count) || 0),
      last: Math.max((a && a.last) || 0, (b && b.last) || 0),
    };
  }

  // ---------- 興味プロファイル（視聴した動画タイトルの頻出語） ----------
  function buildProfile(titles) {
    const df = new Map();
    for (const t of titles || []) {
      for (const k of new Set(tokenize(t))) df.set(k, (df.get(k) || 0) + 1);
    }
    const n = Math.max(1, (titles || []).length);
    const weights = new Map();
    for (const [k, c] of df) {
      if (c < 2) continue; // 1 回しか出ない語はノイズ
      let w = Math.log(1 + c);
      if (c / n > 0.2) w *= 0.3; // ほぼ全部に出る語（シリーズ名など）は弱める
      weights.set(k, w);
    }
    return { weights, size: n };
  }

  function interestRaw(profile, title) {
    if (!profile || !profile.weights.size) return 0;
    const toks = [...new Set(tokenize(title))];
    if (!toks.length) return 0;
    let s = 0;
    for (const t of toks) s += profile.weights.get(t) || 0;
    return s / Math.sqrt(toks.length);
  }

  // 興味プロファイルの上位語（UI 表示用）
  function topTerms(profile, n = 12) {
    return [...profile.weights.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map((x) => x[0]);
  }

  // ---------- 登録チャンネルの抽選 ----------
  function subscribedChannelWeight(st, settings, now) {
    const n = st.count;
    if (n === 0) return { w: 3, kind: 'unwatched', reason: '未視聴チャンネル' };
    if (n <= 3) return { w: 2, kind: 'few', reason: `まだ${n}本しか見ていない` };
    if (st.last && now - st.last > settings.neglectDays * DAY) {
      return { w: 1.6, kind: 'neglected', reason: `${Math.floor((now - st.last) / DAY)}日ぶり` };
    }
    return { w: settings.includeFrequent ? 0.5 : 0, kind: 'frequent', reason: 'よく見るチャンネル' };
  }

  function pickSubscribedChannels(channels, stats, settings, opts) {
    const { rng = Math.random, now = Date.now(), recent = new Set(), hiddenChannels = new Set() } = opts || {};
    const items = channels
      .filter((c) => !hiddenChannels.has(c.id))
      .map((c) => {
        const st = statsForChannel(stats, c);
        const cw = subscribedChannelWeight(st, settings, now);
        let w = cw.w;
        if (recent.has(c.id)) w *= 0.25;
        return { channel: c, stat: st, kind: cw.kind, reason: cw.reason, w };
      });
    return weightedSample(items, (x) => x.w, settings.channelsPerShuffle, rng);
  }

  // 近いチャンネル探索の起点: よく見ている登録チャンネルほど選ばれやすい
  function pickSeedChannels(channels, stats, k, opts) {
    const { rng = Math.random, recentSeeds = new Set(), hiddenChannels = new Set() } = opts || {};
    const items = channels
      .filter((c) => !hiddenChannels.has(c.id))
      .map((c) => {
        const st = statsForChannel(stats, c);
        let w = Math.log(1 + st.count) + 0.15;
        if (recentSeeds.has(c.id)) w *= 0.3;
        return { channel: c, stat: st, w };
      });
    return weightedSample(items, (x) => x.w, k, rng);
  }

  // ---------- 候補の除外 ----------
  function exclusionReason(v, ctx) {
    const { settings, watched, hidden } = ctx;
    if (hidden.videos[v.id]) return 'hidden';
    if (v.channelId && hidden.channels[v.channelId]) return 'hiddenChannel';
    if (watched.has(v.id)) return 'watched';
    if (v.watched != null && v.watched >= settings.watchedThreshold) return 'watched';
    if (v.live || v.upcoming) return 'live';
    if (v.members) return 'members';
    if (v.short && settings.excludeShorts) return 'short';
    if (v.duration != null && v.duration < settings.minDurationSec) return 'tooShort';
    if (settings.maxDurationMin > 0 && v.duration != null && v.duration > settings.maxDurationMin * 60) return 'tooLong';
    if (settings.minViews > 0 && v.views != null && v.views < settings.minViews) return 'fewViews';
    return null;
  }

  // ---------- スコアリング ----------
  function popularity(views, channelMaxViews) {
    if (views == null) return 0.3;
    const abs = clamp((Math.log10(views + 1) - 3) / 4.5, 0, 1); // 1千回 → 0, 3千万回 → 1
    const rel = channelMaxViews > 0 ? clamp(Math.log(views + 1) / Math.log(channelMaxViews + 1), 0, 1) : abs;
    return 0.5 * abs + 0.5 * rel;
  }

  function scoreCandidates(cands, { profile, settings, rng = Math.random }) {
    const raws = cands.map((c) => interestRaw(profile, c.title));
    let maxRaw = 0;
    for (const r of raws) if (r > maxRaw) maxRaw = r;
    const hasAff = cands.some((c) => c.affinity != null);
    const wp = settings.popularityWeight;
    const wi = profile && profile.weights.size ? settings.interestWeight : 0;
    const wr = settings.randomness;
    const wa = hasAff ? 25 : 0;
    const total = wp + wi + wr + wa || 1;
    cands.forEach((c, i) => {
      const pop = popularity(c.views, c.channelMaxViews);
      const int = maxRaw > 0 ? raws[i] / maxRaw : 0;
      const aff = c.affinity || 0;
      const rnd = rng();
      c.parts = { pop, int, aff, rnd };
      c.score = (wp * pop + wi * int + wr * rnd + wa * aff) / total;
    });
    return cands.slice().sort((a, b) => b.score - a.score);
  }

  // 同じチャンネルばかりにならないよう、まず各チャンネル 1 本ずつ → 足りなければ 2 本目…
  function diversify(sorted, maxPerChannel, limit) {
    const byChannel = new Map();
    for (const c of sorted) {
      const k = channelKeyOf(c.channelId, c.channelName) || c.id;
      if (!byChannel.has(k)) byChannel.set(k, []);
      byChannel.get(k).push(c);
    }
    const out = [];
    for (let round = 0; round < maxPerChannel && out.length < limit; round++) {
      for (const c of sorted) {
        const k = channelKeyOf(c.channelId, c.channelName) || c.id;
        if (byChannel.get(k)[round] === c) {
          out.push(c);
          if (out.length >= limit) break;
        }
      }
    }
    return out.sort((a, b) => b.score - a.score);
  }

  // 「おまかせ 1 本」: 上位からスコアの高いものほど選ばれやすく 1 本
  function pickLucky(results, rng = Math.random) {
    const top = results.slice(0, 8);
    const [pick] = weightedSample(top, (c) => Math.pow(c.score || 0.01, 2), 1, rng);
    return pick || null;
  }

  const recommend = {
    channelKeyOf,
    channelStats,
    statsForChannel,
    buildProfile,
    interestRaw,
    topTerms,
    subscribedChannelWeight,
    pickSubscribedChannels,
    pickSeedChannels,
    exclusionReason,
    popularity,
    scoreCandidates,
    diversify,
    pickLucky,
  };
  YTS.recommend = recommend;
  if (typeof module !== 'undefined' && module.exports) module.exports = recommend;
})(typeof globalThis !== 'undefined' ? globalThis : this);
