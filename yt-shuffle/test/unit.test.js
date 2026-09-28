'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const { loadLibs } = require('./helpers');
const F = require('./fixtures/yt');

const YTS = loadLibs();
const { util: U, extract: X, rss, takeout, store, recommend: R } = YTS;

// ---------------------------------------------------------------- util
test('parseCount: 日本語・英語の再生回数表記', () => {
  assert.equal(U.parseCount('1,234,567 回視聴'), 1234567);
  assert.equal(U.parseCount('123万 回視聴'), 1230000);
  assert.equal(U.parseCount('1.2万回視聴'), 12000);
  assert.equal(U.parseCount('2.3億 回視聴'), 230000000);
  assert.equal(U.parseCount('1.2M views'), 1200000);
  assert.equal(U.parseCount('12K views'), 12000);
  assert.equal(U.parseCount('987 views'), 987);
  assert.equal(U.parseCount('No views'), 0);
  assert.equal(U.parseCount('視聴回数なし'), 0);
  assert.equal(U.parseCount('１２３万回視聴'), 1230000);
  assert.equal(U.parseCount(''), null);
  assert.equal(U.parseCount(null), null);
});

test('parseDuration / formatDuration', () => {
  assert.equal(U.parseDuration('12:34'), 754);
  assert.equal(U.parseDuration('1:02:03'), 3723);
  assert.equal(U.parseDuration('ライブ'), null);
  assert.equal(U.formatDuration(754), '12:34');
  assert.equal(U.formatDuration(3723), '1:02:03');
});

test('textOf: simpleText / runs / content', () => {
  assert.equal(U.textOf({ simpleText: 'a' }), 'a');
  assert.equal(U.textOf({ runs: [{ text: 'a' }, { text: 'b' }] }), 'ab');
  assert.equal(U.textOf({ content: 'c' }), 'c');
  assert.equal(U.textOf(null), '');
});

test('tokenize: 日本語タイトルから意味のある語を取り出す', () => {
  const t = U.tokenize('【検証】東京の激安ラーメン屋を全部食べてみた！Minecraft実況 part3');
  assert.ok(t.includes('東京'));
  assert.ok(t.includes('ラーメン'));
  assert.ok(t.includes('minecraft'));
  assert.ok(t.includes('実況'));
  assert.ok(!t.includes('の'));
  assert.ok(!t.includes('part3'));
});

test('weightedSample: 重み 0 は選ばれず、シード付きで再現性がある', () => {
  const items = [{ k: 'a', w: 0 }, { k: 'b', w: 1 }, { k: 'c', w: 5 }];
  const s1 = U.weightedSample(items, (x) => x.w, 3, U.makeRng(42)).map((x) => x.k);
  const s2 = U.weightedSample(items, (x) => x.w, 3, U.makeRng(42)).map((x) => x.k);
  assert.deepEqual(s1, s2);
  assert.ok(!s1.includes('a'));
  assert.equal(s1.length, 2);
});

test('mapLimit: 同時実行数を守り、失敗は null', async () => {
  let running = 0;
  let peak = 0;
  const out = await U.mapLimit([1, 2, 3, 4, 5, 6], 2, async (x) => {
    running++;
    peak = Math.max(peak, running);
    await U.sleep(5);
    running--;
    if (x === 3) throw new Error('boom');
    return x * 2;
  });
  assert.equal(peak, 2);
  assert.deepEqual(out, [2, 4, null, 8, 10, 12]);
});

// ---------------------------------------------------------------- extract
test('extractInitialData / extractYtcfg: HTML から JSON を切り出す', () => {
  const data = { a: { b: 'x { y } "z"' }, list: [1, 2] };
  const html = F.html({ data });
  assert.deepEqual(X.extractInitialData(html), data);
  const cfg = X.extractYtcfg(html);
  assert.equal(cfg.INNERTUBE_API_KEY, 'AIzaTESTKEY');
  assert.equal(cfg.CLIENT_CANARY_STATE, 'none');
  assert.equal(cfg.LOGGED_IN, true);
});

