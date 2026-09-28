(function () {
  'use strict';
  const { store, takeout, util: U } = globalThis.YTS;
  const $ = (sel) => document.querySelector(sel);
  const form = $('#settings');

  // ---------- データの状態 ----------
  async function renderStats() {
    const s = await store.summary();
    const rows = [
      ['登録チャンネル', `${s.subs.toLocaleString()} 件` + (s.subs ? `（${s.subsSource === 'takeout' ? 'Takeout' : 'YouTube'}・${U.formatAgo(s.subsUpdatedAt)}）` : '')],
      ['視聴済みとして記録', `${s.watched.toLocaleString()} 本`],
      ['視聴履歴の同期', U.formatAgo(s.historySyncedAt)],
      ['非表示', `動画 ${s.hiddenVideos} 本 / チャンネル ${s.hiddenChannels} 件`],
    ];
    $('#stats').replaceChildren(
      ...rows.flatMap(([k, v]) => {
        const dt = document.createElement('dt');
        dt.textContent = k;
        const dd = document.createElement('dd');
        dd.textContent = v;
        return [dt, dd];
      })
    );
  }

  // ---------- 設定 ----------
  function fill(settings) {
    for (const el of form.elements) {
      if (!el.name || !(el.name in settings)) continue;
      if (el.type === 'checkbox') el.checked = !!settings[el.name];
      else el.value = settings[el.name];
      updateOutput(el);
    }
  }
  function updateOutput(el) {
    if (el.type === 'range') el.parentElement.querySelector('output').textContent = el.value;
  }
  function read() {
    const out = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else if (el.tagName === 'SELECT') out[el.name] = el.value;
      else if (el.value !== '') {
        const n = Number(el.value);
        if (!Number.isFinite(n)) continue;
        const min = el.min !== '' ? Number(el.min) : -Infinity;
        const max = el.max !== '' ? Number(el.max) : Infinity;
        out[el.name] = U.clamp(n, min, max);
      }
    }
    return out;
  }
  let saveTimer = null;
  // パネル側で期間や幅を変えたときも表示を合わせる
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings && !form.contains(document.activeElement)) {
      store.getSettings().then(fill);
    }
  });
  form.addEventListener('input', (e) => {
    updateOutput(e.target);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await store.saveSettings(read());
      $('#saved').textContent = '保存しました';
      setTimeout(() => ($('#saved').textContent = ''), 1500);
    }, 300);
  });
  $('#reset-settings').addEventListener('click', async () => {
    await chrome.storage.local.remove('settings');
    fill(await store.getSettings());
    $('#saved').textContent = '初期値に戻しました';
  });

  // ---------- Takeout 取り込み ----------
  const result = $('#import-result');
  function say(text) {
    result.textContent = text;
  }

  $('#import-subs').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const channels = takeout.parseSubscriptionsCsv(await file.text());
    if (!channels.length) return say('登録チャンネルが見つかりませんでした。subscriptions.csv を選んでいるか確認してください。');
    await store.saveSubs(channels, 'takeout');
    say(`登録チャンネル ${channels.length} 件を取り込みました。`);
    e.target.value = '';
    renderStats();
  });

  $('#import-history').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    say('読み込み中…');
    const entries = takeout.parseWatchHistory(await file.text());
    if (!entries.length) return say('視聴履歴が見つかりませんでした。watch-history.json（または .html）を選んでいるか確認してください。');
    let added = 0;
    const CHUNK = 5000;
    for (let i = 0; i < entries.length; i += CHUNK) {
      added += await store.mergeWatched(
        entries.slice(i, i + CHUNK).map((x) => ({ id: x.id, t: x.t, channelId: x.channelId, channelName: x.channelName, title: x.title }))
      );
      say(`取り込み中… ${Math.min(i + CHUNK, entries.length).toLocaleString()} / ${entries.length.toLocaleString()}`);
    }
    say(`視聴履歴 ${entries.length.toLocaleString()} 件を読み込み、新しく ${added.toLocaleString()} 本を記録しました。`);
    e.target.value = '';
    renderStats();
  });

  // ---------- 非表示 ----------
  async function renderHidden() {
    const h = await store.getHidden();
    const box = $('#hidden-channels');
    const entries = Object.entries(h.channels);
    if (!entries.length) {
      const p = document.createElement('div');
      p.className = 'empty';
      p.textContent = '非表示にしたチャンネルはありません。';
      box.replaceChildren(p);
    } else {
      box.replaceChildren(
        ...entries.map(([id, info]) => {
          const row = document.createElement('div');
          row.className = 'row';
          const a = document.createElement('a');
          a.href = `https://www.youtube.com/channel/${id}`;
          a.target = '_blank';
          a.rel = 'noopener';
          a.textContent = info.name || id;
          const btn = document.createElement('button');
          btn.className = 'small';
          btn.textContent = '戻す';
          btn.addEventListener('click', async () => {
            await store.unhideChannel(id);
            renderHidden();
            renderStats();
          });
          row.append(a, btn);
          return row;
        })
      );
    }
    $('#clear-hidden-videos').textContent = `非表示にした動画をすべて戻す（${Object.keys(h.videos).length} 本）`;
  }
  $('#clear-hidden-videos').addEventListener('click', async () => {
    await store.clearHiddenVideos();
    renderHidden();
    renderStats();
  });

  // ---------- 削除 ----------
  $('#clear-watched').addEventListener('click', async () => {
    if (!confirm('視聴記録を削除します。よろしいですか？')) return;
    await store.clearWatched();
    renderStats();
  });
  $('#clear-all').addEventListener('click', async () => {
    if (!confirm('登録チャンネル・視聴記録・キャッシュ・非表示リストをすべて削除します。よろしいですか？')) return;
    await store.clearAllData();
    renderStats();
    renderHidden();
  });

  $('#open-youtube').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'yts:openYouTube' }));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (Object.keys(changes).some((k) => k === 'subs' || k === 'meta' || k === 'hidden' || k.startsWith('wv_'))) {
      renderStats();
      if (changes.hidden) renderHidden();
    }
  });

  store.getSettings().then(fill);
  renderStats();
  renderHidden();
})();
