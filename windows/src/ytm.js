'use strict';
// Minimal YouTube Music (InnerTube) client: search, artist, album, playlist and radio.
// Mirrors the Android app's innertube parsing. Pure parsing functions are exported for tests.

const BASE = 'https://music.youtube.com/youtubei/v1/';
const CLIENT = { clientName: 'WEB_REMIX', clientVersion: '1.20260707.12.00', hl: 'en', gl: 'US' };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0';

const FILTERS = {
  song: 'EgWKAQIIAWoKEAkQBRAKEAMQBA==',
  video: 'EgWKAQIQAWoKEAkQChAFEAMQBA==',
  album: 'EgWKAQIYAWoKEAkQChAFEAMQBA==',
  artist: 'EgWKAQIgAWoKEAkQChAFEAMQBA==',
  playlist: 'EgeKAQQoAEABagoQAxAEEAoQCRAF',
};

let visitorData = null;

async function call(endpoint, body, fetchImpl = fetch) {
  const headers = { 'Content-Type': 'application/json', 'User-Agent': UA, Origin: 'https://music.youtube.com', Referer: 'https://music.youtube.com/' };
  if (visitorData) headers['X-Goog-Visitor-Id'] = visitorData;
  const res = await fetchImpl(BASE + endpoint + '?prettyPrint=false', {
    method: 'POST', headers,
    body: JSON.stringify({ context: { client: { ...CLIENT, ...(visitorData ? { visitorData } : {}) } }, ...body }),
  });
  if (!res.ok) throw new Error(`YouTube Music ${endpoint} failed: HTTP ${res.status}`);
  const json = await res.json();
  const vd = json?.responseContext?.visitorData;
  if (vd && !visitorData) visitorData = vd;
  return json;
}

// ---------- parsing helpers ----------
const runsText = (t) => (t?.runs || []).map((r) => r.text).join('') || t?.simpleText || '';
const bestThumb = (obj) => {
  const list = obj?.musicThumbnailRenderer?.thumbnail?.thumbnails || obj?.thumbnails || obj?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails || [];
  const t = list[list.length - 1]?.url || '';
  return t.replace(/=w\d+-h\d+.*$/, '=w226-h226-l90-rj');
};
const browseOf = (run) => run?.navigationEndpoint?.browseEndpoint;
const pageType = (be) => be?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType || '';
const DURATION = /^(\d+:)?\d{1,2}:\d{2}$/;
const toSeconds = (s) => s ? s.split(':').reduce((a, b) => a * 60 + Number(b), 0) : null;

function artistsFromRuns(runs) {
  return (runs || []).filter((r) => {
    const b = browseOf(r);
    return b?.browseId?.startsWith('UC') && /ARTIST|USER_CHANNEL/.test(pageType(b));
  }).map((r) => ({ id: browseOf(r).browseId, name: r.text }));
}

function flexRuns(r, i) {
  return r.flexColumns?.[i]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
}

/** One list row (search results, artist songs, album/playlist tracks). */
function parseListItem(r, ctx = {}) {
  const title = flexRuns(r, 0).map((x) => x.text).join('');
  const subRuns = [...flexRuns(r, 1), ...flexRuns(r, 2)];
  const nav = r.navigationEndpoint?.browseEndpoint;
  const videoId = r.playlistItemData?.videoId
    || flexRuns(r, 0)[0]?.navigationEndpoint?.watchEndpoint?.videoId
    || r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
  const thumbnail = bestThumb(r.thumbnail) || ctx.thumbnail || '';
  if (nav?.browseId) {
    const pt = pageType(nav);
    if (/ARTIST|USER_CHANNEL/.test(pt)) return { type: 'artist', id: nav.browseId, title, thumbnail };
    if (/ALBUM/.test(pt)) return { type: 'album', id: nav.browseId, title, artists: artistsFromRuns(subRuns), thumbnail };
    if (/PLAYLIST/.test(pt)) return { type: 'playlist', id: nav.browseId.replace(/^VL/, ''), title, author: artistsFromRuns(subRuns)[0] || null, thumbnail };
    return null;
  }
  if (!videoId || !title) return null;
  let artists = artistsFromRuns(subRuns);
  if (!artists.length && ctx.artists) artists = ctx.artists;
  const fixed = runsText(r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text);
  const durText = DURATION.test(fixed) ? fixed : (subRuns.map((x) => x.text.trim()).find((t) => DURATION.test(t)) || null);
  const albumRun = subRuns.find((x) => browseOf(x)?.browseId?.startsWith('MPRE'));
  const mvt = r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType || '';
  return {
    type: 'song', id: videoId, title, artists, thumbnail,
    album: albumRun ? { id: browseOf(albumRun).browseId, title: albumRun.text } : (ctx.album || null),
    duration: toSeconds(durText), isVideo: /UGC|OMV/.test(mvt), isPodcast: /PODCAST/.test(mvt),
  };
}