test('extractInitialData: 文字列形式（\\x7b...）にも対応', () => {
  const json = JSON.stringify({ hello: 'ワールド', n: 1 });
  const escaped = json.replace(/[{}"]/g, (c) => '\\x' + c.charCodeAt(0).toString(16));
  const html = `<script>var ytInitialData = '${escaped}';</script>`;
  assert.deepEqual(X.extractInitialData(html), { hello: 'ワールド', n: 1 });
});

test('collectChannels: 登録チャンネル一覧（channelRenderer）', () => {
  const chs = [
    { id: F.cid(1), title: 'チャンネルA', handle: '@chA' },
    { id: F.cid(2), title: 'Channel B', handle: '@%E3%83%86%E3%82%B9%E3%83%88' },
  ];
  const data = F.feedChannelsData(chs, 'TOKEN_NEXT');
  const out = X.collectChannels(data);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { id: F.cid(1), title: 'チャンネルA', handle: '@chA', thumb: `https://yt3.googleusercontent.com/${F.cid(1)}=s176` });
  assert.equal(out[1].handle, '@テスト');
  assert.equal(X.findContinuation(data), 'TOKEN_NEXT');
  assert.equal(X.findContinuation(F.feedChannelsData(chs)), null);
  assert.equal(X.collectChannels(F.channelsContinuation([{ id: F.cid(3), title: 'C' }], 'T3')).length, 1);
});

test('collectVideos: 人気順プレイリスト（playlistVideoRenderer）', () => {
  const ch = F.cid(7);
  const data = F.playlistPageData([
    { id: F.vid(1), title: '一番人気', channelId: ch, channelName: 'Ch7', views: 12340000, duration: 754 },
    { id: F.vid(2), title: '二番目', channelId: ch, channelName: 'Ch7', views: 45000, duration: 61, watchedPct: 100 },
    { id: F.vid(3), title: 'ショート', channelId: ch, channelName: 'Ch7', views: 1500, duration: 30, short: true },
  ]);
  const vids = X.collectVideos(data);
  assert.equal(vids.length, 3);
  assert.equal(vids[0].id, F.vid(1));
  assert.equal(vids[0].views, 12340000);
  assert.equal(vids[0].duration, 754);
  assert.equal(vids[0].channelId, ch);
  assert.equal(vids[0].published, '3 年前');
  assert.equal(vids[0].watched, null);
  assert.equal(vids[1].views, 45000);
  assert.equal(vids[1].watched, 100);
  assert.equal(vids[2].short, true);
});

test('collectVideos: 関連動画（lockupViewModel 新形式）', () => {
  const data = F.watchData([
    { id: F.vid(10), title: 'リンクあり', channelId: F.cid(10), channelName: '前田チャンネル', handle: '@maeda', views: 2300000, duration: 900 },
    { id: F.vid(11), title: 'リンクなし', channelId: F.cid(11), channelName: 'NoLink', linkChannel: false, views: 50000 },
    { id: F.vid(12), title: 'ライブ', channelId: F.cid(12), channelName: 'Live', live: true },
    { id: F.vid(13), title: 'ミックス', channelName: 'Mix', type: 'LOCKUP_CONTENT_TYPE_PLAYLIST' },
    { id: F.vid(14), title: '見た', channelId: F.cid(14), channelName: 'W', views: 10, watchedPct: 80 },
  ]);
  const vids = X.collectVideos(X.relatedRoot(data));
  const byId = Object.fromEntries(vids.map((v) => [v.id, v]));
  assert.equal(vids.length, 4, 'プレイリスト型は除外');
  assert.equal(byId[F.vid(10)].channelId, F.cid(10));
  assert.equal(byId[F.vid(10)].handle, '@maeda');
  assert.equal(byId[F.vid(10)].channelName, '前田チャンネル', '「前」を含むチャンネル名を投稿日と誤認しない');
  assert.equal(byId[F.vid(10)].views, 2300000);
  assert.equal(byId[F.vid(10)].duration, 900);
  assert.equal(byId[F.vid(10)].published, '1 年前');
  assert.equal(byId[F.vid(11)].channelId, null);
  assert.equal(byId[F.vid(11)].channelName, 'NoLink');
  assert.equal(byId[F.vid(12)].live, true);
  assert.equal(byId[F.vid(14)].watched, 80);
});

test('collectVideos: 関連動画（compactVideoRenderer 旧形式）', () => {
  const data = F.watchData([{ id: F.vid(20), title: '旧', channelId: F.cid(20), channelName: 'Old', views: 777777, duration: 125 }], {
    useCompact: true,
  });
  const [v] = X.collectVideos(X.relatedRoot(data));
  assert.equal(v.id, F.vid(20));
  assert.equal(v.channelId, F.cid(20));
  assert.equal(v.views, 777777);
  assert.equal(v.duration, 125);
});

test('collectVideos: メンバー限定バッジを検出', () => {
  const data = F.historyData([{ header: '今日', videos: [{ id: F.vid(30), title: 'm', channelId: F.cid(1), channelName: 'A', members: true, views: 1 }] }]);
  assert.equal(X.collectVideos(data)[0].members, true);
});

test('parseSectionDate: 履歴の日付見出し', () => {
  const now = new Date(2026, 8, 28, 15, 0, 0).getTime(); // 2026-09-28 (月)
  const d = (t) => new Date(X.parseSectionDate(t, now));
  assert.equal(X.parseSectionDate('今日', now), now);
  assert.equal(d('昨日').getDate(), 27);
  assert.equal(d('土曜日').getDate(), 26);
  assert.equal(d('月曜日').getDate(), 21, '同じ曜日は 1 週間前');
  assert.equal(d('9月3日').getMonth(), 8);
  assert.equal(d('12月25日').getFullYear(), 2025, '未来の日付は去年');
  assert.equal(d('2024年1月5日').getFullYear(), 2024);
  assert.equal(d('Jan 5, 2024').getMonth(), 0);
  assert.equal(X.parseSectionDate('よくわからない', now), null);
});

test('collectHistory: 見出しの日付を動画に付ける', () => {
  const now = new Date(2026, 8, 28, 15, 0, 0).getTime();
  const mk = (n) => ({ id: F.vid(n), title: 't' + n, channelId: F.cid(n % 3), channelName: 'c' + (n % 3), views: 1 });
  const data = F.historyData(
    [
      { header: '今日', videos: [mk(1), mk(2)] },
      { header: '昨日', videos: [mk(3)], lockup: true },
      { header: '9月3日', videos: [mk(4)] },
    ],
    'HIST_NEXT'
  );
  const items = X.collectHistory(data, now);
  assert.deepEqual(items.map((v) => v.id), [F.vid(1), F.vid(2), F.vid(3), F.vid(4)]);
  assert.equal(items[0].watchedAt, now);
  assert.equal(new Date(items[2].watchedAt).getDate(), 27);
  assert.equal(items[2].channelId, F.cid(0));
  assert.equal(new Date(items[3].watchedAt).getDate(), 3);
  assert.equal(X.findContinuation(data), 'HIST_NEXT');
});

test('isLoggedIn', () => {
  assert.equal(X.isLoggedIn({ LOGGED_IN: false }, null), false);
  assert.equal(X.isLoggedIn({}, { responseContext: { mainAppWebResponseContext: { loggedOut: true } } }), false);
  assert.equal(X.isLoggedIn({}, {}), null);
});

// ---------------------------------------------------------------- rss
test('rss.parseFeed: 再生回数・ショート判定・エンティティ', () => {
  const ch = F.cid(5);
  const xml = F.rssFeed({
    channelId: ch,
    title: 'Tom & Jerry',
    videos: [
      { id: F.vid(1), title: 'A & B <1>', views: 12345 },
      { id: F.vid(2), title: 'short', views: 99, short: true },
    ],
  });
  const feed = rss.parseFeed(xml);
  assert.equal(feed.channelId, ch);
  assert.equal(feed.title, 'Tom & Jerry');
  assert.equal(feed.videos.length, 2);
  assert.equal(feed.videos[0].title, 'A & B <1>');
  assert.equal(feed.videos[0].views, 12345);
  assert.equal(feed.videos[0].channelName, 'Tom & Jerry');
  assert.equal(feed.videos[1].short, true);
  assert.equal(rss.parseFeed('<html>not found</html>'), null);
});

// ---------------------------------------------------------------- takeout
test('takeout: subscriptions.csv（英語・日本語見出し、カンマ入りタイトル）', () => {
  const en = `Channel Id,Channel Url,Channel Title\n${F.cid(1)},http://www.youtube.com/channel/${F.cid(1)},"Hello, World"\n${F.cid(2)},http://www.youtube.com/channel/${F.cid(2)},テスト\n`;
  const ja = `﻿チャンネル ID,チャンネルの URL,チャンネルのタイトル\r\n${F.cid(3)},http://www.youtube.com/channel/${F.cid(3)},"引用""付き"""\r\n`;
  assert.deepEqual(
    takeout.parseSubscriptionsCsv(en).map((c) => [c.id, c.title]),
    [
      [F.cid(1), 'Hello, World'],
      [F.cid(2), 'テスト'],
    ]
  );
  assert.deepEqual(takeout.parseSubscriptionsCsv(ja).map((c) => c.title), ['引用"付き"']);
});

test('takeout: watch-history.json（広告を除外・日本語の接尾辞を除去）', () => {
  const json = JSON.stringify([
    {
      header: 'YouTube',
      title: 'すごい動画 を視聴しました',
      titleUrl: `https://www.youtube.com/watch?v=${F.vid(1)}`,
      subtitles: [{ name: 'Ch1', url: `https://www.youtube.com/channel/${F.cid(1)}` }],
      time: '2024-03-01T12:00:00.000Z',
      products: ['YouTube'],
    },
    {
      header: 'YouTube',
      title: 'Watched ad',
      titleUrl: `https://www.youtube.com/watch?v=${F.vid(2)}`,
      time: '2024-03-01T11:00:00.000Z',
      details: [{ name: 'From Google Ads' }],
    },
    { header: 'YouTube', title: 'Watched removed video', titleUrl: `https://www.youtube.com/watch?v=${F.vid(3)}`, time: '2024-02-01T00:00:00Z' },
    { header: 'YouTube', title: 'Visited YouTube Music', time: '2024-02-01T00:00:00Z' },
  ]);
  const out = takeout.parseWatchHistory(json);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { id: F.vid(1), title: 'すごい動画', channelId: F.cid(1), channelName: 'Ch1', t: Date.parse('2024-03-01T12:00:00.000Z') });
  assert.equal(out[1].title, 'removed video');
  assert.equal(out[1].channelId, null);
});

