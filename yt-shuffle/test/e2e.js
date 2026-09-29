'use strict';
// 実際の Chromium に拡張機能を読み込み、youtube.com をダミー応答に差し替えて動作を確認する E2E テスト。
//   npm i -D playwright && node test/e2e.js [出力フォルダ]
// ※ 本物の YouTube には接続しない（ページ構造はフィクスチャで再現）
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const F = require('./fixtures/yt');

const EXT = path.resolve(__dirname, '../extension');
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'yt-shuffle-e2e'));
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- ダミーの YouTube
const GENRES = [
  ['ラーメン', ['東京の激ウマ{}を食べ歩き', '行列のできる{}屋に潜入', '深夜の{}ベスト3']],
  ['キャンプ', ['冬の{}で本気の焚き火', 'ソロ{}道具を全部紹介', '初心者の{}飯レシピ']],
  ['ゲーム実況', ['{}ホラー 最恐回', '伝説の{} 神回まとめ', '{} 耐久24時間']],
  ['旅行', ['1泊2日の北海道{}', '0円で行く{}術', '海外{}で大失敗']],
  ['料理', ['プロが教える{}の基本', '10分で作る{}', '失敗しない{}のコツ']],
  ['筋トレ', ['自宅でできる{}', '{}を30日続けた結果', '初心者向け{}メニュー']],
];
const SUBS = Array.from({ length: 30 }, (_, i) => ({
  id: F.cid(i + 1),
  title: `${GENRES[i % GENRES.length][0]}チャンネル${String.fromCharCode(65 + (i % 26))}${i >= 26 ? i : ''}`,
  handle: `@sub${i + 1}`,
}));
const NEAR = Array.from({ length: 10 }, (_, i) => ({
  id: F.cid(500 + i),
  title: `${GENRES[i % GENRES.length][0]}の達人${i + 1}`,
  handle: `@near${i + 1}`,
}));
const ALL_CH = new Map([...SUBS, ...NEAR].map((c) => [c.id, c]));
const genreOf = (chId) => {
  const n = parseInt(chId.slice(2), 10);
  return GENRES[(n >= 500 ? n - 500 : n - 1) % GENRES.length];
};
function channelVideos(chId) {
  const ch = ALL_CH.get(chId);
  const n = parseInt(chId.slice(2), 10);
  const [g, pats] = genreOf(chId);
  return Array.from({ length: 12 }, (_, k) => ({
    id: F.vid(n * 100 + k),
    title: pats[k % pats.length].replace('{}', g) + (k >= 3 ? ` #${k}` : ''),
    channelId: chId,
    channelName: ch.title,
    handle: ch.handle,
    views: Math.round((8_000_000 / (k + 1)) * (1 + (n % 5))),
    duration: 300 + ((n * 37 + k * 91) % 1500),
    watchedPct: k === 0 ? 100 : null,
    short: k === 11,
    published: `${1 + (k % 5)} 年前`,
  }));
}
// 最新動画（投稿日が新しいもの）
const RECENT_AGES = ['6 時間前', '3 日前', '12 日前', '2 か月前'];
function recentVideos(chId) {
  const ch = ALL_CH.get(chId);
  const n = parseInt(chId.slice(2), 10);
  const [g] = genreOf(chId);
  return RECENT_AGES.map((age, k) => ({
    id: F.vid(700000 + n * 10 + k),
    title: `【新作】${g}の最新動画 ${n}-${k + 1}`,
    channelId: chId,
    channelName: ch.title,
    handle: ch.handle,
    views: 20000 * (4 - k) + n * 100,
    duration: 480 + k * 60,
    published: age,
  }));
}
// 検索結果（ジャンル別人気）: 1 ページ 10 本 × 3 ページ
const SEARCH_CH = Array.from({ length: 20 }, (_, i) => ({ id: F.cid(3000 + i), title: `人気クリエイター${i + 1}`, handle: `@pop${i + 1}` }));
function searchPage(query, page) {
  const qn = [...query].reduce((a, c) => a + c.charCodeAt(0), 0) % 997;
  return Array.from({ length: 10 }, (_, k) => {
    const i = page * 10 + k;
    const ch = SEARCH_CH[(qn + i) % SEARCH_CH.length];
    return {
      id: F.vid(4000000 + qn * 100 + i),
      title: `【${query}】今週いちばん見られた動画 No.${i + 1}`,
      channelId: ch.id,
      channelName: ch.title,
      handle: ch.handle,
      views: i % 10 === 9 ? 500 : Math.round(3_000_000 / (1 + i * 0.35)), // 各ページ 10 本目は再生回数が少ない
      duration: 360 + i * 30,
      published: `${1 + (i % 6)} 日前`,
    };
  });
}
function searchData(query, page) {
  const items = searchPage(query, page).map(F.videoRenderer);
  const cont = page < 2 ? [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: `SEARCH|${query}|${page + 1}` } } } }] : [];
  return page === 0
    ? { contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: items } }, ...cont] } } } } }
    : { onResponseReceivedCommands: [{ appendContinuationItemsAction: { continuationItems: [{ itemSectionRenderer: { contents: items } }, ...cont] } }] };
}
const searchQueries = [];
// よく見る登録チャンネル = 1〜5（履歴に出てくる）
const HISTORY_SECTIONS = [
  { header: '今日', videos: [1, 2].flatMap((c) => channelVideos(F.cid(c)).slice(1, 4)) },
  { header: '昨日', videos: [3, 4].flatMap((c) => channelVideos(F.cid(c)).slice(1, 3)), lockup: true },
];
const HISTORY_MORE = [{ header: '9月3日', videos: channelVideos(F.cid(5)).slice(1, 3) }];

