// YouTube の公開 RSS（/feeds/videos.xml）のパーサ。
// DOMParser は YouTube の Trusted Types 制約に引っかかるため正規表現で読む。
(function (root) {
  'use strict';
  const YTS = (root.YTS = root.YTS || {});

  function decodeEntities(s) {
    return String(s || '')
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  function tag(xml, name) {
    const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
    return m ? decodeEntities(m[1].trim()) : '';
  }

  function parseFeed(xml) {
    if (!xml || !/<feed[\s>]/.test(xml)) return null;
    const firstEntry = xml.indexOf('<entry>');
    const head = firstEntry >= 0 ? xml.slice(0, firstEntry) : xml;
    const feed = {
      channelId: tag(head, 'yt:channelId') || null,
      title: tag(head, 'title'),
      videos: [],
    };
    const entries = xml.split('<entry>').slice(1);
    for (const raw of entries) {
      const e = raw.split('</entry>')[0];
      const id = tag(e, 'yt:videoId');
      if (!/^[\w-]{11}$/.test(id)) continue;
      const link = (e.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/) || [])[1] || '';
      const views = (e.match(/<media:statistics[^>]*views="(\d+)"/) || [])[1];
      const author = (e.match(/<author>([\s\S]*?)<\/author>/) || [])[1] || '';
      feed.videos.push({
        id,
        title: tag(e, 'title'),
        channelId: tag(e, 'yt:channelId') || feed.channelId,
        handle: null,
        channelName: tag(author, 'name'),
        views: views != null ? parseInt(views, 10) : null,
        duration: null,
        published: tag(e, 'published'),
        live: false,
        upcoming: false,
        short: /\/shorts\//.test(link),
        members: false,
        watched: null,
      });
    }
    return feed;
  }

  const rss = { parseFeed, decodeEntities };
  YTS.rss = rss;
  if (typeof module !== 'undefined' && module.exports) module.exports = rss;
})(typeof globalThis !== 'undefined' ? globalThis : this);