test('takeout: watch-history.html', () => {
  const cell = (id, title, ch, chName, date, ad) =>
    `<div class="outer-cell mdl-cell mdl-cell--12-col mdl-shadow--2dp"><div class="mdl-grid"><div class="header-cell mdl-cell mdl-cell--12-col"><p class="mdl-typography--title">YouTube<br></p></div><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Watched&nbsp;<a href="https://www.youtube.com/watch?v=${id}">${title}</a><br><a href="https://www.youtube.com/channel/${ch}">${chName}</a><br>${date}<br></div><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1 mdl-typography--text-right"></div><div class="content-cell mdl-cell mdl-cell--12-col mdl-typography--caption"><b>Products:</b><br>&emsp;YouTube<br>${ad ? '<b>Details:</b><br>&emsp;From Google Ads<br>' : ''}</div></div></div>`;
  const html = `<html><body><div class="mdl-grid">${cell(F.vid(1), 'Tom &amp; Jerry', F.cid(1), 'Ch &amp; 1', 'Jan 5, 2024, 8:15:30 PM JST')}${cell(F.vid(2), 'ad', F.cid(2), 'Ads', 'Jan 5, 2024, 8:00:00 PM JST', true)}${cell(F.vid(3), '日本語', F.cid(3), 'チャンネル', '2024/01/04 10:00:00 JST')}</div></body></html>`;
  const out = takeout.parseWatchHistory(html);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, F.vid(1));
  assert.equal(out[0].title, 'Tom & Jerry');
  assert.equal(out[0].channelName, 'Ch & 1');
  assert.equal(out[0].channelId, F.cid(1));
  assert.ok(out[0].t > 0);
  assert.equal(new Date(out[1].t).getDate(), 4);
});

