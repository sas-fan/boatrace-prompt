// YouTube のページ HTML / InnerTube レスポンスから必要な情報を取り出すパーサ。
// YouTube の内部フォーマットは頻繁に変わるため、特定のパスに依存せず
// 「既知のレンダラーを木構造から探す」汎用ウォーカーで拾う方針にしている。
(function (root) {
  'use strict';
  const YTS = (root.YTS = root.YTS || {});
  const U = YTS.util || (typeof require === 'function' ? require('./util.js') : null);
  const { textOf, parseCount, parseDuration } = U;

  const VIDEO_ID_RE = /^[\w-]{11}$/;
  const CHANNEL_ID_RE = /^UC[\w-]{22}$/;
  // チャンネル名を誤判定しないよう、数字を伴う表現だけを拾う
  const VIEW_RE = /(\d.*(views?|回視聴|回再生)|視聴回数|no views)/i;
  const LIVE_RE = /\d.*(watching|視聴中|待機中|waiting)/i;
  const AGO_RE = /(\d+\s*(秒|分|時間|日|週間|週|か月|ヶ月|カ月|ヵ月|年)\s*前|\d.*\bago\b|streamed|配信済み|premiered|プレミア公開)/i;
  const MEMBERS_RE = /(members only|members first|メンバー限定|メンバー先行)/i;

  const isVideoId = (s) => typeof s === 'string' && VIDEO_ID_RE.test(s);
  const isChannelId = (s) => typeof s === 'string' && CHANNEL_ID_RE.test(s);

  // ---------- HTML から JSON を切り出す ----------

  // str[start] が '{' の前提で、対応する '}' までを返す（文字列リテラル内の括弧は無視）
  function sliceBalanced(str, start) {
    let depth = 0;
    let inStr = false;
    for (let i = start; i < str.length; i++) {
      const c = str.charCodeAt(i);
      if (inStr) {
        if (c === 92 /* \ */) i++;
        else if (c === 34 /* " */) inStr = false;
        continue;
      }
      if (c === 34) inStr = true;
      else if (c === 123 /* { */) depth++;
      else if (c === 125 /* } */) {
        depth--;
        if (depth === 0) return str.slice(start, i + 1);
      }
    }
    return null;
  }

  // JS の文字列リテラル（'...'）を読み、エスケープを解いて返す
  function readJsString(str, start) {
    const quote = str[start];
    let out = '';
    for (let i = start + 1; i < str.length; i++) {
      const ch = str[i];
      if (ch === quote) return out;
      if (ch !== '\\') {
        out += ch;
        continue;
      }
      const n = str[++i];
      if (n === 'x') {
        out += String.fromCharCode(parseInt(str.substr(i + 1, 2), 16));
        i += 2;
      } else if (n === 'u') {
        out += String.fromCharCode(parseInt(str.substr(i + 1, 4), 16));
        i += 4;
      } else if (n === 'n') out += '\n';
      else if (n === 't') out += '\t';
      else if (n === 'r') out += '\r';
      else out += n;
    }
    return null;
  }

  function extractJsonAfter(html, markers) {
    if (!html) return null;
    for (const marker of markers) {
      marker.lastIndex = 0;
      const m = marker.exec(html);
      if (!m) continue;
      let i = m.index + m[0].length;
      while (i < html.length && /\s/.test(html[i])) i++;
      try {
        if (html[i] === '{') {
          const json = sliceBalanced(html, i);
          if (json) return JSON.parse(json);
        } else if (html[i] === "'" || html[i] === '"') {
          const s = readJsString(html, i);
          if (s) return JSON.parse(s);
        }
      } catch (e) {
        /* 次のマーカーを試す */
      }
    }
    return null;
  }

  function extractInitialData(html) {
    return extractJsonAfter(html, [
      /var ytInitialData\s*=\s*/g,
      /window\["ytInitialData"\]\s*=\s*/g,
      /ytInitialData\s*=\s*/g,
    ]);
  }

  function extractPlayerResponse(html) {
    return extractJsonAfter(html, [
      /var ytInitialPlayerResponse\s*=\s*/g,
      /window\["ytInitialPlayerResponse"\]\s*=\s*/g,
      /ytInitialPlayerResponse\s*=\s*/g,
    ]);
  }

  // ytcfg.set({...}) は複数回出てくるのでマージする
  function extractYtcfg(html) {
    const cfg = {};
    if (!html) return cfg;
    const re = /ytcfg\.set\(\s*\{/g;
    let m;
    while ((m = re.exec(html))) {
      const start = m.index + m[0].length - 1;
      const json = sliceBalanced(html, start);
      if (!json) continue;
      try {
        Object.assign(cfg, JSON.parse(json));
      } catch (e) {
        /* ignore */
      }
      re.lastIndex = start + json.length;
    }
    return cfg;
  }

  // ---------- 汎用ウォーカー ----------

  // 前順（配列順を保つ）で走査。visit が false を返したらその子は辿らない。
  function walk(rootNode, visit, maxNodes = Infinity) {
    const stack = [rootNode];
    let count = 0;
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      if (++count > maxNodes) return;
      if (Array.isArray(node)) {
        for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]);
        continue;
      }
      if (visit(node) === false) continue;
      const keys = Object.keys(node);
      for (let i = keys.length - 1; i >= 0; i--) {
        const v = node[keys[i]];
        if (v && typeof v === 'object') stack.push(v);
      }
    }
  }

  function handleFrom(url) {
    if (typeof url !== 'string') return null;
    const m = url.match(/\/(@[^/?#]+)/);
    if (!m) return null;
    try {
      return decodeURIComponent(m[1]);
    } catch (e) {
      return m[1];
    }
  }

  // 部分木の中から最初に出てくるチャンネルへのリンク（browseId = UC...）を探す
  function findChannelRef(node) {
    if (!node) return null;
    let found = null;
    walk(
      node,
      (o) => {
        if (found) return false;
        const be = o.browseEndpoint;
        if (be && isChannelId(be.browseId)) {
          found = { id: be.browseId, handle: handleFrom(be.canonicalBaseUrl) };
          return false;
        }
      },
      3000
    );
    return found;
  }

  function findFirst(node, pred, maxNodes = 3000) {
    let found;
    walk(
      node,
      (o) => {
        if (found !== undefined) return false;
        const r = pred(o);
        if (r !== undefined && r !== null) {
          found = r;
          return false;
        }
      },
      maxNodes
    );
    return found;
  }

  function firstText(node) {
    return findFirst(node, (o) => {
      const t = textOf(o);
      return t ? t : undefined;
    });
  }

  function bestThumb(thumbnail) {
    const list = (thumbnail && thumbnail.thumbnails) || [];
    const last = list[list.length - 1];
    if (!last || !last.url) return null;
    return last.url.startsWith('//') ? 'https:' + last.url : last.url;
  }

  function viewsFromLabel(label) {
    if (!label) return null;
    const m = String(label).match(/(\d[\d,.]*\s*(?:億|万|千|[KMB])?)\s*(?:回視聴|views?)/i);
    return m ? parseCount(m[1]) : null;
  }

  // ---------- 動画レンダラーの解析 ----------

  const CLASSIC_KEYS = [
    'videoRenderer',
    'compactVideoRenderer',
    'gridVideoRenderer',
    'playlistVideoRenderer',
    'playlistPanelVideoRenderer',
    'videoWithContextRenderer',
    'reelItemRenderer',
  ];

  function parseClassic(r, kind) {
    if (!r || !isVideoId(r.videoId)) return null;
    const title = textOf(r.title) || textOf(r.headline) || '';
    const byline = r.ownerText || r.longBylineText || r.shortBylineText;
    const ref =
      findChannelRef(byline) ||
      findChannelRef(r.channelThumbnailSupportedRenderers) ||
      findChannelRef(r.channelThumbnail) ||
      null;
    const viewText = textOf(r.viewCountText) || textOf(r.shortViewCountText);
    let live = false;
    let upcoming = !!r.upcomingEventData;
    let short = kind === 'reelItemRenderer' || !!(r.navigationEndpoint && r.navigationEndpoint.reelWatchEndpoint);
    let members = false;
    let watched = null;
    let published = textOf(r.publishedTimeText);
    let views = null;

    if (viewText && LIVE_RE.test(viewText)) live = true;
    else if (viewText) views = parseCount(viewText);

    // playlistVideoRenderer は videoInfo に「123万 回視聴 • 3 年前」
    if (r.videoInfo) {
      const parts = (r.videoInfo.runs || []).map((x) => x.text || '').filter((t) => t.trim() && t.trim() !== '•');
      for (const t of parts) {
        if (LIVE_RE.test(t)) live = true;
        else if (views == null && VIEW_RE.test(t)) views = parseCount(t);
        else if (!published && AGO_RE.test(t)) published = t;
      }
    }
    if (views == null && !live) {
      const label =
        (r.title && r.title.accessibility && r.title.accessibility.accessibilityData &&
          r.title.accessibility.accessibilityData.label) ||
        (r.accessibility && r.accessibility.accessibilityData && r.accessibility.accessibilityData.label);
      views = viewsFromLabel(label);
    }

    let duration = r.lengthSeconds != null ? parseInt(r.lengthSeconds, 10) : parseDuration(textOf(r.lengthText));
    if (!Number.isFinite(duration)) duration = null;

    for (const o of r.thumbnailOverlays || []) {
      if (o.thumbnailOverlayResumePlaybackRenderer) {
        watched = o.thumbnailOverlayResumePlaybackRenderer.percentDurationWatched ?? watched;
      }
      const ts = o.thumbnailOverlayTimeStatusRenderer;
      if (ts) {
        const style = ts.style || '';
        if (/LIVE/.test(style)) live = true;
        if (/SHORTS/.test(style)) short = true;
        if (/UPCOMING/.test(style)) upcoming = true;
        if (duration == null) duration = parseDuration(textOf(ts.text));
      }
    }
    for (const b of [].concat(r.badges || [], r.ownerBadges || [])) {
      const mb = b.metadataBadgeRenderer || {};
      const st = mb.style || '';
      if (/LIVE/.test(st)) live = true;
      if (/MEMBERS_ONLY/.test(st) || MEMBERS_RE.test(mb.label || '')) members = true;
    }

    return {
      id: r.videoId,
      title,
      channelId: ref ? ref.id : null,
      handle: ref ? ref.handle : null,
      channelName: textOf(byline) || '',
      views,
      duration,
      published: published || '',
      live,
      upcoming,
      short,
      members,
      watched,
    };
  }

  function parseLockup(l) {
    if (!l) return null;
    const type = l.contentType || '';
    if (type && !/VIDEO/.test(type)) return null; // プレイリスト・ミックス・チャンネル等は除外
    const onTap = findFirst(l.rendererContext, (o) => o.innertubeCommand || undefined);
    let id = l.contentId;
    if (!isVideoId(id) && onTap) {
      id = (onTap.watchEndpoint && onTap.watchEndpoint.videoId) || (onTap.reelWatchEndpoint && onTap.reelWatchEndpoint.videoId);
    }
    if (!isVideoId(id)) return null;

    const meta = (l.metadata && l.metadata.lockupMetadataViewModel) || {};
    const title = textOf(meta.title);
    const rows =
      (meta.metadata && meta.metadata.contentMetadataViewModel && meta.metadata.contentMetadataViewModel.metadataRows) || [];
    let views = null;
    let published = '';
    let channelName = '';
    let live = false;
    let members = false;
    rows.forEach((row, ri) => {
      for (const p of row.metadataParts || []) {
        const t = textOf(p.text) || textOf(p);
        if (!t) continue;
        if (LIVE_RE.test(t)) live = true;
        else if (views == null && VIEW_RE.test(t)) views = parseCount(t);
        else if (!published && AGO_RE.test(t)) published = t;
        else if (MEMBERS_RE.test(t)) members = true;
        else if (!channelName && ri === 0) channelName = t;
      }
    });

    let duration = null;
    let short = !!(onTap && onTap.reelWatchEndpoint);
    let watched = null;
    let upcoming = false;
    walk(
      l.contentImage,
      (o) => {
        const b = o.thumbnailBadgeViewModel;
        if (b) {
          const t = textOf(b.text) || b.text || '';
          const st = b.badgeStyle || '';
          if (/LIVE/.test(st) || /^(LIVE|ライブ|ライブ配信中)$/i.test(t)) live = true;
          else if (/UPCOMING/.test(st) || /^(UPCOMING|近日公開|予定)$/i.test(t)) upcoming = true;
          else if (/SHORTS/.test(st) || /^(SHORTS|ショート)$/i.test(t)) short = true;
          else if (duration == null) duration = parseDuration(t);
        }
        const pb = o.thumbnailOverlayProgressBarViewModel;
        if (pb && pb.startPercent != null) watched = pb.startPercent;
        const rp = o.thumbnailOverlayResumePlaybackRenderer;
        if (rp && rp.percentDurationWatched != null) watched = rp.percentDurationWatched;
      },
      2000
    );
    walk(
      meta,
      (o) => {
        const bv = o.badgeViewModel;
        if (bv && MEMBERS_RE.test(bv.badgeText || '')) members = true;
      },
      2000
    );

    const ref = findChannelRef(meta.image) || findChannelRef(meta.metadata) || findChannelRef(l.metadata) || null;
    return {
      id,
      title,
      channelId: ref ? ref.id : null,
      handle: ref ? ref.handle : null,
      channelName,
      views,
      duration,
      published,
      live,
      upcoming,
      short,
      members,
      watched,
    };
  }

  function parseShortsLockup(s) {
    if (!s) return null;
    const cmd = findFirst(s.onTap, (o) => o.reelWatchEndpoint || undefined);
    let id = cmd && cmd.videoId;
    if (!isVideoId(id) && typeof s.entityId === 'string') {
      const m = s.entityId.match(/([\w-]{11})$/);
      if (m) id = m[1];
    }
    if (!isVideoId(id)) return null;
    const om = s.overlayMetadata || {};
    return {
      id,
      title: textOf(om.primaryText) || '',
      channelId: null,
      handle: null,
      channelName: '',
      views: parseCount(textOf(om.secondaryText)),
      duration: null,
      published: '',
      live: false,
      upcoming: false,
      short: true,
      members: false,
      watched: null,
    };
  }

  // node が動画レンダラーを含むなら { video } を返す。含まないなら null。
  function parseVideoNode(o) {
    for (const k of CLASSIC_KEYS) {
      if (o[k] && typeof o[k] === 'object') return { video: parseClassic(o[k], k) };
    }
    if (o.lockupViewModel) {
      const t = o.lockupViewModel.contentType || '';
      if (!t || /VIDEO/.test(t)) return { video: parseLockup(o.lockupViewModel) };
      return { video: null };
    }
    if (o.shortsLockupViewModel) return { video: parseShortsLockup(o.shortsLockupViewModel) };
    return null;
  }

  function mergeVideo(a, b) {
    const out = Object.assign({}, a);
    for (const [k, v] of Object.entries(b)) {
      if (out[k] == null || out[k] === '' || out[k] === false) out[k] = v;
    }
    return out;
  }

  function collectVideos(rootNode) {
    const map = new Map();
    walk(rootNode, (o) => {
      const r = parseVideoNode(o);
      if (!r) return;
      const v = r.video;
      if (v) map.set(v.id, map.has(v.id) ? mergeVideo(map.get(v.id), v) : v);
      return false;
    });
    return [...map.values()];
  }

  // ---------- チャンネル一覧（登録チャンネル） ----------

  function collectChannels(rootNode) {
    const out = [];
    const seen = new Set();
    const push = (c) => {
      if (!c || !isChannelId(c.id) || seen.has(c.id)) return;
      seen.add(c.id);
      out.push(c);
    };
    walk(rootNode, (o) => {
      const r = o.channelRenderer || o.gridChannelRenderer;
      if (r) {
        const be = (r.navigationEndpoint && r.navigationEndpoint.browseEndpoint) || {};
        push({
          id: r.channelId || be.browseId,
          title: textOf(r.title),
          handle: handleFrom(be.canonicalBaseUrl),
          thumb: bestThumb(r.thumbnail),
        });
        return false;
      }
      const l = o.lockupViewModel;
      if (l && /CHANNEL/.test(l.contentType || '')) {
        const ref = findChannelRef(l);
        const meta = (l.metadata && l.metadata.lockupMetadataViewModel) || {};
        push({
          id: isChannelId(l.contentId) ? l.contentId : ref && ref.id,
          title: textOf(meta.title),
          handle: ref ? ref.handle : null,
          thumb: null,
        });
        return false;
      }
    });
    return out;
  }

  // ---------- 継続トークン ----------

  function findContinuation(rootNode) {
    let token = null;
    walk(rootNode, (o) => {
      if (o.continuationItemRenderer) {
        const t = findFirst(o.continuationItemRenderer, (x) =>
          x.continuationCommand && x.continuationCommand.token ? x.continuationCommand.token : undefined
        );
        if (t) token = t;
        return false;
      }
      if (o.nextContinuationData && o.nextContinuationData.continuation) {
        token = o.nextContinuationData.continuation;
      }
    });
    return token;
  }

  // ---------- 視聴履歴ページ ----------

  const WEEKDAYS_JA = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];
  const WEEKDAYS_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const MONTHS_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  function parseSectionDate(text, now = Date.now()) {
    if (!text) return null;
    const s = U.normalizeDigits(text).trim().toLowerCase();
    const today = new Date(now);
    today.setHours(12, 0, 0, 0);
    const day = U.DAY;
    if (/^(今日|today)$/.test(s)) return now;
    if (/^(昨日|yesterday)$/.test(s)) return today.getTime() - day;
    let wd = WEEKDAYS_JA.indexOf(s);
    if (wd < 0) wd = WEEKDAYS_EN.indexOf(s);
    if (wd >= 0) {
      let diff = (today.getDay() - wd + 7) % 7;
      if (diff === 0) diff = 7;
      return today.getTime() - diff * day;
    }
    let m = s.match(/^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/);
    let y, mo, d;
    if (m) {
      y = m[1] ? +m[1] : null;
      mo = +m[2];
      d = +m[3];
    } else if ((m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/))) {
      y = +m[1];
      mo = +m[2];
      d = +m[3];
    } else if ((m = s.match(/^([a-z]{3})[a-z]*\.? (\d{1,2})(?:, (\d{4}))?/))) {
      const mi = MONTHS_EN.indexOf(m[1]);
      if (mi < 0) return null;
      mo = mi + 1;
      d = +m[2];
      y = m[3] ? +m[3] : null;
    } else {
      return null;
    }
    const year = y || today.getFullYear();
    let dt = new Date(year, mo - 1, d, 12, 0, 0, 0);
    if (!y && dt.getTime() > now + day) dt = new Date(year - 1, mo - 1, d, 12, 0, 0, 0);
    return dt.getTime();
  }

  // 履歴ページの動画を、見出しの日付つきで取り出す
  function collectHistory(rootNode, now = Date.now()) {
    const out = [];
    const seen = new Set();
    let current = null;
    walk(rootNode, (o) => {
      if (o.itemSectionRenderer && o.itemSectionRenderer.header) {
        const d = parseSectionDate(firstText(o.itemSectionRenderer.header), now);
        if (d) current = d;
      }
      const r = parseVideoNode(o);
      if (!r) return;
      const v = r.video;
      if (v && !seen.has(v.id)) {
        seen.add(v.id);
        v.watchedAt = current;
        out.push(v);
      }
      return false;
    });
    return out;
  }

  // ---------- 各種ページ固有 ----------

  function relatedRoot(data) {
    const r = data && data.contents && data.contents.twoColumnWatchNextResults;
    return (r && r.secondaryResults) || data;
  }

  function isLoggedIn(cfg, data) {
    if (cfg && typeof cfg.LOGGED_IN === 'boolean') return cfg.LOGGED_IN;
    const ctx = data && data.responseContext && data.responseContext.mainAppWebResponseContext;
    if (ctx && typeof ctx.loggedOut === 'boolean') return !ctx.loggedOut;
    return null;
  }

  function pageAlert(data) {
    const alerts = (data && data.alerts) || [];
    for (const a of alerts) {
      const t = firstText(a);
      if (t) return t;
    }
    return null;
  }

  const extract = {
    isVideoId,
    isChannelId,
    sliceBalanced,
    extractJsonAfter,
    extractInitialData,
    extractPlayerResponse,
    extractYtcfg,
    walk,
    findChannelRef,
    handleFrom,
    parseVideoNode,
    collectVideos,
    collectChannels,
    findContinuation,
    parseSectionDate,
    collectHistory,
    relatedRoot,
    isLoggedIn,
    pageAlert,
  };
  YTS.extract = extract;
  if (typeof module !== 'undefined' && module.exports) module.exports = extract;
})(typeof globalThis !== 'undefined' ? globalThis : this);