function relatedFor(videoId) {
  const n = Math.floor(parseInt(videoId.slice(3), 10) / 100);
  const pick = (arr, k) => arr[(n + k) % arr.length];
  const items = [];
  for (let k = 0; k < 4; k++) {
    const near = pick(NEAR, k);
    const v = channelVideos(near.id)[1 + k];
    items.push({ ...v, linkChannel: k !== 2 }); // 一部はチャンネルへのリンクなし（新 UI の再現）
  }
  items.push({ ...channelVideos(pick(SUBS, 3).id)[2] }); // 登録済みチャンネル
  items.push({ ...channelVideos(pick(NEAR, 5).id)[4], live: true });
  return items;
}

const pageBody = (label) => `
<div style="height:56px;display:flex;align-items:center;gap:12px;padding:0 24px;border-bottom:1px solid #e5e5e5;font:600 18px Roboto,Arial">
  <div style="width:30px;height:21px;border-radius:6px;background:#f03"></div>YouTube <span style="font-weight:400;color:#888;font-size:13px">（${label}）</span></div>
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:24px">${Array.from({ length: 12 }, () => '<div><div style="aspect-ratio:16/9;background:#e9e9e9;border-radius:12px"></div><div style="height:12px;margin:10px 0 6px;background:#eee;width:90%"></div><div style="height:10px;background:#f2f2f2;width:60%"></div></div>').join('')}</div>`;

let videoBuf = null;
const seenAuth = [];
function routeYouTube(route) {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname;
  const htmlRes = (body) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
  if (p === '/') return htmlRes(F.html({ data: {}, body: pageBody('テスト用ダミーページ') }));
  if (p === '/feed/channels') return htmlRes(F.html({ data: F.feedChannelsData(SUBS.slice(0, 20), 'SUBS_2') }));
  if (p === '/feed/history') return htmlRes(F.html({ data: F.historyData(HISTORY_SECTIONS, 'HIST_2') }));
  if (p === '/results') {
    const q = url.searchParams.get('search_query');
    searchQueries.push([q, url.searchParams.get('sp')]);
    return htmlRes(F.html({ data: searchData(q, 0) }));
  }
  if (p === '/youtubei/v1/search') {
    const [, q, pg] = (JSON.parse(req.postData() || '{}').continuation || '').split('|');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(q ? searchData(q, parseInt(pg, 10)) : {}) });
  }
  if (p === '/youtubei/v1/browse') {
    seenAuth.push(req.headers()['authorization'] || '');
    const body = JSON.parse(req.postData() || '{}');
    let json = {};
    if (body.continuation === 'SUBS_2') json = F.channelsContinuation(SUBS.slice(20), null);
    else if (body.continuation === 'HIST_2') json = F.continuationResponse(F.historyData(HISTORY_MORE).contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents, null);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
  }
  if (p === '/playlist') {
    const list = url.searchParams.get('list') || '';
    const chId = 'UC' + list.slice(4);
    // 1 チャンネルだけ再生リストが存在しない → RSS にフォールバックする
    if (!ALL_CH.has(chId) || chId === SUBS[7].id) {
      return htmlRes(F.html({ data: { alerts: [{ alertRenderer: { type: 'ERROR', text: { runs: [{ text: 'この再生リストは存在しません。' }] } } }] } }));
    }
    return htmlRes(F.html({ data: F.playlistPageData(channelVideos(chId)) }));
  }
  if (p === '/feeds/videos.xml') {
    const pl = url.searchParams.get('playlist_id');
    const chId = pl ? 'UC' + pl.slice(4) : url.searchParams.get('channel_id');
    const ch = ALL_CH.get(chId);
    if (!ch) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: 'application/xml', body: F.rssFeed({ channelId: chId, title: ch.title, videos: channelVideos(chId).map((v) => ({ ...v, views: v.views + 1 })) }) });
  }
  let m;
  if ((m = p.match(/^\/channel\/(UC[\w-]{22})\/videos$/)) && ALL_CH.has(m[1])) {
    return htmlRes(F.html({ data: F.historyData([{ header: '動画', videos: recentVideos(m[1]), lockup: true }]) }));
  }
  if (p === '/feed/subscriptions') {
    const vids = SUBS.slice(0, 12).map((c, i) => ({ ...recentVideos(c.id)[0], id: F.vid(800000 + i), title: `【新着】${c.title}の今日の動画`, published: `${i + 1} 時間前` }));
    return htmlRes(F.html({ data: F.historyData([{ header: '今日', videos: vids, lockup: true }]) }));
  }
  if (p === '/watch') {
    const id = url.searchParams.get('v');
    const n = Math.floor(parseInt(id.slice(3), 10) / 100);
    const owner = ALL_CH.get(F.cid(n)) || SUBS[0];
    const player = F.playerResponse({ id, channelId: owner.id, author: owner.title, title: `動画 ${id}`, lengthSeconds: 8 });
    const body =
      pageBody('ダミー再生ページ') +
      `<div id="movie_player" class="html5-video-player" style="position:fixed;left:24px;top:80px;width:320px;height:180px;background:#000">
         <video class="html5-main-video" src="/__test/video.webm" autoplay muted loop playsinline style="width:100%;height:100%"></video></div>
       <script>document.getElementById('movie_player').getPlayerResponse = function(){ return ${JSON.stringify(player)}; };</script>`;
    return htmlRes(F.html({ data: F.watchData(relatedFor(id)), player, body }));
  }
  if (p === '/__test/video.webm') return route.fulfill({ status: 200, contentType: 'video/webm', body: videoBuf });
  return route.fulfill({ status: 404, body: '' });
}