// ---------------------------------------------------------------- store
test('store: 視聴済みの保存（分割保存・マージ・タイトル）', async () => {
  await chrome.storage.local.clear();
  const added1 = await store.mergeWatched([
    { id: 'Abcdefghijk', t: 100, channelId: F.cid(1), channelName: 'A', title: '最初' },
    { id: 'zbcdefghijk', t: 0, channelId: null, channelName: 'Z' },
  ]);
  assert.equal(added1, 2);
  const added2 = await store.mergeWatched([
    { id: 'Abcdefghijk', t: 500, channelId: null, channelName: '', title: '最初' },
    { id: 'zbcdefghijk', t: 50, channelId: F.cid(9), channelName: 'Z' },
    { id: 'bad', t: 1 },
  ]);
  assert.equal(added2, 0);
  const w = await store.loadWatched();
  assert.equal(w.size, 2);
  assert.deepEqual(w.get('Abcdefghijk'), { t: 500, c: F.cid(1), n: 'A' });
  assert.deepEqual(w.get('zbcdefghijk'), { t: 50, c: F.cid(9), n: 'Z' });
  assert.ok(chrome.storage.local._data.wv_A);
  assert.ok(chrome.storage.local._data.wv_z);
  assert.deepEqual(await store.getTitles(), ['最初']);
});

