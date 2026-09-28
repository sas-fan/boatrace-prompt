// おすすめの取得フロー（同期・登録チャンネルシャッフル・近いチャンネル発見・診断）
(function (root) {
  'use strict';
  const YTS = (root.YTS = root.YTS || {});
  const { store, recommend: R, util: U, api } = YTS;
  const HOUR = 60 * 60 * 1000;

  const noop = () => {};

  async function loadContext() {
    const [settings, subs, watched, hidden, recent, titles] = await Promise.all([
      store.getSettings(),
      store.getSubs(),
      store.loadWatched(),
      store.getHidden(),
      store.getRecent(),
      store.getTitles(),
    ]);
    return {
      settings,
      subs,
      watched,
      hidden,
      recent,
      now: Date.now(),
      periodMs: U.periodMs(settings.periodValue, settings.periodUnit),
      stats: R.channelStats(watched),
      profile: R.buildProfile(titles),
    };
  }

  // ---------- 同期 ----------
  // force=false のときは古くなったものだけ取り直す
  async function sync({ force = false, onProgress = noop } = {}) {
    const [settings, subs, meta] = await Promise.all([store.getSettings(), store.getSubs(), store.getMeta()]);
    const now = Date.now();
    const report = {};

    if (force || !subs.channels.length || now - subs.updatedAt > 24 * HOUR) {
      onProgress({ text: '登録チャンネルを取得中…' });
      const { channels, partial } = await api.fetchSubscriptions(onProgress);
      if (channels.length) {
        let list = channels;
        if (partial && subs.channels.length > channels.length) {
          const m = new Map(subs.channels.map((c) => [c.id, c]));
          channels.forEach((c) => m.set(c.id, c));
          list = [...m.values()];
        }
        await store.saveSubs(list, 'youtube');
      }
      report.subs = channels.length;
      report.partial = partial;
    }

    if (force || !meta.historySyncedAt || now - meta.historySyncedAt > 12 * HOUR) {
      const pages = force || !meta.historySyncedAt ? settings.historyPages : 2;
      onProgress({ text: '視聴履歴を取得中…' });
      try {
        const items = await api.fetchHistory(pages, onProgress);
        report.history = items.length;
        report.historyAdded = await store.mergeWatched(
          items.map((v) => ({
            id: v.id,
            t: v.watchedAt,
            channelId: v.channelId,
            channelName: v.channelName,
            title: v.title,
          }))
        );
        await store.saveMeta({ historySyncedAt: now });
      } catch (e) {
        if (e.code === 'NOT_LOGGED_IN') throw e;
        report.historyError = e.message;
      }
      await store.prunePopCache(settings.cacheDays * 3 * U.DAY);
    }
    return report;
  }

  // 一覧に出てきた「赤い再生済みバー」付きの動画を視聴済みとして記録
  function captureWatched(videos, ctx) {
    const found = videos.filter(
      (v) => v.watched != null && v.watched >= ctx.settings.watchedThreshold && !ctx.watched.has(v.id)
    );
    if (!found.length) return;
    for (const v of found) ctx.watched.set(v.id, { t: 0, c: v.channelId, n: v.channelName });
    store.mergeWatched(
      found.map((v) => ({ id: v.id, t: 0, channelId: v.channelId, channelName: v.channelName, title: v.title }))
    );
  }

  function compact(v, channel, ref) {
    return {
      id: v.id,
      title: v.title,
      channelId: channel.id || v.channelId || null,
      channelName: v.channelName || channel.title || '',
      views: v.views,
      duration: v.duration,
      published: v.published,
      publishedAt: v.publishedAt != null ? v.publishedAt : U.publishedAt(v.published, ref),
      live: v.live,
      upcoming: v.upcoming,
      short: v.short,
      members: v.members,
    };
  }

  // 古いキャッシュ（投稿日時の計算前に保存したもの）にも投稿日時を補う
  function withDates(entry) {
    for (const v of entry.videos) {
      if (v.publishedAt == null && v.published) v.publishedAt = U.publishedAt(v.published, entry.t);
    }
    return entry;
  }

  // チャンネルの動画リスト（kind: 'pop' = 人気順 / 'lat' = 最新）をキャッシュ付きで取得
  const LIST_TTL = { pop: (s) => s.cacheDays * U.DAY, lat: () => 3 * HOUR };
  async function getList(kind, channel, ctx) {
    const cached = await store.getListCache(kind, channel.id);
    if (cached && Date.now() - cached.t < LIST_TTL[kind](ctx.settings)) return withDates(cached);
    const res = kind === 'pop' ? await api.fetchPopular(channel.id) : await api.fetchLatest(channel.id);
    captureWatched(res.videos, ctx);
    const now = Date.now();
    const entry = { t: now, source: res.source, videos: res.videos.slice(0, 40).map((v) => compact(v, channel, now)) };
    await store.setListCache(kind, channel.id, entry);
    return entry;
  }
  const getPopular = (channel, ctx) => getList('pop', channel, ctx);

  // 期間指定があるときは「人気順」に加えて「最新」も見る（最近の動画は人気順リストに入りにくいため）
  async function getChannelVideos(channel, ctx) {
    const pop = await getList('pop', channel, ctx);
    const out = pop.videos.map((v, i) => Object.assign({}, v, { rank: pop.source.startsWith('popular') ? i + 1 : null }));
    if (ctx.periodMs) {
      try {
        const lat = await getList('lat', channel, ctx);
        const seen = new Set(out.map((v) => v.id));
        for (const v of lat.videos) if (!seen.has(v.id)) out.push(Object.assign({}, v, { rank: null }));
      } catch (e) {
        /* 最新が取れなくても人気順だけで続行 */
      }
    }
    return out;
  }

  // 登録チャンネルの新着フィード（短い期間を指定したとき用）。30 分キャッシュ。
  async function getSubsFeed(ctx, onProgress) {
    const pages = ctx.periodMs <= 2 * U.DAY ? 2 : ctx.periodMs <= 8 * U.DAY ? 4 : 8;
    const cached = await store.getListCache('feed', 'subs');
    if (cached && cached.pages >= pages && Date.now() - cached.t < 30 * 60 * 1000) return withDates(cached);
    const vids = await api.fetchSubscriptionFeed(pages, onProgress);
    captureWatched(vids, ctx);
    const now = Date.now();
    const entry = { t: now, pages, source: 'feed', videos: vids.slice(0, 400).map((v) => compact(v, {}, now)) };
    await store.setListCache('feed', 'subs', entry);
    return entry;
  }

  // ---------- 登録チャンネル・シャッフル ----------
  async function shuffleSubscribed({ onProgress = noop, rng = Math.random } = {}) {
    const ctx = await loadContext();
    if (!ctx.subs.channels.length) throw Object.assign(new Error('NO_SUBS'), { code: 'NO_SUBS' });
    const picks = R.pickSubscribedChannels(ctx.subs.channels, ctx.stats, ctx.settings, {
      rng,
      recent: new Set(ctx.recent.channels),
      hiddenChannels: new Set(Object.keys(ctx.hidden.channels)),
    });
    let done = 0;
    onProgress({ text: `登録チャンネルを調べています… 0/${picks.length}`, done: 0, total: picks.length });
    const lists = await U.mapLimit(picks, 4, async (p) => {
      const videos = await getChannelVideos(p.channel, ctx);
      done++;
      onProgress({ text: `登録チャンネルを調べています… ${done}/${picks.length}`, done, total: picks.length });
      return { p, videos };
    });

    const cands = new Map();
    const add = (v, ch, info) => {
      if (cands.has(v.id)) return;
      const c = Object.assign({}, v, {
        channelId: ch.id,
        channelName: v.channelName || ch.title,
        reason: info.reason,
        kind: info.kind,
        affinity: R.kindAffinity(info.kind),
      });
      if (!R.exclusionReason(c, ctx)) cands.set(v.id, c);
    };
    for (const item of lists) {
      if (!item) continue;
      for (const v of item.videos) add(v, item.p.channel, item.p);
    }

    // 短い期間（1 か月以内）なら、登録チャンネル全体の新着フィードからも拾う
    let feedCount = 0;
    if (ctx.periodMs && ctx.periodMs <= 31 * U.DAY) {
      try {
        const feed = await getSubsFeed(ctx, onProgress);
        const byId = new Map(ctx.subs.channels.map((c) => [c.id, c]));
        const byName = new Map(ctx.subs.channels.map((c) => [U.normName(c.title), c]));
        const hiddenCh = ctx.hidden.channels;
        for (const v of feed.videos) {
          const ch = (v.channelId && byId.get(v.channelId)) || byName.get(U.normName(v.channelName));
          if (!ch || hiddenCh[ch.id]) continue;
          const cw = R.subscribedChannelWeight(R.statsForChannel(ctx.stats, ch), ctx.settings, ctx.now);
          if (!(cw.w > 0)) continue;
          add(Object.assign({}, v, { rank: null }), ch, cw);
          feedCount++;
        }
      } catch (e) {
        if (e.code === 'NOT_LOGGED_IN') throw e;
      }
    }

    const list = R.assignChannelMax([...cands.values()]);
    const scored = R.scoreCandidates(list, { profile: ctx.profile, settings: ctx.settings, rng });
    const results = R.diversify(scored, ctx.settings.maxPerChannel, ctx.settings.resultCount);
    await store.pushRecent({ channels: picks.map((p) => p.channel.id) });
    const out = {
      mode: 'subs',
      at: Date.now(),
      results,
      checked: picks.length,
      feed: feedCount,
      period: ctx.periodMs ? U.periodLabel(ctx.settings.periodValue, ctx.settings.periodUnit) : null,
      terms: R.topTerms(ctx.profile, 8),
    };
    await store.saveLast('subs', out);
    return out;
  }

  // ---------- 近いチャンネル発見 ----------
  async function discoverSimilar({ onProgress = noop, rng = Math.random } = {}) {
    const ctx = await loadContext();
    if (!ctx.subs.channels.length) throw Object.assign(new Error('NO_SUBS'), { code: 'NO_SUBS' });
    const { settings } = ctx;
    const hiddenCh = new Set(Object.keys(ctx.hidden.channels));
    const subIds = new Set(ctx.subs.channels.map((c) => c.id));
    const subNames = new Set(ctx.subs.channels.map((c) => U.normName(c.title)));
    const seeds = R.pickSeedChannels(ctx.subs.channels, ctx.stats, settings.similarSeeds, {
      rng,
      recentSeeds: new Set(ctx.recent.seeds),
      hiddenChannels: hiddenCh,
    });

    // 1) 起点の動画: そのチャンネルで自分が見た動画を優先、なければ人気動画
    onProgress({ text: '起点にする動画を選んでいます…' });
    const watchedBy = new Map();
    for (const [id, e] of ctx.watched) {
      if (!e.c) continue;
      if (!watchedBy.has(e.c)) watchedBy.set(e.c, []);
      watchedBy.get(e.c).push({ id, t: e.t || 0 });
    }
    const seedVideos = [];
    await U.mapLimit(seeds, 4, async (s) => {
      const mine = (watchedBy.get(s.channel.id) || []).sort((a, b) => b.t - a.t).slice(0, 6);
      let ids = U.shuffle(mine, rng).slice(0, 2).map((x) => x.id);
      if (ids.length < 2) {
        const e = await getPopular(s.channel, ctx);
        const more = U.shuffle(e.videos.slice(0, 6), rng).map((v) => v.id).filter((id) => !ids.includes(id));
        ids = ids.concat(more.slice(0, 2 - ids.length));
      }
      for (const id of ids) seedVideos.push({ id, seed: s.channel });
    });

    // 2) 関連動画を集める
    let done = 0;
    const relLists = await U.mapLimit(seedVideos, 3, async (sv) => {
      const w = await api.fetchWatch(sv.id, { related: true });
      const now = Date.now();
      for (const v of w.related) v.publishedAt = U.publishedAt(v.published, now);
      done++;
      onProgress({ text: `関連動画を調べています… ${done}/${seedVideos.length}`, done, total: seedVideos.length });
      return { sv, related: w.related };
    });

    // 3) 未登録チャンネルごとに集計（何個の起点チャンネルから辿れたか）
    const agg = new Map();
    for (const item of relLists) {
      if (!item) continue;
      for (const v of item.related) {
        if (v.channelId && (subIds.has(v.channelId) || hiddenCh.has(v.channelId))) continue;
        if (!v.channelId && (!v.channelName || subNames.has(U.normName(v.channelName)))) continue;
        const key = R.channelKeyOf(v.channelId, v.channelName);
        let a = agg.get(key);
        if (!a) {
          a = { key, id: v.channelId, name: v.channelName, handle: v.handle, seeds: new Map(), count: 0, videos: new Map() };
          agg.set(key, a);
        }
        a.id = a.id || v.channelId;
        a.count++;
        a.seeds.set(item.sv.seed.id, item.sv.seed.title);
        a.videos.set(v.id, v);
      }
    }
    // 同じチャンネルが「ID あり」と「名前のみ」に分かれていたらまとめる
    const byName = new Map();
    for (const a of agg.values()) if (a.id && a.name) byName.set(U.normName(a.name), a);
    for (const [key, a] of agg) {
      const target = !a.id && byName.get(U.normName(a.name));
      if (!target) continue;
      target.count += a.count;
      for (const [k, v] of a.seeds) target.seeds.set(k, v);
      for (const [k, v] of a.videos) target.videos.set(k, v);
      agg.delete(key);
    }
    const strength = (a) => a.seeds.size * 3 + a.count;
    const ranked = [...agg.values()].sort((a, b) => strength(b) - strength(a) || rng() - 0.5);

    // 4) 上位チャンネルは人気動画まで掘る（チャンネル ID が不明なら動画ページから調べる）
    const top = ranked.slice(0, settings.similarChannels);
    done = 0;
    await U.mapLimit(top, 3, async (a) => {
      if (!a.id) {
        const w = await api.fetchWatch(a.videos.keys().next().value, { related: false });
        a.id = (w.owner && w.owner.channelId) || null;
        if (a.id && subIds.has(a.id)) {
          a.subscribed = true;
          return;
        }
      }
      if (!a.id || hiddenCh.has(a.id)) return;
      a.popular = await getChannelVideos({ id: a.id, title: a.name }, ctx);
      done++;
      onProgress({ text: `見つかったチャンネルの人気動画を調べています… ${done}/${top.length}`, done, total: top.length });
    });

    // 5) 候補化 → スコア
    let maxSeeds = 1;
    for (const a of ranked) if (a.seeds.size > maxSeeds) maxSeeds = a.seeds.size;
    const cands = new Map();
    for (const a of ranked) {
      if (a.subscribed || (a.id && hiddenCh.has(a.id))) continue;
      const affinity = (a.seeds.size / maxSeeds) * 0.7 + Math.min(1, a.count / 6) * 0.3;
      const names = [...a.seeds.values()];
      const reason = `「${names[0]}」${names.length > 1 ? `ほか${names.length - 1}ch` : ''}に近い`;
      const all = [...(a.popular || []), ...a.videos.values()];
      for (const v of all) {
        if (cands.has(v.id)) continue;
        const c = Object.assign({}, v, {
          channelId: v.channelId || a.id,
          channelName: v.channelName || a.name,
          handle: v.handle || a.handle,
          affinity,
          reason,
          kind: 'similar',
        });
        if (!R.exclusionReason(c, ctx)) cands.set(v.id, c);
      }
    }
    const scored = R.scoreCandidates(R.assignChannelMax([...cands.values()]), { profile: ctx.profile, settings, rng });
    const results = R.diversify(scored, settings.maxPerChannel, settings.resultCount);
    const channels = ranked
      .filter((a) => !a.subscribed && !(a.id && hiddenCh.has(a.id)))
      .slice(0, 12)
      .map((a) => ({ id: a.id, name: a.name, handle: a.handle, seeds: [...a.seeds.values()], count: a.count }));
    await store.pushRecent({ seeds: seeds.map((s) => s.channel.id) });
    const out = {
      mode: 'similar',
      at: Date.now(),
      results,
      channels,
      seeds: seeds.map((s) => s.channel.title),
      period: ctx.periodMs ? U.periodLabel(settings.periodValue, settings.periodUnit) : null,
      terms: R.topTerms(ctx.profile, 8),
    };
    await store.saveLast('similar', out);
    return out;
  }

  // ---------- 動作診断 ----------
  async function diagnose(log) {
    const safe = async (label, fn) => {
      try {
        log('✔ ' + label + ': ' + (await fn()));
      } catch (e) {
        log('✘ ' + label + ': ' + (e.code === 'NOT_LOGGED_IN' ? 'ログインしていないようです' : e.message));
      }
    };
    log(`拡張機能 v${chrome.runtime.getManifest().version} / ${navigator.userAgent.match(/(Chrome|Brave)\/[\d.]+/g) || ''}`);
    await safe('登録チャンネル（最初の2ページ）', async () => {
      const r = await api.fetchSubscriptions(null, 2);
      return `${r.channels.length}件${r.partial ? '（続きの取得に失敗）' : ''}`;
    });
    await safe('視聴履歴（1ページ目）', async () => {
      const h = await api.fetchHistory(1);
      return `${h.length}件 / チャンネルID付き ${h.filter((v) => v.channelId).length}件`;
    });
    const subs = await store.getSubs();
    const ch = subs.channels[Math.floor(Math.random() * subs.channels.length)];
    if (!ch) return log('（登録チャンネルが未取得のため、以降の診断はスキップ）');
    let sample = null;
    await safe(`人気動画「${ch.title}」`, async () => {
      const p = await api.fetchPopular(ch.id);
      sample = p.videos[0];
      return `${p.videos.length}件 / 取得元 ${p.source} / 再生回数あり ${p.videos.filter((v) => v.views != null).length}件`;
    });
    if (sample) {
      await safe('関連動画', async () => {
        const w = await api.fetchWatch(sample.id, { related: true });
        return `${w.related.length}件 / チャンネルID付き ${w.related.filter((v) => v.channelId).length}件 / 投稿者ID ${
          w.owner ? 'OK' : '取得失敗'
        }`;
      });
    }
    const s = await store.summary();
    log(`保存データ: 登録 ${s.subs}件 / 視聴済み ${s.watched}件 / 非表示 動画${s.hiddenVideos}・チャンネル${s.hiddenChannels}`);
  }

  const engine = { loadContext, sync, shuffleSubscribed, discoverSimilar, diagnose };
  YTS.engine = engine;
})(typeof globalThis !== 'undefined' ? globalThis : this);