function routeThumb(route) {
  const id = (route.request().url().match(/\/vi\/([\w-]{11})\//) || [])[1] || 'x';
  const n = parseInt(id.slice(3), 10) || 0;
  const hue = (Math.floor(n / 100) * 47) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,62%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},70%,38%)"/></linearGradient></defs><rect width="320" height="180" fill="url(#g)"/><circle cx="160" cy="90" r="26" fill="rgba(255,255,255,.85)"/><path d="M152 76v28l22-14z" fill="hsl(${hue},60%,40%)"/></svg>`;
  return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg });
}

// 数秒の WebM をブラウザ内で作る（視聴記録のテスト用）
async function makeVideo(context) {
  const page = await context.newPage();
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 90;
    const ctx = c.getContext('2d');
    const stream = c.captureStream(15);
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.start(200);
    const t0 = performance.now();
    await new Promise((resolve) => {
      (function draw() {
        const t = performance.now() - t0;
        ctx.fillStyle = `hsl(${(t / 10) % 360},70%,50%)`;
        ctx.fillRect(0, 0, 160, 90);
        if (t < 2500) requestAnimationFrame(draw);
        else resolve();
      })();
    });
    rec.stop();
    await new Promise((r) => (rec.onstop = r));
    const buf = await new Blob(chunks, { type: 'video/webm' }).arrayBuffer();
    let s = '';
    new Uint8Array(buf).forEach((b) => (s += String.fromCharCode(b)));
    return btoa(s);
  });
  await page.close();
  return Buffer.from(b64, 'base64');
}