test('store: 設定の既定値・非表示・最近表示', async () => {
  await chrome.storage.local.clear();
  const s = await store.getSettings();
  assert.equal(s.excludeShorts, true);
  await store.saveSettings({ resultCount: 7 });
  assert.equal((await store.getSettings()).resultCount, 7);
  await store.hideChannel(F.cid(1), 'A');
  await store.hideVideo(F.vid(1));
  const h = await store.getHidden();
  assert.equal(h.channels[F.cid(1)].name, 'A');
  assert.ok(h.videos[F.vid(1)]);
  await store.unhideChannel(F.cid(1));
  assert.deepEqual((await store.getHidden()).channels, {});
  await store.pushRecent({ channels: ['a', 'b'] });
  await store.pushRecent({ channels: ['c', 'a'], seeds: ['s'] });
  assert.deepEqual((await store.getRecent()).channels, ['c', 'a', 'b']);
  await store.clearAllData();
  assert.equal((await store.getSettings()).resultCount, 7, '設定は残る');
  assert.equal((await store.getHidden()).videos[F.vid(1)], undefined);
});

// ---------------------------------------------------------------- recommend
test('recommend: チャンネルの視聴状況と抽選の重み', () => {
  const now = Date.UTC(2026, 8, 28);
  const watched = new Map([
    [F.vid(1), { t: now - 5 * U.DAY, c: F.cid(1), n: 'A' }],
    [F.vid(2), { t: now - 4 * U.DAY, c: F.cid(1), n: 'A' }],
    [F.vid(3), { t: now - 3 * U.DAY, c: F.cid(1), n: 'A' }],
    [F.vid(4), { t: now - 2 * U.DAY, c: F.cid(1), n: 'A' }],
    [F.vid(5), { t: now - 200 * U.DAY, c: null, n: 'Ｂ チャンネル' }],
    ...[6, 7, 8, 9, 10].map((n) => [F.vid(n), { t: now - 150 * U.DAY, c: F.cid(3), n: 'C' }]),
  ]);
  const stats = R.channelStats(watched);
  const settings = store.DEFAULT_SETTINGS;
  const st = (ch) => R.statsForChannel(stats, ch);
  assert.deepEqual(st({ id: F.cid(1), title: 'A' }), { count: 4, last: now - 2 * U.DAY });
  assert.equal(st({ id: F.cid(2), title: 'Bチャンネル' }).count, 1, '名前（表記ゆれ込み）で一致');
  assert.equal(R.subscribedChannelWeight(st({ id: F.cid(9), title: 'X' }), settings, now).kind, 'unwatched');
  assert.equal(R.subscribedChannelWeight(st({ id: F.cid(2), title: 'Bチャンネル' }), settings, now).kind, 'few');
  assert.equal(R.subscribedChannelWeight(st({ id: F.cid(3), title: 'C' }), settings, now).kind, 'neglected');
  assert.equal(R.subscribedChannelWeight(st({ id: F.cid(1), title: 'A' }), settings, now).kind, 'frequent');
  assert.equal(R.subscribedChannelWeight(st({ id: F.cid(1), title: 'A' }), { ...settings, includeFrequent: false }, now).w, 0);
});