/** One carousel card (artist page albums/singles/videos). */
function parseTwoRow(r) {
  const title = runsText(r.title);
  const nav = r.navigationEndpoint;
  const subRuns = r.subtitle?.runs || [];
  const thumbnail = bestThumb(r.thumbnailRenderer);
  if (nav?.watchEndpoint?.videoId) {
    return { type: 'song', id: nav.watchEndpoint.videoId, title, artists: artistsFromRuns(subRuns), thumbnail, isVideo: true, duration: null, album: null };
  }
  const b = nav?.browseEndpoint; if (!b?.browseId) return null;
  const pt = pageType(b);
  if (/ALBUM/.test(pt)) return { type: 'album', id: b.browseId, title, artists: artistsFromRuns(subRuns), year: subRuns.map((x) => x.text).find((t) => /^\d{4}$/.test(t)) || null, thumbnail };
  if (/ARTIST|USER_CHANNEL/.test(pt)) return { type: 'artist', id: b.browseId, title, thumbnail };
  if (/PLAYLIST/.test(pt)) return { type: 'playlist', id: b.browseId.replace(/^VL/, ''), title, author: artistsFromRuns(subRuns)[0] || null, thumbnail };
  return null;
}

/** Every list row anywhere in a response. */
function collectListItems(json, ctx) {
  const out = [];
  (function walk(x) {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== 'object') return;
    if (x.musicResponsiveListItemRenderer) { const p = parseListItem(x.musicResponsiveListItemRenderer, ctx); if (p) out.push(p); return; }
    for (const k in x) walk(x[k]);
  })(json);
  return out;
}

function parseSearch(json) { return collectListItems(json); }

function parseArtist(json, id) {
  const h = json.header?.musicImmersiveHeaderRenderer || json.header?.musicVisualHeaderRenderer || json.header?.musicHeaderRenderer || {};
  const artist = { type: 'artist', id, title: runsText(h.title), thumbnail: bestThumb(h.thumbnail) || bestThumb(h.foregroundThumbnail) };
  const sections = [];
  const contents = json.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
  for (const c of contents) {
    if (c.musicShelfRenderer) {
      const items = (c.musicShelfRenderer.contents || []).map((x) => x.musicResponsiveListItemRenderer && parseListItem(x.musicResponsiveListItemRenderer, { artists: [{ id, name: artist.title }] })).filter(Boolean);
      sections.push({ title: runsText(c.musicShelfRenderer.title) || 'Songs', items });
    } else if (c.musicCarouselShelfRenderer) {
      const s = c.musicCarouselShelfRenderer;
      const items = (s.contents || []).map((x) => (x.musicTwoRowItemRenderer && parseTwoRow(x.musicTwoRowItemRenderer))
        || (x.musicResponsiveListItemRenderer && parseListItem(x.musicResponsiveListItemRenderer, { artists: [{ id, name: artist.title }] }))).filter(Boolean);
      sections.push({ title: runsText(s.header?.musicCarouselShelfBasicHeaderRenderer?.title), items });
    }
  }
  return { artist, sections };
}

function parseAlbum(json, id) {
  let header = null;
  (function find(x) {
    if (header || !x || typeof x !== 'object') return;
    if (x.musicResponsiveHeaderRenderer || x.musicDetailHeaderRenderer) { header = x.musicResponsiveHeaderRenderer || x.musicDetailHeaderRenderer; return; }
    for (const k in x) find(x[k]);
  })(json);
  const title = runsText(header?.title);
  const artists = artistsFromRuns([...(header?.straplineTextOne?.runs || []), ...(header?.subtitle?.runs || [])]);
  const thumbnail = bestThumb(header?.thumbnail?.musicThumbnailRenderer ? header.thumbnail : header?.thumbnail?.croppedSquareThumbnailRenderer);
  const album = { type: 'album', id, title, artists, thumbnail };
  const songs = collectListItems(json, { artists, thumbnail, album: { id, title } }).filter((x) => x.type === 'song');
  return { album, songs };
}

