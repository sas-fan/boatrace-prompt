// テスト用に YouTube のページ構造を模したデータを組み立てるヘルパー。
// 旧形式（videoRenderer 系）と新形式（lockupViewModel 系）の両方を用意する。
'use strict';

const vid = (n) => 'vid' + String(n).padStart(8, '0'); // 11 文字
const cid = (n) => 'UC' + String(n).padStart(22, '0'); // UC + 22 文字

const runs = (text, browseId, handle) => ({
  runs: [
    {
      text,
      ...(browseId
        ? {
            navigationEndpoint: {
              clickTrackingParams: 'x',
              commandMetadata: { webCommandMetadata: { url: handle ? `/${handle}` : `/channel/${browseId}`, webPageType: 'WEB_PAGE_TYPE_CHANNEL' } },
              browseEndpoint: { browseId, canonicalBaseUrl: handle ? `/${handle}` : undefined },
            },
          }
        : {}),
    },
  ],
});

function channelRenderer({ id, title, handle }) {
  return {
    channelRenderer: {
      channelId: id,
      title: { simpleText: title },
      navigationEndpoint: { browseEndpoint: { browseId: id, canonicalBaseUrl: `/${handle || '@' + id}` } },
      thumbnail: { thumbnails: [{ url: `//yt3.googleusercontent.com/${id}=s88`, width: 88, height: 88 }, { url: `//yt3.googleusercontent.com/${id}=s176`, width: 176, height: 176 }] },
      videoCountText: { simpleText: '12.3万人のチャンネル登録者' },
      subscriberCountText: { simpleText: handle || '@x' },
      subscriptionButton: { subscribed: true },
    },
  };
}

function continuationItem(token) {
  return {
    continuationItemRenderer: {
      trigger: 'CONTINUATION_TRIGGER_ON_ITEM_SHOWN',
      continuationEndpoint: {
        clickTrackingParams: 'x',
        commandMetadata: { webCommandMetadata: { sendPost: true, apiUrl: '/youtubei/v1/browse' } },
        continuationCommand: { token, request: 'CONTINUATION_REQUEST_TYPE_BROWSE' },
      },
    },
  };
}

function browsePage(sectionContents, extra = {}) {
  return {
    responseContext: { mainAppWebResponseContext: { loggedOut: false } },
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [{ tabRenderer: { selected: true, content: { sectionListRenderer: { contents: sectionContents } } } }],
      },
    },
    ...extra,
  };
}

function feedChannelsData(channels, token) {
  return browsePage([
    {
      itemSectionRenderer: {
        contents: [{ shelfRenderer: { content: { expandedShelfContentsRenderer: { items: channels.map(channelRenderer) } } } }],
      },
    },
    ...(token ? [continuationItem(token)] : []),
  ]);
}

function continuationResponse(items, token) {
  return {
    responseContext: { mainAppWebResponseContext: { loggedOut: false } },
    onResponseReceivedActions: [
      { appendContinuationItemsAction: { continuationItems: [...items, ...(token ? [continuationItem(token)] : [])], targetId: 'x' } },
    ],
  };
}

function channelsContinuation(channels, token) {
  return continuationResponse(
    [{ itemSectionRenderer: { contents: [{ shelfRenderer: { content: { expandedShelfContentsRenderer: { items: channels.map(channelRenderer) } } } }] } }],
    token
  );
}

function jaViews(n) {
  if (n >= 1e8) return `${(n / 1e8).toFixed(1).replace(/\.0$/, '')}億 回視聴`;
  if (n >= 1e5) return `${Math.floor(n / 1e4)}万 回視聴`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1).replace(/\.0$/, '')}万 回視聴`;
  return `${n.toLocaleString('en-US')} 回視聴`;
}
function durText(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function playlistVideoRenderer(v) {
  return {
    playlistVideoRenderer: {
      videoId: v.id,
      thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg` }] },
      title: {
        runs: [{ text: v.title }],
        accessibility: { accessibilityData: { label: `${v.title} 作成者: ${v.channelName} ${v.views.toLocaleString('en-US')} 回視聴 3 年前 ${Math.floor(v.duration / 60)} 分` } },
      },
      index: { simpleText: '1' },
      shortBylineText: runs(v.channelName, v.channelId, v.handle),
      lengthText: { simpleText: durText(v.duration) },
      navigationEndpoint: { watchEndpoint: { videoId: v.id, playlistId: 'UULP' + v.channelId.slice(2), index: 0 } },
      lengthSeconds: String(v.duration),
      isPlayable: true,
      thumbnailOverlays: [
        ...(v.watchedPct != null ? [{ thumbnailOverlayResumePlaybackRenderer: { percentDurationWatched: v.watchedPct } }] : []),
        { thumbnailOverlayTimeStatusRenderer: { text: { simpleText: durText(v.duration) }, style: v.short ? 'SHORTS' : 'DEFAULT' } },
      ],
      videoInfo: { runs: [{ text: jaViews(v.views) }, { text: ' • ' }, { text: v.published || '3 年前' }] },
    },
  };
}