test('recommend: 未視聴チャンネルほど選ばれやすく、非表示は選ばれない', () => {
  const channels = Array.from({ length: 40 }, (_, i) => ({ id: F.cid(i), title: 'c' + i }));
  const watched = new Map();
  let n = 0;
  for (let i = 0; i < 20; i++) for (let k = 0; k < 10; k++) watched.set(F.vid(n++), { t: Date.now(), c: F.cid(i), n: 'c' + i });
  const stats = R.channelStats(watched);
  const counts = { unwatched: 0, frequent: 0 };
  const rng = U.makeRng(7);
  for (let r = 0; r < 200; r++) {
    const picks = R.pickSubscribedChannels(channels, stats, { ...store.DEFAULT_SETTINGS, channelsPerShuffle: 5 }, {
      rng,
      hiddenChannels: new Set([F.cid(39)]),
    });
    for (const p of picks) {
      assert.notEqual(p.channel.id, F.cid(39));
      counts[p.kind]++;
    }
  }
  assert.ok(counts.unwatched > counts.frequent * 3, JSON.stringify(counts));
});

test('recommend: 除外ルール', () => {
  const ctx = {
    settings: { ...store.DEFAULT_SETTINGS, maxDurationMin: 60, minViews: 100 },
    watched: new Map([[F.vid(1), { t: 1 }]]),
    hidden: { videos: { [F.vid(2)]: 1 }, channels: { [F.cid(9)]: { t: 1 } } },
  };
  const base = { views: 1000, duration: 600, channelId: F.cid(1) };
  const ex = (v) => R.exclusionReason({ ...base, ...v }, ctx);
  assert.equal(ex({ id: F.vid(1) }), 'watched');
  assert.equal(ex({ id: F.vid(2) }), 'hidden');
  assert.equal(ex({ id: F.vid(3), channelId: F.cid(9) }), 'hiddenChannel');
  assert.equal(ex({ id: F.vid(3), watched: 50 }), 'watched');
  assert.equal(ex({ id: F.vid(3), watched: 5 }), null);
  assert.equal(ex({ id: F.vid(3), short: true }), 'short');
  assert.equal(ex({ id: F.vid(3), live: true }), 'live');
  assert.equal(ex({ id: F.vid(3), members: true }), 'members');
  assert.equal(ex({ id: F.vid(3), duration: 30 }), 'tooShort');
  assert.equal(ex({ id: F.vid(3), duration: 4000 }), 'tooLong');
  assert.equal(ex({ id: F.vid(3), views: 10 }), 'fewViews');
  assert.equal(ex({ id: F.vid(3), duration: null, views: null }), null);
});

test('recommend: スコア（人気のみ重視なら再生回数順）と多様化', () => {
  const settings = { ...store.DEFAULT_SETTINGS, popularityWeight: 100, interestWeight: 0, randomness: 0 };
  const cands = [
    { id: 'a', title: 'a', views: 1e3, channelId: 'X', channelMaxViews: 1e7 },
    { id: 'b', title: 'b', views: 1e7, channelId: 'X', channelMaxViews: 1e7 },
    { id: 'c', title: 'c', views: 1e6, channelId: 'X', channelMaxViews: 1e7 },
    { id: 'd', title: 'd', views: 1e5, channelId: 'Y', channelMaxViews: 1e5 },
    { id: 'e', title: 'e', views: 5e6, channelId: 'Z', channelMaxViews: 5e6 },
  ];
  const sorted = R.scoreCandidates(cands, { profile: R.buildProfile([]), settings, rng: U.makeRng(1) });
  assert.deepEqual(sorted.map((c) => c.id), ['b', 'e', 'c', 'd', 'a']);
  const div = R.diversify(sorted, 2, 4);
  assert.deepEqual(div.map((c) => c.id).sort(), ['b', 'c', 'd', 'e']);
  const one = R.diversify(sorted, 1, 10);
  assert.deepEqual(one.map((c) => c.id), ['b', 'e', 'd']);
});