function parsePlaylist(json, id) {
  let header = null;
  (function find(x) {
    if (header || !x || typeof x !== 'object') return;
    if (x.musicResponsiveHeaderRenderer || x.musicDetailHeaderRenderer || x.musicEditablePlaylistDetailHeaderRenderer) { header = x.musicResponsiveHeaderRenderer || x.musicDetailHeaderRenderer || x.musicEditablePlaylistDetailHeaderRenderer?.header?.musicResponsiveHeaderRenderer; return; }
    for (const k in x) find(x[k]);
  })(json);
  const author = artistsFromRuns([...(header?.straplineTextOne?.runs || []), ...(header?.subtitle?.runs || [])])[0] || null;
  return {
    playlist: { type: 'playlist', id, title: runsText(header?.title), author, thumbnail: bestThumb(header?.thumbnail?.musicThumbnailRenderer ? header.thumbnail : header?.thumbnail?.croppedSquareThumbnailRenderer) },
    songs: collectListItems(json).filter((x) => x.type === 'song'),
  };
}

function parseNext(json) {
  const items = [];
  let continuation = null;
  (function walk(x) {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== 'object') return;
    const p = x.playlistPanelVideoRenderer;
    if (p) {
      const runs = p.longBylineText?.runs || p.shortBylineText?.runs || [];
      const thumbs = p.thumbnail?.thumbnails || [];
      const albumRun = runs.find((r) => browseOf(r)?.browseId?.startsWith('MPRE'));
      const album = albumRun ? { id: browseOf(albumRun).browseId, title: albumRun.text } : null;
      const mvt = p.navigationEndpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType || '';
      items.push({ type: 'song', id: p.videoId, title: runsText(p.title), artists: artistsFromRuns(runs), thumbnail: (thumbs[thumbs.length - 1]?.url || ''), duration: toSeconds(runsText(p.lengthText)), album, isVideo: /UGC|OMV/.test(mvt), isPodcast: /PODCAST/.test(mvt) });
      return;
    }
    if (x.nextRadioContinuationData?.continuation) continuation = x.nextRadioContinuationData.continuation;
    if (x.nextContinuationData?.continuation && !continuation) continuation = x.nextContinuationData.continuation;
    for (const k in x) walk(x[k]);
  })(json);
  return { items, continuation };
}

/** The lyrics browse id from a "next" (watch) response: the Lyrics tab of the player page. */
function lyricsBrowseId(json) {
  let id = null;
  (function walk(x) {
    if (id || !x || typeof x !== 'object') return;
    const b = x.tabRenderer?.endpoint?.browseEndpoint;
    if (b?.browseId?.startsWith('MPLY')) { id = b.browseId; return; }
    for (const k in x) walk(x[k]);
  })(json);
  return id;
}

/** The plain lyrics text of a lyrics browse response, or null. */
function parseLyrics(json) {
  let text = null;
  (function walk(x) {
    if (text || !x || typeof x !== 'object') return;
    if (x.musicDescriptionShelfRenderer?.description) { text = runsText(x.musicDescriptionShelfRenderer.description); return; }
    for (const k in x) walk(x[k]);
  })(json);
  return text && text.trim() ? text : null;
}

/** The language YouTube Music answers in (titles, labels): en, iw (Hebrew), yi, fr ... */
function setLanguage(hl) { if (typeof hl === 'string' && /^[a-z]{2,3}$/.test(hl)) CLIENT.hl = hl; }

// ---------- API ----------
const api = {
  setLanguage,
  /** YouTube Music's own lyrics for a song (plain text), or null. */
  lyrics: async (videoId) => {
    const id = lyricsBrowseId(await call('next', { videoId, isAudioOnly: true }));
    return id ? parseLyrics(await call('browse', { browseId: id })) : null;
  },
  /** type: song | video | album | artist | playlist, or null for YouTube Music's general results. */
  search: async (query, type = null) => {
    const items = parseSearch(await call('search', type ? { query, params: FILTERS[type] } : { query }));
    return type ? items.filter((x) => x.type === type || (type === 'video' && x.type === 'song')) : items;
  },
  artist: async (id) => parseArtist(await call('browse', { browseId: id }), id),
  album: async (id) => parseAlbum(await call('browse', { browseId: id }), id),
  playlist: async (id) => parsePlaylist(await call('browse', { browseId: 'VL' + id.replace(/^VL/, '') }), id.replace(/^VL/, '')),
  radio: async (videoId, continuation) => {
    const body = continuation ? { continuation } : { videoId, playlistId: 'RDAMVM' + videoId, isAudioOnly: true, enablePersistentPlaylistPanel: true, tunerSettingValue: 'AUTOMIX_SETTING_NORMAL' };
    return parseNext(await call('next', body));
  },
};

module.exports = { api, FILTERS, lyricsBrowseId, parseLyrics, CLIENT, parseListItem, parseTwoRow, parseSearch, parseArtist, parseAlbum, parsePlaylist, parseNext, toSeconds, _call: call };
