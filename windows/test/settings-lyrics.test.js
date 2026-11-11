'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const settings = require('../src/settings');
const { parseLrc, identityMatches, normalizeProviders, getLyrics } = require('../src/lyrics');
const { lyricsBrowseId, parseLyrics, parseListItem } = require('../src/ytm');
const { loadArtists, Catalog } = require('../src/catalog');

test('settings: defaults match the Android app, bad values are refused', () => {
  const d = settings.normalize({});
  assert.strictEqual(d.theme, 'dark');
  assert.strictEqual(d.persistentQueue, true);
  assert.strictEqual(d.autoLoadMore, true);
  assert.strictEqual(d.audioNormalization, true);
  assert.strictEqual(d.historyDays, 30);
  assert.deepStrictEqual(d.lyricsProviders.map((p) => p.name), ['SimpMusic', 'LrcLib', 'YouTube']);
  assert.strictEqual(settings.clean('theme', 'purple'), undefined);
  assert.strictEqual(settings.clean('nope', true), undefined);
  assert.strictEqual(settings.clean('volume', 7), 1);
  assert.strictEqual(settings.clean('lyricsOffsetMs', 123), 100);
  assert.strictEqual(settings.clean('historyDays', 12), undefined);
  // a hand-edited or old file: unknown keys dropped, broken values back to the default
  const n = settings.normalize({ theme: 'light', evil: 'x', maxCacheMB: 'lots', lyricsProviders: [{ name: 'YouTube', enabled: false }, { name: 'Bogus' }] });
  assert.strictEqual(n.theme, 'light');
  assert.ok(!('evil' in n));
  assert.strictEqual(n.maxCacheMB, 512);
  assert.deepStrictEqual(n.lyricsProviders, [{ name: 'YouTube', enabled: false }, { name: 'SimpMusic', enabled: true }, { name: 'LrcLib', enabled: true }]);
  assert.strictEqual(settings.contentLanguage('system', 'he-IL'), 'iw');
  assert.strictEqual(settings.contentLanguage('en', 'he-IL'), 'en');
});

test('lyrics: LRC, enhanced (word-by-word) LRC and plain text', () => {
  const lrc = parseLrc('[ar:x]\n[00:01.00]Shalom\n[00:03.50]Aleichem\n');
  assert.strictEqual(lrc.synced, true);
  assert.deepStrictEqual(lrc.lines.map((l) => [l.time, l.text]), [[1, 'Shalom'], [3.5, 'Aleichem']]);
  const words = parseLrc('[00:10.00]<00:10.00>Ma <00:10.50>tovu');
  assert.deepStrictEqual(words.lines[0].words, [{ time: 10, text: 'Ma ' }, { time: 10.5, text: 'tovu' }]);
  assert.strictEqual(words.lines[0].text, 'Ma tovu');
  const plain = parseLrc('Line one\nLine two\n\n');
  assert.strictEqual(plain.synced, false);
  assert.deepStrictEqual(plain.lines.map((l) => l.text), ['Line one', 'Line two']);
});

test('lyrics: LrcLib is used only when title and artist both match', () => {
  const want = { title: 'Yidden', artist: 'Mordechai Ben David', duration: 252 };
  assert.ok(identityMatches({ trackName: 'Yidden (Live)', artistName: 'Mordechai Ben David', duration: 251 }, want));
  assert.ok(!identityMatches({ trackName: 'Yidden', artistName: 'Someone Else', duration: 252 }, want));
  assert.ok(!identityMatches({ trackName: 'Yidden', artistName: 'Mordechai Ben David', duration: 300 }, want));
  assert.deepStrictEqual(normalizeProviders(null).map((p) => p.name), ['SimpMusic', 'LrcLib', 'YouTube']);
});

test('lyrics: providers in the chosen order, off ones skipped, synced preferred', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('simpmusic')) return { ok: true, json: async () => ({ type: 'success', data: [{ durationSeconds: 200, plainLyric: 'plain words' }] }) };
    if (url.includes('lrclib')) return { ok: true, json: async () => [{ trackName: 'Yidden', artistName: 'MBD', duration: 200, syncedLyrics: '[00:01.00]synced words' }] };
    return { ok: false };
  };
  const want = { videoId: 'abcdefghijk', title: 'Yidden', artist: 'MBD', duration: 200 };
  const r = await getLyrics(want, [{ name: 'SimpMusic', enabled: true }, { name: 'LrcLib', enabled: true }, { name: 'YouTube', enabled: false }], { fetchImpl });
  assert.strictEqual(r.source, 'LrcLib'); // SimpMusic only had plain text; LrcLib's synced lyrics win
  assert.strictEqual(r.synced, true);
  const plainOnly = await getLyrics(want, [{ name: 'SimpMusic', enabled: true }, { name: 'LrcLib', enabled: false }, { name: 'YouTube', enabled: false }], { fetchImpl });
  assert.strictEqual(plainOnly.source, 'SimpMusic');
  assert.strictEqual(plainOnly.synced, false);
  calls.length = 0;
  assert.strictEqual(await getLyrics(want, [{ name: 'SimpMusic', enabled: false }, { name: 'LrcLib', enabled: false }, { name: 'YouTube', enabled: false }], { fetchImpl }), null);
  assert.strictEqual(calls.length, 0);
});

test('YouTube lyrics: the lyrics tab id and its text', () => {
  const next = { contents: { tabs: [{ tabRenderer: { endpoint: { browseEndpoint: { browseId: 'MPLYt_abc' } } } }] } };
  assert.strictEqual(lyricsBrowseId(next), 'MPLYt_abc');
  assert.strictEqual(parseLyrics({ x: { musicDescriptionShelfRenderer: { description: { runs: [{ text: 'Line 1\nLine 2' }] } } } }), 'Line 1\nLine 2');
  assert.strictEqual(parseLyrics({}), null);
});

test('content filter: podcast episodes can be blocked', () => {
  const c = new Catalog(loadArtists(path.join(__dirname, '..', 'data', 'artists.json')));
  const artist = c.findArtists('')[0];
  const episode = { type: 'song', id: 'x', title: 'Episode', artists: [{ id: artist.id, name: artist.title }], isPodcast: true };
  assert.ok(c.songAllowed(episode));
  c.setFilters({ blockPodcasts: true });
  assert.ok(!c.songAllowed(episode));
  assert.ok(c.songAllowed({ ...episode, isPodcast: false }));
  const row = { playlistItemData: { videoId: 'vid' }, flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'T' }] } } }],
    overlay: { musicItemThumbnailOverlayRenderer: { content: { musicPlayButtonRenderer: { playNavigationEndpoint: { watchEndpoint: { watchEndpointMusicSupportedConfigs: { watchEndpointMusicConfig: { musicVideoType: 'MUSIC_VIDEO_TYPE_PODCAST_EPISODE' } } } } } } } } };
  assert.strictEqual(parseListItem(row).isPodcast, true);
});