test('recommend: 興味プロファイル（視聴タイトルに近い動画ほど高い）', () => {
  const profile = R.buildProfile([
    'ラーメン屋巡り 東京編',
    '絶品ラーメンを食べる',
    'ラーメン 二郎 東京',
    'キャンプ 道具 紹介',
    'キャンプ飯 簡単レシピ',
  ]);
  assert.ok(R.topTerms(profile).includes('ラーメン'));
  const hi = R.interestRaw(profile, '札幌の味噌ラーメン食べ比べ');
  const lo = R.interestRaw(profile, 'プログラミング入門 Python');
  assert.ok(hi > lo);
  assert.equal(lo, 0);
});

test('recommend: pickLucky は上位から選ぶ', () => {
  const results = Array.from({ length: 20 }, (_, i) => ({ id: 'v' + i, score: 1 - i / 20 }));
  for (let s = 0; s < 30; s++) {
    const p = R.pickLucky(results, U.makeRng(s));
    assert.ok(Number(p.id.slice(1)) < 8);
  }
  assert.equal(R.pickLucky([]), null);
});

// ---------------------------------------------------------------- yt-api
test('buildAuthHeader: SAPISIDHASH の形式', async () => {
  require('../extension/content/yt-api.js');
  const ts = 1700000000;
  const header = await YTS.api.buildAuthHeader({ SAPISID: 'abc', '__Secure-1PAPISID': 'def', '__Secure-3PAPISID': 'ghi' }, ts);
  const sha = (s) => nodeCrypto.createHash('sha1').update(s).digest('hex');
  const o = 'https://www.youtube.com';
  assert.equal(
    header,
    `SAPISIDHASH ${ts}_${sha(`${ts} abc ${o}`)} SAPISID1PHASH ${ts}_${sha(`${ts} def ${o}`)} SAPISID3PHASH ${ts}_${sha(`${ts} ghi ${o}`)}`
  );
  assert.equal(await YTS.api.buildAuthHeader({}, ts), null);
  assert.deepEqual(YTS.api.parseCookies('a=1; SAPISID=x%2Fy; b'), { a: '1', SAPISID: 'x/y' });
});

// ---------------------------------------------------------------- 投稿日・期間
test('parseAge / publishedAt: 相対表記と ISO 日時', () => {
  const D = U.DAY;
  assert.equal(U.parseAge('3 年前'), 3 * 365 * D);
  assert.equal(U.parseAge('2 週間前'), 14 * D);
  assert.equal(U.parseAge('5 か月前'), 150 * D);
  assert.equal(U.parseAge('5ヶ月前'), 150 * D);
  assert.equal(U.parseAge('12 時間前'), 12 * 3600e3);
  assert.equal(U.parseAge('30 分前'), 30 * 60e3);
  assert.equal(U.parseAge('配信済み: 2 日前'), 2 * D);
  assert.equal(U.parseAge('3 years ago'), 3 * 365 * D);
  assert.equal(U.parseAge('Streamed 1 day ago'), D);
  assert.equal(U.parseAge('前田チャンネル'), null);
  const ref = Date.UTC(2026, 8, 28);
  assert.equal(U.publishedAt('2 日前', ref), ref - 2 * D);
  assert.equal(U.publishedAt('2023-05-01T09:00:00+00:00', ref), Date.parse('2023-05-01T09:00:00Z'));
  assert.equal(U.publishedAt('', ref), null);
});

test('periodMs / periodLabel', () => {
  assert.equal(U.periodMs(0, 'month'), null);
  assert.equal(U.periodMs(24, 'hour'), U.DAY);
  assert.equal(U.periodMs(1, 'week'), 7 * U.DAY);
  assert.equal(U.periodMs(2, 'year'), 730 * U.DAY);
  assert.equal(U.periodLabel(1, 'week'), '1週間以内');
  assert.equal(U.periodLabel(3, 'month'), '3か月以内');
  assert.equal(U.periodLabel(0, 'month'), 'すべての期間');
});

