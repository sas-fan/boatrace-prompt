'use strict';
// 取得フロー全体のテスト（YouTube 通信部分はフェイクに差し替え）
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadLibs } = require('./helpers');
const F = require('./fixtures/yt');

const YTS = loadLibs();
const { store, util: U } = YTS;

// ---- フェイクの YouTube ----
// 登録チャンネル: 0〜11。0〜3 はよく見る、4〜11 は未視聴。
const SUBS = Array.from({ length: 12 }, (_, i) => ({ id: F.cid(i), title: `登録${i}`, handle: `@sub${i}`, thumb: null }));
// 各チャンネルの人気動画: 10 本（1 本目は視聴済みバー付き、9 本目はショート）
function popularOf(chId) {
  const n = parseInt(chId.slice(2), 10);
  return Array.from({ length: 10 }, (_, k) => ({
    id: F.vid(n * 100 + k),
    title: k % 2 ? `ラーメン 食べ歩き ${n}-${k}` : `キャンプ 動画 ${n}-${k}`,
    channelId: chId,
    channelName: n >= 100 ? `近い${n}` : `登録${n}`,
    views: 10_000_000 / (k + 1),
    duration: k === 8 ? 40 : 600,
    published: '1 年前',
    live: false,
    upcoming: false,
    short: k === 8,
    members: false,
    watched: k === 0 ? 100 : null,
  }));
}
// 関連動画: 登録チャンネル 1 本 + 未登録 100〜103 番（101 はチャンネル ID が取れない）
function relatedOf(videoId) {
  const seedCh = Math.floor(parseInt(videoId.slice(3), 10) / 100);
  const rel = [
    { id: F.vid(9000 + seedCh), channelId: F.cid(5), channelName: '登録5', views: 5000 },
    { id: F.vid(10000 + seedCh * 10 + 0), channelId: F.cid(100), channelName: '近い100', views: 3_000_000 },
    { id: F.vid(10000 + seedCh * 10 + 1), channelId: null, channelName: '近い101', views: 800_000 },
    { id: F.vid(10000 + seedCh * 10 + 2), channelId: F.cid(102 + (seedCh % 2)), channelName: `近い${102 + (seedCh % 2)}`, views: 20_000 },
  ];
  return rel.map((r) => ({ duration: 700, published: '2 年前', live: false, upcoming: false, short: false, members: false, watched: null, handle: null, title: `関連 ${r.channelName}`, ...r }));
}

const calls = { popular: [], watch: [], history: 0, subs: 0 };
YTS.api = {
  async fetchSubscriptions() {
    calls.subs++;
    return { channels: SUBS, partial: false };
  },
  async fetchHistory() {
    calls.history++;
    const now = Date.now();
    const items = [];
    for (let c = 0; c < 4; c++) for (let k = 1; k <= 5; k++) items.push({ id: F.vid(c * 100 + k), title: 'ラーメン 東京 ' + k, channelId: F.cid(c), channelName: `登録${c}`, watchedAt: now - k * U.DAY });
    return items;
  },
  async fetchPopular(chId) {
    calls.popular.push(chId);
    return { source: 'popular', videos: popularOf(chId) };
  },
  async fetchLatest(chId) {
    calls.latest = (calls.latest || []).concat(chId);
    const n = parseInt(chId.slice(2), 10);
    // 最新動画: 2 日前・5 日前・20 日前
    return {
      source: 'latest',
      videos: [2, 5, 20].map((d, k) => ({
        id: F.vid(50000 + n * 10 + k),
        title: `新作 ${n}-${k}`,
        channelId: chId,
        channelName: `登録${n}`,
        views: 1000 * (k + 1),
        duration: 500,
        published: `${d} 日前`,
        live: false,
        upcoming: false,
        short: false,
        members: false,
        watched: null,
      })),
    };
  },
  async fetchSubscriptionFeed() {
    calls.feed = (calls.feed || 0) + 1;
    // 新着フィード: 登録 0〜11 の 1 日前の動画（チャンネル ID なしで名前だけのものも混ぜる）
    return SUBS.map((c, i) => ({
      id: F.vid(60000 + i),
      title: `新着 ${i}`,
      channelId: i % 3 === 0 ? null : c.id,
      channelName: c.title,
      views: 300 + i,
      duration: 400,
      published: '1 日前',
      live: false,
      upcoming: false,
      short: false,
      members: false,
      watched: null,
    }));
  },
  async fetchWatch(videoId, { related } = {}) {
    calls.watch.push(videoId);
    const n = parseInt(videoId.slice(3), 10);
    const owner = n >= 10000 && n % 10 === 1 ? { channelId: F.cid(101), name: '近い101' } : null;
    return { owner, title: '', related: related ? relatedOf(videoId) : [] };
  },
};
require('../extension/content/engine.js');
const { engine } = YTS;

