// YouTube の画面右側に出すパネル UI と、右下の 🎲 ボタン
(function (root) {
  'use strict';
  if (window.top !== window.self) return;
  const YTS = root.YTS;
  const { store, engine, recommend: R, util: U } = YTS;
  const ORIGIN = 'https://www.youtube.com';

  // ---------- DOM ヘルパー（YouTube は Trusted Types 必須なので innerHTML は使わない） ----------
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : String(c));
    }
    return el;
  }

  const SVGNS = 'http://www.w3.org/2000/svg';
  function svg(size, ...kids) {
    const s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', size);
    s.setAttribute('height', size);
    s.setAttribute('aria-hidden', 'true');
    kids.forEach((k) => s.append(k));
    return s;
  }
  function svgEl(tag, attrs) {
    const e = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  }
  const PATHS = {
    close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    refresh:
      'M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z',
    play: 'M8 5v14l11-7z',
    gear:
      'M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.47.47 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.47.47 0 0 0 .12.61l2.03 1.58a7.3 7.3 0 0 0 0 1.88l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.48.48 0 0 0-.12-.61zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z',
    block:
      'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM4 12a8 8 0 0 1 12.9-6.31L5.69 16.9A7.9 7.9 0 0 1 4 12zm8 8a7.9 7.9 0 0 1-4.9-1.69L18.31 7.1A8 8 0 0 1 12 20z',
    compass:
      'M12 10.9a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2zM12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm2.19 12.19L6 18l3.81-8.19L18 6z',
    width: 'M8 7l-5 5 5 5v-4h8v4l5-5-5-5v4H8z',
    skip: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
    up: 'M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z',
    subs:
      'M10 18v-6l5 3-5 3zm7-15H7v1h10V3zm3 3H4v1h16V6zm2 3H2v12h20V9zM3 10h18v10H3V10z',
  };
  function icon(name, size = 20) {
    return svg(size, svgEl('path', { d: PATHS[name], fill: 'currentColor' }));
  }
  function dice(size = 22, dot = '#fff') {
    const dots = [
      [8, 8],
      [16, 8],
      [12, 12],
      [8, 16],
      [16, 16],
    ].map(([cx, cy]) => svgEl('circle', { cx, cy, r: 1.7, fill: dot }));
    return svg(size, svgEl('rect', { x: 3, y: 3, width: 18, height: 18, rx: 4.5, fill: 'currentColor' }), ...dots);
  }

  const watchUrl = (id) => `${ORIGIN}/watch?v=${encodeURIComponent(id)}`;
  function channelUrl(r) {
    if (r.channelId) return `${ORIGIN}/channel/${r.channelId}`;
    if (r.handle) return `${ORIGIN}/${r.handle}`;
    return `${ORIGIN}/results?search_query=${encodeURIComponent(r.channelName || r.name || '')}`;
  }
  function relTime(p) {
    if (!p) return '';
    if (!/^\d{4}-\d{2}-\d{2}T/.test(p)) return p;
    const days = Math.floor((Date.now() - Date.parse(p)) / U.DAY);
    if (!(days >= 0)) return '';
    if (days < 1) return '今日';
    if (days < 30) return `${days}日前`;
    if (days < 365) return `${Math.floor(days / 30)}か月前`;
    return `${Math.floor(days / 365)}年前`;
  }

  // ---------- ホスト要素 ----------
  const host = h('div', { id: 'yt-shuffle-host' });
  const shadow = host.attachShadow({ mode: 'open' });
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(YTS.PANEL_CSS);
    shadow.adoptedStyleSheets = [sheet];
  } catch (e) {
    shadow.append(h('style', null, YTS.PANEL_CSS));
  }

  const MODES = {
    subs: {
      label: '登録チャンネル',
      icon: 'subs',
      desc: '登録しているのにあまり見ていないチャンネルを中心に、人気があってまだ見ていない動画を選びます。',
    },
    similar: {
      label: '近いチャンネル',
      icon: 'compass',
      desc: 'よく見るチャンネルの関連動画から、まだ登録していない近いチャンネルを探し、その人気動画を選びます。',
    },
  };

  const state = { open: false, mode: 'subs', busy: false, data: {}, seen: new Set() };
  const els = {};

  els.fab = h('button', { class: 'fab', title: 'YT Shuffle を開く（Alt+Shift+Y）', onclick: () => toggle() }, dice(28, '#ff0033'));
  els.skipBar = h(
    'button',
    { class: 'skipbar', hidden: true, title: 'この動画をスキップして、次のおすすめを再生（Alt+Shift+N）', onclick: () => skipAndNext() },
    icon('skip', 20),
    'スキップして次のおすすめへ'
  );

  els.tabs = Object.entries(MODES).map(([mode, m]) =>
    h('button', { class: 'tab', role: 'tab', 'data-mode': mode, onclick: () => setMode(mode) }, icon(m.icon, 18), m.label)
  );
  els.desc = h('p', { class: 'desc' });
  els.shuffleBtn = h('button', { class: 'btn primary', onclick: () => runShuffle() }, dice(20, '#ff0033'), 'シャッフル');
  els.luckyBtn = h('button', { class: 'btn', title: '候補からスコアの高い 1 本をすぐ再生', onclick: () => runLucky() }, icon('play', 18), 'おまかせ1本');
  els.syncBtn = h('button', { class: 'btn ghost', title: '登録チャンネルと視聴履歴を読み込み直す', onclick: () => runSync() }, icon('refresh', 18), '同期');
  els.status = h('div', { class: 'status' });

  // 投稿日の期間フィルタ
  const PERIOD_PRESETS = [
    ['all', 'すべての期間', 0, 'month'],
    ['24h', '24時間以内', 24, 'hour'],
    ['3d', '3日以内', 3, 'day'],
    ['1w', '1週間以内', 1, 'week'],
    ['1m', '1か月以内', 1, 'month'],
    ['3m', '3か月以内', 3, 'month'],
    ['6m', '半年以内', 6, 'month'],
    ['1y', '1年以内', 1, 'year'],
    ['3y', '3年以内', 3, 'year'],
    ['custom', '期間を指定…', null, null],
  ];
  els.periodSel = h(
    'select',
    { class: 'sel', title: '投稿日で絞り込む', onchange: onPresetChange },
    PERIOD_PRESETS.map(([key, label]) => h('option', { value: key }, label))
  );
  els.periodNum = h('input', { class: 'num', type: 'number', min: 1, max: 999, step: 1, title: '数値', onchange: onCustomChange });
  els.periodUnit = h(
    'select',
    { class: 'sel unit', title: '単位', onchange: onCustomChange },
    U.PERIOD_UNITS.map(([key, label]) => h('option', { value: key }, label))
  );
  els.periodCustom = h('span', { class: 'custom' }, els.periodNum, els.periodUnit, h('span', { class: 'suffix' }, '以内'));
  els.filters = h('div', { class: 'filters' }, h('span', { class: 'flabel' }, '投稿日'), els.periodSel, els.periodCustom);
  els.bar = h('div', { class: 'bar indet' }, h('i'));
  els.ptext = h('span', { class: 'ptext' });
  els.progress = h('div', { class: 'progress' }, els.bar, els.ptext);
  els.error = h('div', { class: 'error', role: 'alert' });
  els.info = h('div', { class: 'info' });
  els.found = h('div', { class: 'found' });
  els.list = h('div', { class: 'list' });

  // スクロールしてメニューが隠れたときにヘッダーに出す小さな操作ボタン
  els.miniShuffle = h('button', { class: 'mini-btn mini-primary', title: 'シャッフル', onclick: () => runShuffle() }, dice(18, '#ff0033'), 'シャッフル');
  els.miniLucky = h('button', { class: 'mini-btn', title: 'おまかせ1本', onclick: () => runLucky() }, icon('play', 16), 'おまかせ');
  els.miniTabs = Object.entries(MODES).map(([mode, m]) =>
    h('button', { class: 'seg', 'data-mode': mode, title: m.label, onclick: () => setMode(mode) }, m.label.replace('チャンネル', ''))
  );
  els.mini = h(
    'div',
    { class: 'mini' },
    els.miniShuffle,
    els.miniLucky,
    h('div', { class: 'segs' }, els.miniTabs),
    h('button', { class: 'mini-btn', title: 'メニューを表示（一番上へ）', onclick: () => scrollToTop() }, icon('up', 18), 'メニュー')
  );
  els.diag = h('pre', { class: 'diag' });

  els.resizer = h('div', { class: 'resizer', title: 'ドラッグで幅を変更' });
  els.panel = h(
    'aside',
    { class: 'panel', role: 'dialog', 'aria-label': 'YT Shuffle' },
    els.resizer,
    h(
      'header',
      { class: 'hd' },
      h('div', { class: 'brand' }, dice(24), h('span', { class: 'brand-name' }, 'YT Shuffle')),
      els.mini,
      h('div', { class: 'spacer' }),
      h('button', { class: 'icon-btn', title: 'パネルの幅を切り替え（左端のドラッグでも変更できます）', onclick: cycleWidth }, icon('width')),
      h('button', { class: 'icon-btn', title: '設定・インポート', onclick: openOptions }, icon('gear')),
      h('button', { class: 'icon-btn', title: '閉じる（Esc）', onclick: () => close() }, icon('close'))
    ),
    els.progress,
    // メニュー部分も動画と一緒にスクロールさせ、動画の表示領域を広く取る
    (els.scroller = h(
      'div',
      { class: 'scroller' },
      h(
        'div',
        { class: 'top' },
        h('nav', { class: 'tabs', role: 'tablist' }, els.tabs),
        els.desc,
        (els.actions = h('div', { class: 'actions' }, els.shuffleBtn, els.luckyBtn, els.syncBtn)),
        els.filters,
        els.status,
        els.error,
        els.info,
        els.found
      ),
      els.list,
      els.diag
    )),
    h(
      'footer',
      { class: 'ft' },
      h('button', { class: 'link', onclick: runDiagnose }, '動作診断'),
      h('button', { class: 'link', onclick: openOptions }, '設定・インポート'),
      h('div', { class: 'spacer' }),
      h('span', null, 'Alt+Shift+Y で開閉')
    )
  );
  // メニューのボタン行が見えなくなったらコンパクト表示（ヘッダーに小さなボタン・フッターを隠す）
  function updateCompact() {
    const threshold = els.actions.offsetTop + els.actions.offsetHeight;
    els.panel.classList.toggle('compact', els.scroller.scrollTop > threshold);
  }
  els.scroller.addEventListener('scroll', updateCompact, { passive: true });
  function scrollToTop() {
    els.scroller.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // パネル内のキー入力が YouTube のショートカット（k, j, f など）に渡らないようにする
  els.panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') e.stopPropagation();
  });

  shadow.append(els.fab, els.skipBar, els.panel);
  document.documentElement.append(host);

  // ---------- 表示状態 ----------
  function syncTheme() {
    host.toggleAttribute('dark', document.documentElement.hasAttribute('dark'));
  }
  new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['dark'] });
  syncTheme();

  let showFab = true;
  let settingsCache = store.DEFAULT_SETTINGS;
  let skipBarFor = null; // { id, mode }: 再生中の動画がどのタブのおすすめか
  function updateFab() {
    els.fab.hidden = !showFab || state.open || !!document.fullscreenElement;
    els.skipBar.hidden = !skipBarFor || state.open || !!document.fullscreenElement;
  }
  function applySettings(s) {
    settingsCache = s;
    showFab = s.showFab !== false;
    updateFab();
    setPanelWidth(s.panelWidth, false);
    renderPeriod(s);
  }
  store.getSettings().then(applySettings);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) {
      applySettings(Object.assign({}, store.DEFAULT_SETTINGS, changes.settings.newValue || {}));
    }
  });

  // ---------- パネルの幅 ----------
  const MIN_WIDTH = 360;
  const WIDTH_STEPS = [480, 720, 960, 1280];
  let panelWidth = store.DEFAULT_SETTINGS.panelWidth;
  function setPanelWidth(w, save) {
    panelWidth = Math.round(U.clamp(Number(w) || store.DEFAULT_SETTINGS.panelWidth, MIN_WIDTH, 4000));
    els.panel.style.width = Math.min(panelWidth, window.innerWidth) + 'px';
    if (save) store.saveSettings({ panelWidth });
  }
  function cycleWidth() {
    const max = window.innerWidth;
    const cur = Math.min(panelWidth, max);
    const next = WIDTH_STEPS.find((x) => x > cur + 10 && x <= max) || (cur < max - 10 ? max : WIDTH_STEPS[0]);
    setPanelWidth(next, true);
  }
  window.addEventListener('resize', () => setPanelWidth(panelWidth, false));
  els.resizer.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    els.resizer.setPointerCapture(e.pointerId);
    els.panel.classList.add('resizing');
    const move = (ev) => setPanelWidth(U.clamp(window.innerWidth - ev.clientX, MIN_WIDTH, window.innerWidth), false);
    const up = () => {
      els.resizer.removeEventListener('pointermove', move);
      els.resizer.removeEventListener('pointerup', up);
      els.resizer.removeEventListener('pointercancel', up);
      els.panel.classList.remove('resizing');
      store.saveSettings({ panelWidth });
    };
    els.resizer.addEventListener('pointermove', move);
    els.resizer.addEventListener('pointerup', up);
    els.resizer.addEventListener('pointercancel', up);
  });

  // ---------- 期間フィルタ ----------
  let customMode = false;
  function renderPeriod(s) {
    const v = Number(s.periodValue) || 0;
    const preset = PERIOD_PRESETS.find(([, , pv, pu]) => pv === 0 ? v === 0 : pv === v && pu === s.periodUnit);
    const key = customMode && v > 0 ? 'custom' : preset ? preset[0] : 'custom';
    els.periodSel.value = key;
    els.periodCustom.hidden = key !== 'custom';
    if (els.periodNum !== shadow.activeElement) els.periodNum.value = v > 0 ? v : 2;
    els.periodUnit.value = s.periodUnit || 'week';
  }
  async function onPresetChange() {
    const p = PERIOD_PRESETS.find((x) => x[0] === els.periodSel.value);
    if (p[0] === 'custom') {
      customMode = true;
      els.periodCustom.hidden = false;
      await onCustomChange();
      els.periodNum.focus();
      return;
    }
    customMode = false;
    await store.saveSettings({ periodValue: p[2], periodUnit: p[3] });
    reshuffleForFilter();
  }
  async function onCustomChange() {
    const v = Math.round(U.clamp(Number(els.periodNum.value) || 1, 1, 999));
    els.periodNum.value = v;
    await store.saveSettings({ periodValue: v, periodUnit: els.periodUnit.value });
    reshuffleForFilter();
  }
  // 期間を変えたら、今のタブをシャッフルし直す
  let filterTimer = null;
  function reshuffleForFilter() {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
      if (state.open && !state.busy) runShuffle();
    }, 400);
  }
  document.addEventListener('fullscreenchange', updateFab);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.open) close();
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'yts:skip') {
      skipAndNext();
      sendResponse({ ok: true });
    }
    if (msg && msg.type === 'yts:toggle') {
      if (msg.open) open();
      else toggle();
      sendResponse({ ok: true });
    }
  });

  function openOptions() {
    chrome.runtime.sendMessage({ type: 'yts:openOptions' });
  }

  async function open() {
    state.open = true;
    els.panel.classList.add('open');
    updateFab();
    setMode(state.mode);
    await refreshStatus();
    const subs = await store.getSubs();
    if (!subs.channels.length && !state.busy) {
      showEmpty('初回セットアップ中です。登録チャンネルと視聴履歴を読み込んでいます…');
      await runSync(false);
    }
  }
  function close() {
    state.open = false;
    els.panel.classList.remove('open');
    updateFab();
  }
  function toggle() {
    state.open ? close() : open();
  }

  async function setMode(mode) {
    state.mode = mode;
    els.tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.mode === mode)));
    els.miniTabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.mode === mode)));
    els.desc.textContent = MODES[mode].desc;
    if (!state.data[mode]) state.data[mode] = await store.getLast(mode);
    state.seen = new Set((await store.loadWatched()).keys());
    renderResults();
  }

  async function refreshStatus() {
    const s = await store.summary();
    const parts = [
      `登録 ${s.subs.toLocaleString()}ch${s.subsSource === 'takeout' ? '（Takeout）' : ''}`,
      `視聴済み ${s.watched.toLocaleString()}本`,
      `同期 ${U.formatAgo(Math.max(s.subsUpdatedAt, s.historySyncedAt))}`,
    ];
    els.status.textContent = parts.join(' ・ ');
  }

  function setBusy(b) {
    state.busy = b;
    [els.shuffleBtn, els.luckyBtn, els.syncBtn, els.miniShuffle, els.miniLucky].forEach((x) => (x.disabled = b));
    els.progress.classList.toggle('on', b);
    if (b) setProgress({ text: '準備中…' });
  }
  function setProgress(p) {
    els.ptext.textContent = p.text || '';
    const det = p.total > 0;
    els.bar.classList.toggle('indet', !det);
    els.bar.firstChild.style.width = det ? `${Math.round((p.done / p.total) * 100)}%` : '';
  }

  const ERRORS = {
    NOT_LOGGED_IN:
      'YouTube にログインしていないようです。ログインしてからもう一度お試しください。（設定画面から Google Takeout の登録チャンネルを取り込んで使うこともできます）',
    NO_SUBS: '登録チャンネルが見つかりませんでした。「同期」を押すか、設定画面から Google Takeout の subscriptions.csv を取り込んでください。',
  };
  function showError(e) {
    const msg = (e && (ERRORS[e.code] || ERRORS[e.message])) || `エラーが発生しました: ${(e && e.message) || e}`;
    els.error.textContent = msg;
    els.error.classList.add('on');
    scrollToTop();
  }
  function clearError() {
    els.error.classList.remove('on');
  }

  // ---------- 操作 ----------
  async function ensureSynced() {
    try {
      await engine.sync({ force: false, onProgress: setProgress });
    } catch (e) {
      const subs = await store.getSubs();
      if (e.code === 'NOT_LOGGED_IN' && subs.channels.length) return; // 取り込み済みデータで続行
      throw e;
    }
  }

  async function runShuffle() {
    if (state.busy) return null;
    const mode = state.mode;
    setBusy(true);
    clearError();
    try {
      await ensureSynced();
      const out =
        mode === 'subs'
          ? await engine.shuffleSubscribed({ onProgress: setProgress })
          : await engine.discoverSimilar({ onProgress: setProgress });
      state.data[mode] = out;
      state.seen = new Set((await store.loadWatched()).keys());
      if (state.mode === mode) renderResults();
      return out;
    } catch (e) {
      showError(e);
      return null;
    } finally {
      setBusy(false);
      refreshStatus();
    }
  }

  async function runLucky() {
    let data = state.data[state.mode];
    const cur = currentWatchId();
    const fresh = (d) => d && d.results && d.results.some((r) => r.id !== cur && !state.seen.has(r.id)) && Date.now() - d.at < 6 * 3600e3;
    if (!fresh(data)) data = await runShuffle();
    if (!data || !data.results.length) return;
    const unseen = data.results.filter((r) => r.id !== cur && !state.seen.has(r.id));
    const pick = R.pickLucky(unseen.length ? unseen : data.results);
    if (pick) location.href = watchUrl(pick.id);
  }

  // ---------- スキップ ----------
  function currentWatchId() {
    return location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null;
  }
  async function findResultMode(id) {
    const order = [state.mode, ...Object.keys(MODES).filter((m) => m !== state.mode)];
    for (const mode of order) {
      if (!state.data[mode]) state.data[mode] = await store.getLast(mode);
      const d = state.data[mode];
      if (d && d.results && d.results.some((r) => r.id === id)) return mode;
    }
    return null;
  }
  // 再生中の動画が YT Shuffle のおすすめなら「スキップして次へ」ボタンを出す
  async function updateSkipBar() {
    const id = currentWatchId();
    const mode = id ? await findResultMode(id) : null;
    skipBarFor = mode ? { id, mode } : null;
    updateFab();
  }
  let lastHref = location.href;
  setInterval(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    updateSkipBar();
  }, 1000);
  document.addEventListener('yt-navigate-finish', () => updateSkipBar());
  updateSkipBar();

  // 今の動画をスキップ（しばらく出さない）して、次のおすすめを再生
  async function skipAndNext() {
    const id = currentWatchId();
    const mode = (skipBarFor && skipBarFor.id === id && skipBarFor.mode) || state.mode;
    els.skipBar.disabled = true;
    try {
      if (id) {
        await store.skipVideo(id, settingsCache.skipDays);
        if (state.data[mode]) await removeResults((x) => x.id === id, mode);
      }
      state.seen = new Set((await store.loadWatched()).keys());
      let d = state.data[mode];
      const pickable = (x) => (x && x.results ? x.results.filter((r) => r.id !== id && !state.seen.has(r.id)) : []);
      if (!pickable(d).length) {
        // 候補が尽きたらシャッフルし直す（パネルを開いて進み具合を見せる）
        if (state.mode !== mode) await setMode(mode);
        if (!state.open) await open();
        d = await runShuffle();
      }
      const pick = R.pickLucky(pickable(d));
      if (pick) location.href = watchUrl(pick.id);
    } finally {
      els.skipBar.disabled = false;
    }
  }

  async function runSync(force = true) {
    if (state.busy) return;
    setBusy(true);
    clearError();
    try {
      const rep = await engine.sync({ force, onProgress: setProgress });
      const msg = [];
      if (rep.subs != null) msg.push(`登録チャンネル ${rep.subs}件${rep.partial ? '（一部のみ）' : ''}`);
      if (rep.history != null) msg.push(`視聴履歴 ${rep.history}件を確認（新規 ${rep.historyAdded}件）`);
      if (rep.historyError) msg.push(`視聴履歴の取得に失敗: ${rep.historyError}`);
      if (!state.data[state.mode]) showEmpty(msg.length ? `同期しました: ${msg.join(' / ')}` : '同期しました。');
      else els.info.textContent = `同期しました: ${msg.join(' / ')}`;
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
      refreshStatus();
    }
  }

  async function runDiagnose() {
    if (state.busy) return;
    els.diag.textContent = '';
    els.diag.classList.add('on');
    const log = (line) => (els.diag.textContent += line + '\n');
    setBusy(true);
    setProgress({ text: '動作診断中…' });
    try {
      await engine.diagnose(log);
      log('（この内容をコピーして開発者に送ると、原因の特定に役立ちます）');
    } catch (e) {
      log('✘ ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function skipVideo(r) {
    await store.skipVideo(r.id, settingsCache.skipDays);
    await removeResults((x) => x.id === r.id);
  }
  async function hideVideo(r) {
    await store.hideVideo(r.id);
    await removeResults((x) => x.id === r.id);
  }
  async function hideChannel(r) {
    if (!r.channelId) return hideVideo(r);
    await store.hideChannel(r.channelId, r.channelName);
    await removeResults((x) => x.channelId === r.channelId);
  }
  // 一覧から消して、空いたところを補充候補で埋める
  async function removeResults(pred, mode = state.mode) {
    const d = state.data[mode];
    if (!d) return;
    const idx = d.results.findIndex(pred);
    const kept = d.results.filter((x) => !pred(x));
    if (d.channels) d.channels = d.channels.filter((c) => !pred({ id: null, channelId: c.id }));
    const hidden = await store.getHidden();
    const now = Date.now();
    const isExcluded = (c) =>
      pred(c) ||
      state.seen.has(c.id) ||
      !!hidden.videos[c.id] ||
      hidden.skips[c.id] > now ||
      !!(c.channelId && hidden.channels[c.channelId]);
    const r = R.refill(kept, d.pool || [], {
      maxPerChannel: settingsCache.maxPerChannel,
      limit: d.results.length,
      isExcluded,
    });
    const next = kept.slice();
    if (idx >= 0) next.splice(Math.min(idx, next.length), 0, ...r.added);
    else next.push(...r.added);
    d.results = next;
    d.pool = r.pool;
    await store.saveLast(mode, d);
    if (mode === state.mode) renderResults(true);
  }

  // ---------- 描画 ----------
  function showEmpty(text) {
    els.info.textContent = '';
    els.found.replaceChildren();
    els.list.replaceChildren(h('div', { class: 'empty' }, dice(56), h('p', null, text)));
  }

  function renderResults(keepScroll) {
    const d = state.data[state.mode];
    if (!d) {
      showEmpty(
        state.mode === 'subs'
          ? '「シャッフル」を押すと、登録チャンネルから人気の未視聴動画をランダムに選びます。'
          : '「シャッフル」を押すと、あなたの好みに近い未登録チャンネルの人気動画を探します。'
      );
      return;
    }
    const info = [];
    if (d.mode === 'subs') info.push(`${d.checked}チャンネルを調べて ${d.results.length}本を選びました`);
    else info.push(`「${(d.seeds || []).slice(0, 3).join('」「')}」などを起点に ${d.results.length}本を選びました`);
    if (d.mode === 'subs' && d.feed) info[0] = info[0].replace('チャンネルを調べて', 'チャンネル＋新着フィードを調べて');
    if (d.period) info.push(`［投稿日: ${d.period}］`);
    info.push(`（${U.formatAgo(d.at)}）`);
    els.info.replaceChildren(
      info.join(''),
      d.terms && d.terms.length
        ? h('div', { class: 'terms' }, 'よく見るキーワード:', d.terms.map((t) => h('span', { class: 'term' }, t)))
        : null
    );

    els.found.replaceChildren();
    if (d.mode === 'similar' && d.channels && d.channels.length) {
      els.found.append(
        h('h4', null, '見つかった近いチャンネル'),
        h(
          'div',
          { class: 'row' },
          d.channels.map((c) =>
            h(
              'a',
              { class: 'chan', href: channelUrl({ channelId: c.id, handle: c.handle, channelName: c.name }), title: `「${c.seeds.join('」「')}」の関連に${c.count}回登場` },
              c.name || c.handle || c.id
            )
          )
        )
      );
    }

    if (!d.results.length) {
      showEmptyList(
        d.period
          ? `投稿日が${d.period}の未視聴の動画が見つかりませんでした。期間を広げるか、もう一度シャッフルしてください。`
          : '条件に合う未視聴の動画が見つかりませんでした。もう一度シャッフルするか、設定で条件をゆるめてください。'
      );
      return;
    }
    const top = els.scroller.scrollTop;
    els.list.replaceChildren(h('div', { class: 'grid' }, d.results.map(card)));
    els.scroller.scrollTop = keepScroll ? top : 0;
    updateCompact();
  }
  function showEmptyList(text) {
    els.list.replaceChildren(h('div', { class: 'empty' }, h('p', null, text)));
  }

  function card(r) {
    const seen = state.seen.has(r.id);
    const meta2 = [r.views != null ? U.formatViews(r.views) : null, relTime(r.published)].filter(Boolean).join(' ・ ');
    const chips = [
      r.reason ? h('span', { class: `chip ${r.kind === 'similar' ? 'similar' : 'reason'}` }, r.reason) : null,
      r.rank ? h('span', { class: 'chip' }, `チャンネル内 人気${r.rank}位`) : null,
      seen ? h('span', { class: 'chip' }, '視聴済み') : null,
    ];
    return h(
      'div',
      { class: `card${seen ? ' seen' : ''}` },
      h(
        'a',
        { class: 'thumb', href: watchUrl(r.id), title: r.title },
        h('img', { src: U.thumbUrl(r.id), alt: '', loading: 'lazy' }),
        r.duration ? h('span', { class: 'dur' }, U.formatDuration(r.duration)) : null
      ),
      h(
        'div',
        { class: 'body' },
        h('a', { class: 'title', href: watchUrl(r.id), title: r.title }, r.title || '(タイトル不明)'),
        h('div', { class: 'meta' }, h('a', { href: channelUrl(r) }, r.channelName || 'チャンネル')),
        meta2 ? h('div', { class: 'meta' }, meta2) : null,
        h('div', { class: 'chips' }, chips),
        h(
          'div',
          { class: 'acts' },
          h(
            'button',
            { class: 'act', 'data-act': 'skip', title: `今回は見送る（${settingsCache.skipDays}日間は出さない）。代わりの動画を補充します`, onclick: () => skipVideo(r) },
            icon('skip', 15),
            'スキップ'
          ),
          h('button', { class: 'act', 'data-act': 'hide', title: 'この動画を今後ずっと出さない', onclick: () => hideVideo(r) }, icon('close', 15), '興味なし'),
          h(
            'button',
            { class: 'act', 'data-act': 'channel', title: 'このチャンネルの動画を今後出さない', onclick: () => hideChannel(r) },
            icon('block', 15),
            'チャンネル除外'
          )
        )
      )
    );
  }

  YTS.panel = { open, close, toggle, skipAndNext };
})(globalThis);