test('recommend: 期間外・投稿日不明の動画は除外', () => {
  const now = Date.UTC(2026, 8, 28);
  const ctx = {
    settings: store.DEFAULT_SETTINGS,
    watched: new Map(),
    hidden: { videos: {}, channels: {} },
    now,
    periodMs: U.periodMs(1, 'week'),
  };
  const base = { id: F.vid(1), views: 1000, duration: 600 };
  assert.equal(R.exclusionReason({ ...base, publishedAt: now - 3 * U.DAY }, ctx), null);
  assert.equal(R.exclusionReason({ ...base, publishedAt: now - 8 * U.DAY }, ctx), 'outOfPeriod');
  assert.equal(R.exclusionReason({ ...base, publishedAt: null }, ctx), 'unknownDate');
  assert.equal(R.exclusionReason({ ...base, publishedAt: null }, { ...ctx, periodMs: null }), null);
});

test('recommend: assignChannelMax はチャンネルごとの最大再生回数', () => {
  const list = R.assignChannelMax([
    { id: 'a', channelId: 'X', views: 10 },
    { id: 'b', channelId: 'X', views: 500 },
    { id: 'c', channelId: null, channelName: 'Y', views: 7 },
  ]);
  assert.deepEqual(list.map((c) => c.channelMaxViews), [500, 500, 7]);
});

// ---------------------------------------------------------------- スキップ
test('store: スキップは期限付きで、期限切れは掃除される', async () => {
  await chrome.storage.local.clear();
  await store.skipVideo(F.vid(1), 30);
  let h = await store.getHidden();
  assert.ok(h.skips[F.vid(1)] > Date.now() + 29 * U.DAY);
  assert.equal(store.activeSkipCount(h), 1);
  // 期限切れのものは次の書き込みで消える
  h.skips[F.vid(2)] = Date.now() - 1000;
  await chrome.storage.local.set({ hidden: h });
  assert.equal(store.activeSkipCount(await store.getHidden()), 1);
  await store.skipVideo(F.vid(3), 7);
  h = await store.getHidden();
  assert.deepEqual(Object.keys(h.skips).sort(), [F.vid(1), F.vid(3)]);
  assert.equal((await store.summary()).skipped, 2);
  await store.clearSkips();
  assert.deepEqual((await store.getHidden()).skips, {});
});

test('recommend: スキップ中の動画は除外、期限切れなら戻る', () => {
  const now = Date.UTC(2026, 8, 28);
  const ctx = {
    settings: store.DEFAULT_SETTINGS,
    watched: new Map(),
    hidden: { videos: {}, channels: {}, skips: { [F.vid(1)]: now + U.DAY, [F.vid(2)]: now - 1 } },
    now,
  };
  assert.equal(R.exclusionReason({ id: F.vid(1), duration: 600 }, ctx), 'skipped');
  assert.equal(R.exclusionReason({ id: F.vid(2), duration: 600 }, ctx), null);
});

test('recommend: refill は上限を守って補充し、残りを返す', () => {
  const mk = (id, ch) => ({ id, channelId: ch, score: 1 });
  const results = [mk('a', 'X'), mk('b', 'X'), mk('c', 'Y')];
  const pool = [mk('d', 'X'), mk('e', 'Z'), mk('f', 'Y'), mk('g', 'W'), mk('h', 'V')];
  const r = R.refill(results, pool, { maxPerChannel: 2, limit: 5, isExcluded: (c) => c.id === 'f' });
  assert.deepEqual(r.results.map((x) => x.id), ['a', 'b', 'c', 'e', 'g']);
  assert.deepEqual(r.added.map((x) => x.id), ['e', 'g']);
  assert.deepEqual(r.pool.map((x) => x.id), ['d', 'h'], '上限超えと枠外は残る・除外は捨てる');
  const scored = [mk('a', 'X'), mk('z', 'Q'), mk('b', 'X')];
  assert.deepEqual(R.reservePool(scored, [scored[0]]).map((x) => x.id), ['z', 'b']);
});
