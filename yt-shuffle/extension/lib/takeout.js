// Google Takeout（YouTube）のエクスポートファイルの取り込み
//  - 登録チャンネル: subscriptions.csv
//  - 視聴履歴: watch-history.json（推奨） / watch-history.html
(function (root) {
  'use strict';
  const YTS = (root.YTS = root.YTS || {});

  // ダブルクォート対応の簡易 CSV パーサ
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQ = false;
    const s = String(text || '').replace(/^﻿/, '');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQ) {
        if (c === '"') {
          if (s[i + 1] === '"') {
            field += '"';
            i++;
          } else inQ = false;
        } else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && s[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else field += c;
    }
    if (field || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  // 見出しの言語に依存しないよう「UC で始まる ID を含む行」を拾う
  function parseSubscriptionsCsv(text) {
    const out = [];
    const seen = new Set();
    for (const row of parseCsv(text)) {
      const idIdx = row.findIndex((f) => /^UC[\w-]{22}$/.test(f.trim()));
      if (idIdx < 0) continue;
      const id = row[idIdx].trim();
      if (seen.has(id)) continue;
      seen.add(id);
      const rest = row.filter((_, i) => i !== idIdx).map((f) => f.trim());
      const title = rest.filter((f) => !/^https?:\/\//.test(f)).pop() || '';
      out.push({ id, title, handle: null, thumb: null });
    }
    return out;
  }

  function videoIdFromUrl(url) {
    if (!url) return null;
    const m = String(url).match(/[?&]v=([\w-]{11})/) || String(url).match(/youtu\.be\/([\w-]{11})/) ||
      String(url).match(/\/shorts\/([\w-]{11})/);
    return m ? m[1] : null;
  }

  function channelIdFromUrl(url) {
    const m = String(url || '').match(/\/channel\/(UC[\w-]{22})/);
    return m ? m[1] : null;
  }

  // 「〇〇 を視聴しました」「Watched 〇〇」などの前後置きを取る
  function cleanTitle(t) {
    return String(t || '')
      .replace(/^Watched\s+/, '')
      .replace(/\s*を視聴しました$/, '')
      .replace(/^視聴しました[:：]?\s*/, '')
      .trim();
  }

  // → [{ id, title, channelId, channelName, t }]
  function parseWatchHistoryJson(text) {
    let arr;
    try {
      arr = JSON.parse(String(text || '').replace(/^﻿/, ''));
    } catch (e) {
      return [];
    }
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const e of arr) {
      if (!e || typeof e !== 'object') continue;
      if (Array.isArray(e.details) && e.details.some((d) => /Google\s*(広告|Ads)/i.test((d && d.name) || ''))) continue;
      const id = videoIdFromUrl(e.titleUrl);
      if (!id) continue;
      const sub = Array.isArray(e.subtitles) ? e.subtitles[0] : null;
      const t = Date.parse(e.time);
      out.push({
        id,
        title: cleanTitle(e.title),
        channelId: sub ? channelIdFromUrl(sub.url) : null,
        channelName: sub ? sub.name || '' : '',
        t: Number.isFinite(t) ? t : 0,
      });
    }
    return out;
  }

  function stripTags(s) {
    return String(s || '').replace(/<[^>]*>/g, '');
  }

  // HTML 版は日付の書式がロケール依存なので、日付は取れたときだけ使う
  function parseWatchHistoryHtml(html) {
    const decode = (YTS.rss && YTS.rss.decodeEntities) || ((x) => x);
    const out = [];
    // 1 件 = 1 つの outer-cell。最初の content-cell に「動画リンク / チャンネルリンク / 日時」が入っている
    const cells = String(html || '').split(/class="outer-cell/).slice(1);
    for (const cell of cells) {
      const m = cell.match(/class="content-cell[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      if (!m) continue;
      const body = m[1];
      const links = [...body.matchAll(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
      const watch = links.find((l) => videoIdFromUrl(decode(l[1])));
      if (!watch) continue;
      if (/Google\s*(広告|Ads)/i.test(stripTags(cell))) continue;
      const ch = links.find((l) => /\/channel\/UC/.test(l[1]));
      const segs = body.split(/<br\s*\/?>/).map((x) => decode(stripTags(x)).trim()).filter(Boolean);
      const tail = segs[segs.length - 1] || '';
      const t = Date.parse(tail.replace(/\s+[A-Z]{2,5}$/, ''));
      out.push({
        id: videoIdFromUrl(decode(watch[1])),
        title: cleanTitle(decode(stripTags(watch[2]))),
        channelId: ch ? channelIdFromUrl(ch[1]) : null,
        channelName: ch ? decode(stripTags(ch[2])).trim() : '',
        t: Number.isFinite(t) ? t : 0,
      });
    }
    return out;
  }

  function parseWatchHistory(text) {
    const s = String(text || '').trimStart().replace(/^﻿/, '');
    if (s.startsWith('[')) return parseWatchHistoryJson(s);
    return parseWatchHistoryHtml(s);
  }

  const takeout = {
    parseCsv,
    parseSubscriptionsCsv,
    parseWatchHistory,
    parseWatchHistoryJson,
    parseWatchHistoryHtml,
    videoIdFromUrl,
    channelIdFromUrl,
  };
  YTS.takeout = takeout;
  if (typeof module !== 'undefined' && module.exports) module.exports = takeout;
})(typeof globalThis !== 'undefined' ? globalThis : this);