test('sync: 登録チャンネルと視聴履歴を保存し、新しければ取り直さない', async () => {
  await chrome.storage.local.clear();
  const rep = await engine.sync({ force: false });
  assert.equal(rep.subs, 12);
  assert.equal(rep.history, 20);
  assert.equal(rep.historyAdded, 20);
  assert.equal((await store.getSubs()).channels.length, 12);
  assert.equal((await store.loadWatched()).size, 20);
  const rep2 = await engine.sync({ force: false });
  assert.deepEqual(rep2, {});
  assert.equal(calls.subs, 1);
});

test('shuffleSubscribed: 視聴済み・ショートを除外し、1 チャンネル 2 本まで', async () => {
  await store.saveSettings({ channelsPerShuffle: 6, resultCount: 10 });
  const out = await engine.shuffleSubscribed({ rng: U.makeRng(3) });
  assert.equal(out.checked, 6);
  assert.ok(out.results.length > 0 && out.results.length <= 10);
  const watched = await store.loadWatched(); // シャッフル中に見つかった再生済みバーの分も含む
  const perCh = {};
  for (const r of out.results) {
    assert.ok(!r.short, 'ショートは除外');
    assert.notEqual(r.id.slice(-2), '00', '視聴済みバー付き（1 本目）は除外');
    assert.ok(!watched.has(r.id), '視聴済みの動画は除外');
    assert.ok(r.reason);
    assert.ok(r.rank >= 1);
    perCh[r.channelId] = (perCh[r.channelId] || 0) + 1;
  }
  assert.ok(Object.values(perCh).every((n) => n <= 2));
  // 未視聴チャンネル（4〜11）が多く選ばれる
  const unwatchedCh = out.results.filter((r) => parseInt(r.channelId.slice(2), 10) >= 4).length;
  assert.ok(unwatchedCh >= out.results.length / 2, `未視聴チャンネル由来 ${unwatchedCh}/${out.results.length}`);
  // 再生済みバー付きの動画が視聴済みとして記録された
  const w2 = await store.loadWatched();
  assert.ok(w2.size > 20);
  // キャッシュされ、2 回目は再取得しない
  const before = calls.popular.length;
  await engine.shuffleSubscribed({ rng: U.makeRng(3) });
  const refetched = calls.popular.slice(before).filter((id) => out.results.some((r) => r.channelId === id));
  assert.equal(refetched.length, 0);
  assert.ok(await store.getLast('subs'));
});

test('shuffleSubscribed: 非表示にしたチャンネルは出ない', async () => {
  for (let i = 4; i < 12; i++) await store.hideChannel(F.cid(i), '');
  const out = await engine.shuffleSubscribed({ rng: U.makeRng(9) });
  assert.ok(out.results.every((r) => parseInt(r.channelId.slice(2), 10) < 4));
  await store.clearAllData();
});

