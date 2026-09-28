// 汎用ユーティリティ（コンテンツスクリプト・オプション画面・Service Worker・Node テストで共用）
(function (root) {
  'use strict';
  const YTS = (root.YTS = root.YTS || {});

  const DAY = 24 * 60 * 60 * 1000;

  function normalizeDigits(s) {
    return String(s)
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/，/g, ',')
      .replace(/．/g, '.')
      .replace(/ /g, ' ');
  }

  // "1,234,567 views" / "1.2M views" / "123万 回視聴" / "1.2億回視聴" → 数値
  const COUNT_UNITS = {
    '千': 1e3, '万': 1e4, '億': 1e8,
    k: 1e3, m: 1e6, b: 1e9,
    thousand: 1e3, million: 1e6, billion: 1e9,
  };
  function parseCount(input) {
    if (input == null) return null;
    if (typeof input === 'number') return Number.isFinite(input) ? input : null;
    const s = normalizeDigits(input).replace(/\s+/g, ' ').trim();
    if (!s) return null;
    if (/^(no views|視聴回数なし|再生回数なし|視聴なし)/i.test(s)) return 0;
    const m = s.match(/(\d[\d,]*(?:\.\d+)?)\s*(億|万|千|thousand|million|billion|[KkMmBb](?![a-zA-Z]))?/);
    if (!m) return null;
    const n = parseFloat(m[1].replace(/,/g, ''));
    if (!Number.isFinite(n)) return null;
    const mult = COUNT_UNITS[(m[2] || '').toLowerCase()] || COUNT_UNITS[m[2]] || 1;
    return Math.round(n * mult);
  }

  // "1:02:03" → 3723, "12:34" → 754
  function parseDuration(input) {
    if (input == null) return null;
    if (typeof input === 'number') return input;
    const s = normalizeDigits(input).trim();
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    if (!/^\d+(:\d{1,2}){1,2}$/.test(s)) return null;
    return s.split(':').reduce((acc, p) => acc * 60 + parseInt(p, 10), 0);
  }

  // YouTube の各種テキスト表現（simpleText / runs / content / 文字列）を文字列化
  function textOf(node) {
    if (node == null) return '';
    if (typeof node === 'string') return node;
    if (typeof node === 'number') return String(node);
    if (typeof node.simpleText === 'string') return node.simpleText;
    if (Array.isArray(node.runs)) return node.runs.map((r) => (r && r.text) || '').join('');
    if (typeof node.content === 'string') return node.content;
    if (typeof node.text === 'string') return node.text;
    if (node.text && typeof node.text === 'object') return textOf(node.text);
    return '';
  }

  const compactFmt =
    typeof Intl !== 'undefined' && Intl.NumberFormat
      ? new Intl.NumberFormat('ja-JP', { notation: 'compact', maximumFractionDigits: 1 })
      : null;
  function formatViews(n) {
    if (n == null) return '';
    return (compactFmt ? compactFmt.format(n) : String(n)) + '回視聴';
  }

  function formatDuration(sec) {
    if (sec == null || !Number.isFinite(sec)) return '';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const pad = (x) => String(x).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  function formatAgo(ts, now = Date.now()) {
    if (!ts) return '未同期';
    const diff = Math.max(0, now - ts);
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'たった今';
    if (min < 60) return `${min}分前`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h}時間前`;
    return `${Math.floor(h / 24)}日前`;
  }

  function normName(s) {
    return String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  }

  // ---- 興味プロファイル用の簡易トークナイザ ----
  const STOPWORDS = new Set(
    (
      'the and for with you your this that from are was were have has not but all out how what why who ' +
      'video videos official shorts short feat ft vs mv pv part vol ep live full new ver version episode ' +
      'する した して します こと これ それ あれ この その ため よう もの さん ちゃん です ます でした ました ' +
      'みた やってみた ない なる なっ ある いる いた できる できない やる みる いく くる いう すぎ すぎる とき ところ やつ ください ' +
      '公式 動画 切り抜き 配信 ライブ 生放送 アーカイブ'
    ).split(/\s+/)
  );
  const segmenter =
    typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('ja', { granularity: 'word' }) : null;

  function tokenize(text) {
    const s = String(text || '').normalize('NFKC').toLowerCase();
    const raw = [];
    if (segmenter) {
      for (const seg of segmenter.segment(s)) if (seg.isWordLike) raw.push(seg.segment);
    } else {
      raw.push(...s.split(/[^\p{L}\p{N}]+/u));
    }
    const out = [];
    for (const t of raw) {
      if (!t) continue;
      if (/^\d+$/.test(t)) continue;
      if (t.length < 2) continue; // 1文字（助詞・単漢字）はノイズが多いので捨てる
      if (/^[぀-ゟ]{2}$/.test(t)) continue; // ひらがな2文字（活用語尾など）
      if (/^(part|ep|vol|no|day|#)\d+$/.test(t)) continue;
      if (STOPWORDS.has(t)) continue;
      out.push(t);
    }
    return out;
  }

  // ---- 乱数 ----
  function makeRng(seed) {
    if (seed == null) return Math.random;
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 重み付き・非復元抽出（Efraimidis–Spirakis）
  function weightedSample(items, weightOf, k, rng = Math.random) {
    const keyed = [];
    for (const it of items) {
      const w = weightOf(it);
      if (!(w > 0)) continue;
      keyed.push({ it, key: Math.pow(rng() || 1e-12, 1 / w) });
    }
    keyed.sort((a, b) => b.key - a.key);
    return keyed.slice(0, k).map((x) => x.it);
  }

  function shuffle(arr, rng = Math.random) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // 同時実行数を制限した map（失敗は null を返して続行）
  async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    async function worker() {
      while (next < items.length) {
        const i = next++;
        try {
          results[i] = await fn(items[i], i);
        } catch (e) {
          results[i] = null;
        }
      }
    }
    const workers = [];
    for (let i = 0; i < Math.min(limit, items.length); i++) workers.push(worker());
    await Promise.all(workers);
    return results;
  }

  function clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function thumbUrl(videoId) {
    return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
  }

  const util = {
    DAY,
    normalizeDigits,
    parseCount,
    parseDuration,
    textOf,
    formatViews,
    formatDuration,
    formatAgo,
    normName,
    tokenize,
    makeRng,
    weightedSample,
    shuffle,
    mapLimit,
    clamp,
    sleep,
    thumbUrl,
  };
  YTS.util = util;
  if (typeof module !== 'undefined' && module.exports) module.exports = util;
})(typeof globalThis !== 'undefined' ? globalThis : this);