function playlistPageData(videos) {
  return browsePage([
    {
      itemSectionRenderer: {
        contents: [{ playlistVideoListRenderer: { contents: videos.map(playlistVideoRenderer), playlistId: 'UULP' } }],
      },
    },
  ]);
}

function videoRenderer(v) {
  return {
    videoRenderer: {
      videoId: v.id,
      title: { runs: [{ text: v.title }] },
      longBylineText: runs(v.channelName, v.channelId, v.handle),
      ownerText: runs(v.channelName, v.channelId, v.handle),
      shortBylineText: runs(v.channelName, v.channelId, v.handle),
      publishedTimeText: { simpleText: v.published || '2 年前' },
      lengthText: { simpleText: durText(v.duration || 600) },
      viewCountText: { simpleText: `${(v.views || 0).toLocaleString('en-US')} 回視聴` },
      shortViewCountText: { simpleText: jaViews(v.views || 0) },
      thumbnailOverlays: [
        ...(v.watchedPct != null ? [{ thumbnailOverlayResumePlaybackRenderer: { percentDurationWatched: v.watchedPct } }] : []),
        { thumbnailOverlayTimeStatusRenderer: { text: { simpleText: durText(v.duration || 600) }, style: 'DEFAULT' } },
      ],
      ...(v.members ? { badges: [{ metadataBadgeRenderer: { style: 'BADGE_STYLE_TYPE_MEMBERS_ONLY', label: 'メンバー限定' } }] } : {}),
    },
  };
}

function historyData(sections, token) {
  return browsePage([
    ...sections.map((s) => ({
      itemSectionRenderer: {
        contents: s.videos.map((v) => (s.lockup ? lockup(v) : videoRenderer(v))),
        header: { itemSectionHeaderRenderer: { title: { runs: [{ text: s.header }] } } },
      },
    })),
    ...(token ? [continuationItem(token)] : []),
  ]);
}

