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
  if (p === '/' || p === '/results') return htmlRes(F.html({ data: {}, body: pageBody('テスト用ダミーページ') }));
  if (p === '/feed/channels') return htmlRes(F.html({ data: F.feedChannelsData(SUBS.slice(0, 20), 'SUBS_2') }));
  if (p === '/feed/history') return htmlRes(F.html({ data: F.historyData(HISTORY_SECTIONS, 'HIST_2') }));
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
    viewport: { width: 1280, height: 820 },
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
      assert.notEqual(k, 0, '再生済みバー付きの動画は出ない: ' + c.title);
      assert.notEqual(k, 11, 'ショートは出ない');
      assert.ok(c.chips.length >= 1, '理由のチップがある');
      assert.match(c.meta, /回視聴/);
    }
    console.log('   例:', subsCards.slice(0, 3).map((c) => `${c.title} [${c.chips.join(', ')}] ${c.meta}`).join('\n       '));
    await page.screenshot({ path: path.join(OUT, '1-subs-light.png') });

    // 非表示ボタン
    const before = subsCards.length;
    await page.locator('#yt-shuffle-host .card').first().hover();
    await page.locator('#yt-shuffle-host .card .acts button').first().click();
    await page.waitForFunction((n) => document.querySelector('#yt-shuffle-host').shadowRoot.querySelectorAll('.card').length === n - 1, before);
    step('「興味なし」で 1 本消えた');

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

    // ダークテーマ
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