// ---------------------------------------------------------------- シナリオ
(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yts-profile-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 720 },
    locale: 'ja-JP',
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required'],
  });
  const step = (s) => console.log('• ' + s);
  try {
    await context.route('https://www.youtube.com/**', routeYouTube);
    await context.route('https://i.ytimg.com/**', routeThumb);
    await context.addCookies([
      { name: 'SAPISID', value: 'test-sapisid', domain: '.youtube.com', path: '/', secure: true },
      { name: '__Secure-3PAPISID', value: 'test-3p', domain: '.youtube.com', path: '/', secure: true },
    ]);
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    const extId = new URL(sw.url()).host;
    step(`拡張機能を読み込み: ${extId}`);

    // インストール直後に設定ページが開く
    let opened = null;
    for (let i = 0; i < 20 && !opened; i++) {
      opened = context.pages().find((p) => p.url().includes(`${extId}/options/options.html`));
      if (!opened) await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(opened, 'インストール時に設定ページが開く');
    videoBuf = await makeVideo(context);
    await opened.close();

    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
    });
    await page.goto('https://www.youtube.com/');
    const fab = page.locator('#yt-shuffle-host .fab');
    await fab.waitFor({ state: 'visible', timeout: 10000 });
    step('右下のサイコロボタンが表示された');

    // 初回: パネルを開くと自動で同期
    await fab.click();
    const status = page.locator('#yt-shuffle-host .status');
    await page.waitForFunction(
      () => /登録 30ch/.test(document.querySelector('#yt-shuffle-host').shadowRoot.querySelector('.status').textContent),
      null,
      { timeout: 15000 }
    );
    step('初回同期: ' + (await status.textContent()));
    assert.ok(seenAuth.length >= 2 && seenAuth.every((a) => /^SAPISIDHASH \d+_[0-9a-f]{40} SAPISID3PHASH/.test(a)), '続きの取得に認証ヘッダが付く');
    const stored = await sw.evaluate(async () => {
      const all = await chrome.storage.local.get(null);
      let watched = 0;
      for (const k of Object.keys(all)) if (k.startsWith('wv_')) watched += Object.keys(all[k]).length;
      return { subs: all.subs.channels.length, watched };
    });
    assert.equal(stored.subs, 30);
    assert.equal(stored.watched, 12, '履歴 2 ページ分（10 + 2 本）');

    // 登録チャンネル・シャッフル
    await page.locator('#yt-shuffle-host .btn.primary').click();
    await page.locator('#yt-shuffle-host .card').first().waitFor({ timeout: 20000 });
    const subsCards = await page.locator('#yt-shuffle-host .card').evaluateAll((els) =>
      els.map((e) => ({
        href: e.querySelector('a.title').href,
        title: e.querySelector('a.title').textContent,
        chips: [...e.querySelectorAll('.chip')].map((c) => c.textContent),
        meta: [...e.querySelectorAll('.meta')].map((c) => c.textContent).join(' | '),
      }))
    );
    step(`登録チャンネル・シャッフル: ${subsCards.length} 本`);
    assert.ok(subsCards.length >= 10);
    for (const c of subsCards) {
      const id = new URL(c.href).searchParams.get('v');
      const k = parseInt(id.slice(-2), 10);
      // SUBS[7] は再生リストが無く RSS にフォールバックする（RSS には再生済みの情報がない）ので対象外
      const chN = Math.floor(parseInt(id.slice(3), 10) / 100);
      if (chN !== 8) assert.notEqual(k, 0, '再生済みバー付きの動画は出ない: ' + c.title);
      assert.notEqual(k, 11, 'ショートは出ない');
      assert.ok(c.chips.length >= 1, '理由のチップがある');
      assert.match(c.meta, /回視聴/);
    }
    console.log('   例:', subsCards.slice(0, 3).map((c) => `${c.title} [${c.chips.join(', ')}] ${c.meta}`).join('\n       '));
    await page.screenshot({ path: path.join(OUT, '1-subs-light.png') });

    // スキップ → 同じ位置に別の動画が補充される
    const before = subsCards.length;
    const firstHref = subsCards[0].href;
    await page.locator('#yt-shuffle-host .card .act[data-act="skip"]').first().click();
    await page.waitForFunction(
      (href) => document.querySelector('#yt-shuffle-host').shadowRoot.querySelector('.card a.title').href !== href,
      firstHref
    );
    assert.equal(await page.locator('#yt-shuffle-host .card').count(), before, 'スキップしても補充されて本数は同じ');
    const skippedId = new URL(firstHref).searchParams.get('v');
    const skips1 = await sw.evaluate(async () => (await chrome.storage.local.get('hidden')).hidden.skips);
    assert.ok(skips1[skippedId] > Date.now() + 29 * 86400000, '30 日間スキップ');
    const hrefs1 = await page.locator('#yt-shuffle-host .card a.title').evaluateAll((els) => els.map((a) => a.href));
    assert.ok(!hrefs1.includes(firstHref));
    step(`「スキップ」で入れ替わった（${before} 本のまま）`);
    await page.screenshot({ path: path.join(OUT, '6-skip-buttons.png') });

    // 興味なし・チャンネル除外
    await page.locator('#yt-shuffle-host .card .act[data-act="hide"]').first().click();
    await page.waitForFunction(
      (href) => document.querySelector('#yt-shuffle-host').shadowRoot.querySelector('.card a.title').href !== href,
      hrefs1[0]
    );
    const chName = await page.locator('#yt-shuffle-host .card .meta a').nth(1).textContent();
    await page.locator('#yt-shuffle-host .card .act[data-act="channel"]').nth(1).click();
    await page.waitForFunction(
      (name) => ![...document.querySelector('#yt-shuffle-host').shadowRoot.querySelectorAll('.card .meta a')].some((a) => a.textContent === name),
      chName
    );
    step(`「興味なし」「チャンネル除外（${chName}）」も補充つきで動作`);

    // スクロールするとメニューがたたまれ、動画部分が広くなる
    const layout = () =>
      page.locator('#yt-shuffle-host').evaluate((host) => {
        const r = host.shadowRoot;
        const panel = r.querySelector('.panel');
        const scroller = r.querySelector('.scroller');
        const list = r.querySelector('.list').getBoundingClientRect();
        const sc = scroller.getBoundingClientRect();
        const visibleList = Math.max(0, Math.min(list.bottom, sc.bottom) - Math.max(list.top, sc.top));
        return {
          compact: panel.classList.contains('compact'),
          ratio: visibleList / panel.getBoundingClientRect().height,
          miniVisible: getComputedStyle(r.querySelector('.mini')).display !== 'none',
          footerVisible: getComputedStyle(r.querySelector('.ft')).display !== 'none',
        };
      });
    const l0 = await layout();
    assert.equal(l0.compact, false);
    assert.equal(l0.miniVisible, false);
    await page.locator('#yt-shuffle-host .scroller').evaluate((e) => e.scrollBy(0, 700));
    await page.waitForTimeout(200);
    const l1 = await layout();
    step(`スクロール前: 動画部分 ${Math.round(l0.ratio * 100)}% → スクロール後: ${Math.round(l1.ratio * 100)}%（コンパクト表示）`);
    assert.equal(l1.compact, true);
    assert.ok(l1.miniVisible && !l1.footerVisible);
    assert.ok(l1.ratio > 0.85, '動画部分がパネルの大半を占める: ' + l1.ratio);
    await page.screenshot({ path: path.join(OUT, '8-compact-scrolled.png') });
    // コンパクト表示のシャッフル
    const hrefBefore = await page.locator('#yt-shuffle-host .card a.title').first().getAttribute('href');
    await page.locator('#yt-shuffle-host .mini .mini-primary').click();
    await page.waitForFunction(() => !document.querySelector('#yt-shuffle-host').shadowRoot.querySelector('.mini-primary').disabled, null, { timeout: 30000 });
    const l2 = await layout();
    assert.equal(l2.compact, false, 'シャッフル後は一番上に戻る');
    assert.notEqual(await page.locator('#yt-shuffle-host .card a.title').first().getAttribute('href'), hrefBefore);
    // 「メニュー」ボタンで一番上へ
    await page.locator('#yt-shuffle-host .scroller').evaluate((e) => e.scrollBy(0, 700));
    await page.waitForFunction(() => document.querySelector('#yt-shuffle-host').shadowRoot.querySelector('.panel').classList.contains('compact'));
    await page.locator('#yt-shuffle-host .mini .mini-btn[title^="メニュー"]').click();
    await page.waitForFunction(() => !document.querySelector('#yt-shuffle-host').shadowRoot.querySelector('.panel').classList.contains('compact'));
    step('コンパクト表示のシャッフル・「メニュー」ボタンで一番上に戻る');
    {
      const before = await page.locator('#yt-shuffle-host .card a.title').evaluateAll((els) => els.map((a) => a.href));
      await page.locator('#yt-shuffle-host .act.replace').click();
      await page.waitForFunction(
        (href) => document.querySelector('#yt-shuffle-host').shadowRoot.querySelector('.card a.title').href !== href,
        before[0],
        { timeout: 30000 }
      );
      await page.waitForFunction(() => !document.querySelector('#yt-shuffle-host').shadowRoot.querySelector('.btn.primary').disabled, null, { timeout: 30000 });
      const after = await page.locator('#yt-shuffle-host .card a.title').evaluateAll((els) => els.map((a) => a.href));
      const overlap = after.filter((h) => before.includes(h)).length;
      assert.equal(overlap, 0, '登録チャンネルでも全部入れ替え');
      step(`登録チャンネルの全部入れ替え: ${before.length} 本 → ${after.length} 本（重なり ${overlap}）`);
    }

    // 近いチャンネル
    await page.locator('#yt-shuffle-host .tab[data-mode="similar"]').click();
    await page.locator('#yt-shuffle-host .btn.primary').click();
    await page.locator('#yt-shuffle-host .chan').first().waitFor({ timeout: 30000 });
    const similar = await page.locator('#yt-shuffle-host').evaluate((host) => ({
      chans: [...host.shadowRoot.querySelectorAll('.chan')].map((a) => ({ name: a.textContent, href: a.href })),
      cards: [...host.shadowRoot.querySelectorAll('.card')].map((e) => ({
        title: e.querySelector('a.title').textContent,
        channel: e.querySelector('.meta a').textContent,
        reason: e.querySelector('.chip').textContent,
      })),
    }));
    step(`近いチャンネル: ${similar.chans.length} チャンネル / ${similar.cards.length} 本`);
    console.log('   チャンネル:', similar.chans.map((c) => c.name + (/channel/.test(c.href) ? '' : '(ID不明)')).join(', '));
    assert.ok(similar.cards.length >= 5);
    const subNames = new Set(SUBS.map((s) => s.title));
    for (const c of similar.cards) {
      assert.ok(!subNames.has(c.channel), '登録済みチャンネルは出ない: ' + c.channel);
      assert.match(c.reason, /に近い/);
    }
    assert.equal(new Set(similar.chans.map((c) => c.name)).size, similar.chans.length, 'チャンネルが重複しない');
    assert.ok(similar.chans.slice(0, 6).every((c) => /\/channel\/UC/.test(c.href)), '上位チャンネルはリンクなしでも ID を解決');
    await page.screenshot({ path: path.join(OUT, '2-similar-light.png') });

    // ---- ジャンル別人気 ----
    const shadowText = (sel) => page.locator('#yt-shuffle-host').evaluate((h, s) => h.shadowRoot.querySelector(s).textContent, sel);
    const waitIdle = () =>
      page.waitForFunction(() => !document.querySelector('#yt-shuffle-host').shadowRoot.querySelector('.btn.primary').disabled, null, { timeout: 30000 });
    const cardInfo = () =>
      page.locator('#yt-shuffle-host .card').evaluateAll((els) =>
        els.map((e) => ({
          href: e.querySelector('a.title').href,
          title: e.querySelector('a.title').textContent,
          channel: e.querySelector('.meta a').textContent,
          views: e.querySelectorAll('.meta')[1].textContent,
          chips: [...e.querySelectorAll('.chip')].map((c) => c.textContent),
        }))
      );
    await page.locator('#yt-shuffle-host .tab[data-mode="trend"]').click();
    assert.ok(await page.locator('#yt-shuffle-host .genre-row').isVisible(), 'ジャンルの行が出る');
    assert.ok(!(await page.locator('#yt-shuffle-host .fgroup').first().isVisible()), '投稿日の選択は隠れる');
    assert.match(await shadowText('.list'), /ジャンルを選ぶ/);
    await page.locator('#yt-shuffle-host .genre[data-genre="game"] .genre-btn').click();
    await page.waitForFunction(() => /ゲーム/.test(document.querySelector('#yt-shuffle-host').shadowRoot.querySelector('.info').textContent), null, { timeout: 30000 });
    await waitIdle();
    const t1 = await cardInfo();
    step(`ジャンル別人気「ゲーム」: ${t1.length} 本`);
    console.log('   例:', t1.slice(0, 3).map((c) => `${c.title} ${c.channel} ${c.views} [${c.chips.join(', ')}]`).join('\n       '));
    assert.ok(t1.length >= 10);
    assert.deepEqual(searchQueries[searchQueries.length - 1], ['ゲーム実況', 'CAMSBAgDEAE='], '今週・視聴回数順で検索');
    for (const c of t1) {
      assert.match(c.chips[0], /ゲーム・今週の人気/);
      assert.ok(!/No\.(10|20|30)$/.test(c.title), '1000 回未満の動画は出ない: ' + c.title);
    }
    assert.ok(await page.locator('#yt-shuffle-host .genre[data-genre="game"]').evaluate((e) => e.classList.contains('on')));
    assert.ok(!/null|undefined/.test(await shadowText('.info')), '情報欄に null などが出ない');
    await page.screenshot({ path: path.join(OUT, '9-trend-game.png') });

    // 全部入れ替え
    await page.locator('#yt-shuffle-host .act.replace').click();
    await page.waitForFunction(
      (href) => document.querySelector('#yt-shuffle-host').shadowRoot.querySelector('.card a.title').href !== href,
      t1[0].href,
      { timeout: 30000 }
    );
    await waitIdle();
    const t2 = await cardInfo();
    const t1ids = new Set(t1.map((c) => c.href));
    assert.ok(t2.length > 0 && t2.every((c) => !t1ids.has(c.href)), '全部入れ替えで全て別の動画');
    step(`全部入れ替え: ${t1.length} 本 → 別の ${t2.length} 本（重なり 0）`);

    // 再生回数の条件（100万回以上）
    await page.locator('#yt-shuffle-host .fgroup select.sel').last().selectOption('1000000');
    await page.waitForFunction(() => document.querySelector('#yt-shuffle-host').shadowRoot.querySelector('.btn.primary').disabled, null, { timeout: 5000 }).catch(() => {});
    await waitIdle();
    const t3 = await cardInfo();
    for (const c of t3) assert.ok(/(\d+(\.\d+)?)万/.test(c.views) && parseFloat(c.views) >= 100, '100万回以上: ' + c.views);
    step(`再生回数「100万回以上」: ${t3.length} 本（${t3.map((c) => c.views.split(' ')[0]).slice(0, 4).join(', ')}…）`);
    await page.locator('#yt-shuffle-host .fgroup select.sel').last().selectOption('1000');
    await page.waitForFunction(() => document.querySelector('#yt-shuffle-host').shadowRoot.querySelector('.btn.primary').disabled, null, { timeout: 5000 }).catch(() => {});
    await waitIdle();

    // 自分でキーワード（ジャンル）を追加
    await page.locator('#yt-shuffle-host .genre-input').fill('釣り');
    await page.locator('#yt-shuffle-host .genre-input').press('Enter');
    await page.waitForFunction(() => /釣り/.test(document.querySelector('#yt-shuffle-host').shadowRoot.querySelector('.info').textContent), null, { timeout: 30000 });
    await waitIdle();
    const t4 = await cardInfo();
    assert.ok(t4.length > 0 && t4.every((c) => c.title.startsWith('【釣り】')));
    assert.ok(await page.locator('#yt-shuffle-host .genre[data-genre="c:釣り"]').isVisible(), '追加したキーワードがチップになる');
    step(`キーワード「釣り」を追加: ${t4.length} 本`);
    await page.screenshot({ path: path.join(OUT, '10-trend-custom.png') });
    // 期間（今月）
    await page.locator('#yt-shuffle-host .fgroup:not([hidden]) select.sel').first().selectOption('month');
    await page.waitForFunction(() => document.querySelector('#yt-shuffle-host').shadowRoot.querySelector('.btn.primary').disabled, null, { timeout: 5000 }).catch(() => {});
    await waitIdle();
    assert.deepEqual(searchQueries[searchQueries.length - 1], ['釣り', 'CAMSBAgEEAE='], '今月・視聴回数順で検索');
    assert.match(await shadowText('.info'), /今月の人気「釣り」/);
    step('期間「今月」でも検索できた');
    await page.locator('#yt-shuffle-host .genre[data-genre="c:釣り"] .genre-del').click();
    await page.waitForFunction(() => !document.querySelector('#yt-shuffle-host').shadowRoot.querySelector('.genre[data-genre="c:釣り"]'));
    await page.locator('#yt-shuffle-host .fgroup:not([hidden]) select.sel').first().selectOption('week');
    await page.waitForFunction(() => document.querySelector('#yt-shuffle-host').shadowRoot.querySelector('.btn.primary').disabled, null, { timeout: 5000 }).catch(() => {});
    await waitIdle();

    // ダークテーマ
    // 投稿日で絞り込む（1 週間以内）→ 自動で再シャッフル
    await page.locator('#yt-shuffle-host .tab[data-mode="subs"]').click();
    await page.locator('#yt-shuffle-host select.sel').first().selectOption('1w');
    await page.waitForFunction(
      () => /1週間以内/.test(document.querySelector('#yt-shuffle-host').shadowRoot.querySelector('.info').textContent),
      null,
      { timeout: 30000 }
    );
    await page.waitForFunction(() => !document.querySelector('#yt-shuffle-host').shadowRoot.querySelector('.btn.primary').disabled);
    const periodCards = await page.locator('#yt-shuffle-host .card').evaluateAll((els) =>
      els.map((e) => ({ title: e.querySelector('a.title').textContent, meta: [...e.querySelectorAll('.meta')].map((c) => c.textContent).join(' | ') }))
    );
    step(`投稿日「1週間以内」: ${periodCards.length} 本`);
    console.log('   例:', periodCards.slice(0, 3).map((c) => `${c.title} ${c.meta}`).join('\n       '));
    assert.ok(periodCards.length >= 5);
    for (const c of periodCards) assert.match(c.meta, /(時間前|[1-7] 日前)/, '1 週間以内の動画だけ: ' + c.meta);
    assert.ok(periodCards.some((c) => /【新着】/.test(c.title)), '新着フィードの動画も入る');

    // カスタム期間（12 時間以内）
    await page.locator('#yt-shuffle-host select.sel').first().selectOption('custom');
    await page.locator('#yt-shuffle-host .custom input.num').fill('12');
    await page.locator('#yt-shuffle-host .custom select.unit').selectOption('hour');
    await page.waitForFunction(
      () => /12時間以内/.test(document.querySelector('#yt-shuffle-host').shadowRoot.querySelector('.info').textContent),
      null,
      { timeout: 30000 }
    );
    await page.waitForFunction(() => !document.querySelector('#yt-shuffle-host').shadowRoot.querySelector('.btn.primary').disabled);
    const hourMetas = await page.locator('#yt-shuffle-host .card .meta:nth-of-type(2)').allTextContents();
    step(`投稿日「12時間以内」（カスタム）: ${hourMetas.length} 本`);
    assert.ok(hourMetas.length > 0);
    for (const t of hourMetas) {
      const h = parseInt((t.match(/(\d+) 時間前/) || [])[1], 10);
      assert.ok(h <= 12, t);
    }

    // パネルの幅: 既定 720px → ボタンで 960px、広いときはグリッド表示
    const width0 = await page.locator('#yt-shuffle-host .panel').evaluate((e) => e.getBoundingClientRect().width);
    assert.equal(Math.round(width0), 720);
    await page.locator('#yt-shuffle-host .icon-btn[title^="パネルの幅"]').click();
    const width1 = await page.locator('#yt-shuffle-host .panel').evaluate((e) => e.getBoundingClientRect().width);
    assert.equal(Math.round(width1), 960);
    const cols = await page.locator('#yt-shuffle-host .grid').evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length);
    assert.ok(cols >= 3, 'グリッドが複数列: ' + cols);
    step(`パネルの幅: ${Math.round(width0)}px → ${Math.round(width1)}px（${cols} 列）`);
    await page.screenshot({ path: path.join(OUT, '5-period-wide.png') });
    // ドラッグで幅を変更（左端を 500px の位置へ）
    const box = await page.locator('#yt-shuffle-host .resizer').boundingBox();
    await page.mouse.move(box.x + box.width / 2, 400);
    await page.mouse.down();
    await page.mouse.move(500, 400, { steps: 5 });
    await page.mouse.up();
    const width2 = await page.locator('#yt-shuffle-host .panel').evaluate((e) => e.getBoundingClientRect().width);
    assert.ok(Math.abs(width2 - 780) <= 6, 'ドラッグで幅が変わる: ' + width2);
    const savedW = await sw.evaluate(async () => (await chrome.storage.local.get('settings')).settings.panelWidth);
    assert.ok(Math.abs(savedW - 780) <= 6, '幅が保存される: ' + savedW);
    step(`ドラッグで幅を変更: ${Math.round(width2)}px（保存: ${savedW}px）`);

    // 期間を元に戻す
    await page.locator('#yt-shuffle-host select.sel').first().selectOption('all');
    await page.waitForFunction(
      () => !/投稿日/.test(document.querySelector('#yt-shuffle-host').shadowRoot.querySelector('.info').textContent),
      null,
      { timeout: 30000 }
    );
    await page.waitForFunction(() => !document.querySelector('#yt-shuffle-host').shadowRoot.querySelector('.btn.primary').disabled);
    await page.locator('#yt-shuffle-host .tab[data-mode="similar"]').click();

    await page.evaluate(() => document.documentElement.setAttribute('dark', ''));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, '3-similar-dark.png') });
    await page.evaluate(() => document.documentElement.removeAttribute('dark'));

    // ツールバーアイコン相当: Service Worker からトグル
    await sw.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
      await chrome.tabs.sendMessage(tab.id, { type: 'yts:toggle' });
    });
    await page.waitForFunction(() => !document.querySelector('#yt-shuffle-host').shadowRoot.querySelector('.panel').classList.contains('open'));
    step('ツールバー（Service Worker 経由）でパネルを閉じられた');

    // おまかせ 1 本 → 再生ページへ
    await fab.click();
    await page.locator('#yt-shuffle-host .tab[data-mode="subs"]').click();
    await Promise.all([page.waitForURL(/\/watch\?v=/, { timeout: 20000 }), page.locator('#yt-shuffle-host .btn', { hasText: 'おまかせ1本' }).click()]);
    const watchedId = new URL(page.url()).searchParams.get('v');
    step('おまかせ1本 → ' + page.url());

    // 視聴の自動記録（8 秒の動画を 4 秒以上再生で記録）
    await page.waitForFunction(() => {
      const v = document.querySelector('video');
      return v && !v.paused && v.currentTime > 0;
    }, null, { timeout: 10000 });
    const rec = await (async () => {
      for (let i = 0; i < 20; i++) {
        const r = await sw.evaluate(async (id) => {
          const k = 'wv_' + id[0];
          const d = await chrome.storage.local.get(k);
          return d[k] && d[k][id];
        }, watchedId);
        if (r && r.t > 0) return r;
        await page.waitForTimeout(1000);
      }
      return null;
    })();
    assert.ok(rec, '再生した動画が記録される');
    assert.match(rec.c || '', /^UC/, 'チャンネル ID も記録される（page-hook 経由）');
    step(`視聴を自動記録: ${watchedId} → ${JSON.stringify(rec)}`);

    // 再生ページの「スキップして次のおすすめへ」
    const skipBar = page.locator('#yt-shuffle-host .skipbar');
    await skipBar.waitFor({ state: 'visible', timeout: 5000 });
    await page.screenshot({ path: path.join(OUT, '7-watch-skipbar.png') });
    await Promise.all([page.waitForURL((u) => u.searchParams.get('v') !== watchedId, { timeout: 20000 }), skipBar.click()]);
    const nextId = new URL(page.url()).searchParams.get('v');
    const skips2 = await sw.evaluate(async () => (await chrome.storage.local.get('hidden')).hidden.skips);
    assert.ok(skips2[watchedId] > Date.now(), '再生していた動画がスキップ扱いになる');
    step(`スキップして次へ: ${watchedId} → ${nextId}`);

    // ショートカット（Alt+Shift+N）相当: Service Worker からスキップ指示
    await skipBar.waitFor({ state: 'visible', timeout: 5000 });
    await Promise.all([
      page.waitForURL((u) => u.searchParams.get('v') !== nextId, { timeout: 20000 }),
      sw.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
        await chrome.tabs.sendMessage(tab.id, { type: 'yts:skip' });
      }),
    ]);
    step(`ショートカット相当でも次へ: ${nextId} → ${new URL(page.url()).searchParams.get('v')}`);
    await page.goto(`https://www.youtube.com/watch?v=${F.vid(3100)}`);
    await page.waitForTimeout(1500);
    assert.ok(await skipBar.isHidden(), 'おすすめ以外の動画ではスキップボタンを出さない');

    // 設定ページ + Takeout 取り込み
    const opt = await context.newPage();
    await opt.goto(`chrome-extension://${extId}/options/options.html`);
    const histFile = path.join(OUT, 'watch-history.json');
    fs.writeFileSync(
      histFile,
      JSON.stringify(
        channelVideos(SUBS[20].id).slice(1, 6).map((v) => ({
          header: 'YouTube',
          title: `${v.title} を視聴しました`,
          titleUrl: `https://www.youtube.com/watch?v=${v.id}`,
          subtitles: [{ name: v.channelName, url: `https://www.youtube.com/channel/${v.channelId}` }],
          time: '2023-01-02T03:04:05.000Z',
        }))
      )
    );
    await opt.setInputFiles('#import-history', histFile);
    await opt.waitForFunction(() => /視聴履歴 5 件を読み込み、新しく [45] 本/.test(document.querySelector('#import-result').textContent), null, { timeout: 10000 });
    step('Takeout 取り込み: ' + (await opt.textContent('#import-result')));
    await opt.fill('input[name="resultCount"]', '12');
    await opt.waitForFunction(() => document.querySelector('#saved').textContent.includes('保存'));
    const saved = await sw.evaluate(async () => (await chrome.storage.local.get('settings')).settings.resultCount);
    assert.equal(saved, 12);
    await opt.screenshot({ path: path.join(OUT, '4-options.png'), fullPage: true });

    if (errors.length) console.log('   ページのエラー:', errors);
    assert.deepEqual(errors, [], 'ページ上でエラーが出ていない');
    console.log(`\nE2E OK（スクリーンショット: ${OUT}）`);
  } catch (e) {
    console.error('E2E FAILED:', e);
    for (const p of context.pages()) {
      try {
        await p.screenshot({ path: path.join(OUT, `fail-${Date.now()}.png`) });
      } catch (_) {
        /* ignore */
      }
    }
    process.exitCode = 1;
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})();