// 2024〜2025 年の新 UI で使われる lockupViewModel
function lockup(v) {
  const channelPart = { text: { content: v.channelName, ...(v.channelId && v.linkChannel !== false ? { commandRuns: [{ startIndex: 0, length: v.channelName.length, onTap: { innertubeCommand: { browseEndpoint: { browseId: v.channelId, canonicalBaseUrl: v.handle ? `/${v.handle}` : undefined } } } }] } : {}) } };
  const overlays = [
    {
      thumbnailBottomOverlayViewModel: {
        ...(v.watchedPct != null ? { progressBar: { thumbnailOverlayProgressBarViewModel: { startPercent: v.watchedPct } } } : {}),
        badges: [
          {
            thumbnailBadgeViewModel: v.live
              ? { text: 'ライブ', badgeStyle: 'THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE' }
              : { text: durText(v.duration || 600), badgeStyle: 'THUMBNAIL_OVERLAY_BADGE_STYLE_DEFAULT' },
          },
        ],
      },
    },
  ];
  return {
    lockupViewModel: {
      contentImage: { thumbnailViewModel: { image: { sources: [{ url: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`, width: 168, height: 94 }] }, overlays } },
      metadata: {
        lockupMetadataViewModel: {
          title: { content: v.title },
          metadata: {
            contentMetadataViewModel: {
              metadataRows: [
                { metadataParts: [channelPart] },
                { metadataParts: [{ text: { content: v.live ? '1,234 人が視聴中' : jaViews(v.views || 0) } }, { text: { content: v.published || '1 年前' } }] },
              ],
              delimiter: ' • ',
            },
          },
          menuButton: { buttonViewModel: { iconName: 'MORE_VERT' } },
        },
      },
      contentId: v.id,
      contentType: v.type || 'LOCKUP_CONTENT_TYPE_VIDEO',
      rendererContext: {
        commandContext: {
          onTap: { innertubeCommand: v.short ? { reelWatchEndpoint: { videoId: v.id } } : { watchEndpoint: { videoId: v.id } } },
        },
      },
    },
  };
}

function compactVideoRenderer(v) {
  return {
    compactVideoRenderer: {
      videoId: v.id,
      title: { simpleText: v.title },
      longBylineText: runs(v.channelName, v.channelId, v.handle),
      shortBylineText: runs(v.channelName, v.channelId, v.handle),
      publishedTimeText: { simpleText: '5 か月前' },
      viewCountText: { simpleText: `${(v.views || 0).toLocaleString('en-US')} 回視聴` },
      lengthText: { simpleText: durText(v.duration || 600) },
    },
  };
}

function watchData(related, { useCompact = false } = {}) {
  return {
    responseContext: { mainAppWebResponseContext: { loggedOut: false } },
    contents: {
      twoColumnWatchNextResults: {
        results: { results: { contents: [{ videoPrimaryInfoRenderer: { title: { runs: [{ text: 'main' }] } } }] } },
        secondaryResults: {
          secondaryResults: {
            results: [
              ...related.map((v) => (useCompact ? compactVideoRenderer(v) : lockup(v))),
              continuationItem('RELATED_MORE'),
            ],
          },
        },
      },
    },
  };
}

function playerResponse({ id, channelId, author, title = 'main', lengthSeconds = 600 }) {
  return { videoDetails: { videoId: id, title, lengthSeconds: String(lengthSeconds), channelId, author, viewCount: '12345', isLiveContent: false } };
}

const DEFAULT_CFG = {
  INNERTUBE_API_KEY: 'AIzaTESTKEY',
  INNERTUBE_CLIENT_VERSION: '2.20250901.00.00',
  INNERTUBE_CONTEXT_CLIENT_NAME: 1,
  INNERTUBE_CONTEXT: { client: { hl: 'ja', gl: 'JP', clientName: 'WEB', clientVersion: '2.20250901.00.00' } },
  LOGGED_IN: true,
  SESSION_INDEX: 0,
  VISITOR_DATA: 'CgtWSVNJVE9S',
};

function html({ data, player, cfg = DEFAULT_CFG, body = '' }) {
  return (
    '<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>YouTube</title>' +
    `<script nonce="n">(function(){window.ytplayer={};window.ytcfg={data_:{},set:function(o){Object.assign(this.data_,o);}};})();</script>` +
    `<script nonce="n">ytcfg.set({"CLIENT_CANARY_STATE":"none","EXPERIMENT_FLAGS":{"a":true}});</script>` +
    `<script nonce="n">ytcfg.set(${JSON.stringify(cfg)}); window.ytcfg.obfuscatedData_ = [];</script>` +
    '</head><body>' +
    body +
    (player ? `<script nonce="n">var ytInitialPlayerResponse = ${JSON.stringify(player)};var meta = document.createElement('meta');</script>` : '') +
    (data ? `<script nonce="n">var ytInitialData = ${JSON.stringify(data)};</script>` : '') +
    '<script nonce="n">if (window.ytcsi) {window.ytcsi.tick("pdr", null, \'\');}</script>' +
    '</body></html>'
  );
}

function rssFeed({ channelId, title, videos }) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <link rel="self" href="http://www.youtube.com/feeds/videos.xml?channel_id=${channelId}"/>
 <id>yt:channel:${channelId.slice(2)}</id>
 <yt:channelId>${channelId}</yt:channelId>
 <title>${esc(title)}</title>
 <author><name>${esc(title)}</name><uri>https://www.youtube.com/channel/${channelId}</uri></author>
 <published>2015-01-01T00:00:00+00:00</published>
${videos
  .map(
    (v) => ` <entry>
  <id>yt:video:${v.id}</id>
  <yt:videoId>${v.id}</yt:videoId>
  <yt:channelId>${channelId}</yt:channelId>
  <title>${esc(v.title)}</title>
  <link rel="alternate" href="https://www.youtube.com/${v.short ? 'shorts/' + v.id : 'watch?v=' + v.id}"/>
  <author><name>${esc(title)}</name><uri>https://www.youtube.com/channel/${channelId}</uri></author>
  <published>${v.published || '2023-05-01T09:00:00+00:00'}</published>
  <updated>2024-01-01T00:00:00+00:00</updated>
  <media:group>
   <media:title>${esc(v.title)}</media:title>
   <media:content url="https://www.youtube.com/v/${v.id}?version=3" type="application/x-shockwave-flash" width="640" height="390"/>
   <media:thumbnail url="https://i4.ytimg.com/vi/${v.id}/hqdefault.jpg" width="480" height="360"/>
   <media:description>desc &amp; more</media:description>
   <media:community>
    <media:starRating count="100" average="5.00" min="1" max="5"/>
    <media:statistics views="${v.views}"/>
   </media:community>
  </media:group>
 </entry>`
  )
  .join('\n')}
</feed>`;
}

module.exports = {
  vid,
  cid,
  channelRenderer,
  feedChannelsData,
  channelsContinuation,
  continuationResponse,
  playlistPageData,
  playlistVideoRenderer,
  videoRenderer,
  historyData,
  lockup,
  compactVideoRenderer,
  watchData,
  playerResponse,
  html,
  rssFeed,
  DEFAULT_CFG,
  jaViews,
};