test('discoverSimilar: 未登録の近いチャンネルだけを出し、ID 不明チャンネルも解決する', async () => {
  await chrome.storage.local.clear();
  await engine.sync({ force: true });
  await store.saveSettings({ similarSeeds: 3, similarChannels: 4, resultCount: 12 });
  const out = await engine.discoverSimilar({ rng: U.makeRng(5) });
  assert.equal(out.mode, 'similar');
  assert.ok(out.results.length > 0);
  const subIds = new Set(SUBS.map((s) => s.id));
  for (const r of out.results) {
    assert.ok(!subIds.has(r.channelId), `登録済みチャンネルは出ない: ${r.channelName}`);
    assert.equal(r.kind, 'similar');
    assert.match(r.reason, /に近い$/);
  }
  const names = out.channels.map((c) => c.name);
  assert.ok(names.includes('近い100'));
  assert.ok(!names.includes('登録5'));
  const c100 = out.channels.find((c) => c.name === '近い100');
  assert.equal(c100.seeds.length, 3, '3 つの起点すべてから辿れた');
  // ID が不明だった「近い101」は動画ページから UC... を解決して人気動画まで掘っている
  const c101 = out.channels.find((c) => c.name === '近い101');
  assert.equal(c101.id, F.cid(101));
  assert.ok(calls.popular.includes(F.cid(101)));
  assert.ok(calls.popular.includes(F.cid(100)));
});

test('期間指定（1 週間以内）: 人気順の古い動画は外れ、最新動画と新着フィードから選ぶ', async () => {
  await chrome.storage.local.clear();
  await engine.sync({ force: true });
  await store.saveSettings({ channelsPerShuffle: 6, resultCount: 30, maxPerChannel: 3, periodValue: 1, periodUnit: 'week' });
  const out = await engine.shuffleSubscribed({ rng: U.makeRng(11) });
  assert.equal(out.period, '1週間以内');
  assert.ok(out.feed > 0, '新着フィードを使った');
  assert.ok(out.results.length > 0);
  const now = Date.now();
  for (const r of out.results) {
    assert.ok(r.publishedAt != null && now - r.publishedAt <= 7 * U.DAY, `${r.title} は期間内`);
    assert.ok(/^(新作|新着)/.test(r.title), r.title);
  }
  // 名前だけの新着（チャンネル ID なし）も登録チャンネルとして扱われる
  assert.ok(out.results.some((r) => r.id === F.vid(60003)) || out.results.every((r) => r.channelId));
  assert.ok(out.results.every((r) => r.channelId && r.channelId.startsWith('UC')));

  // 近いチャンネル発見も期間で絞られる（関連動画は 2 年前なので、最新動画だけが残る）
  const sim = await engine.discoverSimilar({ rng: U.makeRng(4) });
  assert.equal(sim.period, '1週間以内');
  assert.ok(sim.results.length > 0, '近いチャンネルの最新動画から選ばれる');
  for (const r of sim.results) assert.ok(now - r.publishedAt <= 7 * U.DAY, r.title);

  // 期間を戻すと人気順の古い動画も出る
  await store.saveSettings({ periodValue: 0 });
  const all = await engine.shuffleSubscribed({ rng: U.makeRng(11) });
  assert.equal(all.period, null);
  assert.ok(all.results.some((r) => /^(ラーメン|キャンプ)/.test(r.title)));
});

test('スキップした動画は次のシャッフルに出ず、補充候補（pool）も返る', async () => {
  await chrome.storage.local.clear();
  await engine.sync({ force: true });
  await store.saveSettings({ channelsPerShuffle: 12, resultCount: 6, maxPerChannel: 1, periodValue: 0 });
  const first = await engine.shuffleSubscribed({ rng: U.makeRng(21) });
  assert.equal(first.results.length, 6);
  assert.ok(first.pool.length > 0, '補充候補がある');
  assert.ok(first.pool.every((p) => !first.results.some((r) => r.id === p.id)));
  for (const r of first.results) await store.skipVideo(r.id, 30);
  await chrome.storage.local.set({ recent: { channels: [], seeds: [] } });
  const second = await engine.shuffleSubscribed({ rng: U.makeRng(21) });
  const skipped = new Set(first.results.map((r) => r.id));
  assert.ok(second.results.length > 0);
  assert.ok(second.results.every((r) => !skipped.has(r.id)), 'スキップした動画は出ない');
});
