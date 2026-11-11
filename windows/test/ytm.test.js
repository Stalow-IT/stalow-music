'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseListItem, parseNext, toSeconds } = require('../src/ytm');

const artistRun = (name, id) => ({ text: name, navigationEndpoint: { browseEndpoint: { browseId: id, browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_ARTIST' } } } } });

test('a song row gives id, title, artist ids, album and duration', () => {
  const r = {
    playlistItemData: { videoId: 'vid1' },
    flexColumns: [
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Shalom Aleichem' }] } } },
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Song' }, { text: ' • ' }, artistRun('Avraham Fried', 'UCaaa'), { text: ' • ' },
        { text: 'Best Of', navigationEndpoint: { browseEndpoint: { browseId: 'MPREb_x' } } }, { text: ' • ' }, { text: '3:25' }] } } },
    ],
    thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'https://lh3/x=w60-h60-l90-rj' }] } } },
  };
  const s = parseListItem(r);
  assert.strictEqual(s.type, 'song');
  assert.strictEqual(s.id, 'vid1');
  assert.deepStrictEqual(s.artists, [{ id: 'UCaaa', name: 'Avraham Fried' }]);
  assert.strictEqual(s.album.id, 'MPREb_x');
  assert.strictEqual(s.duration, 205);
  assert.match(s.thumbnail, /w226-h226/);
});

test('radio rows and the continuation are read from the up-next panel', () => {
  const json = { contents: { x: [{ playlistPanelVideoRenderer: { videoId: 'v1', title: { runs: [{ text: 'T' }] }, longBylineText: { runs: [artistRun('A', 'UCa')] }, lengthText: { runs: [{ text: '4:01' }] } } }],
    c: { nextRadioContinuationData: { continuation: 'CONT' } } } };
  const r = parseNext(json);
  assert.strictEqual(r.items[0].id, 'v1');
  assert.strictEqual(r.items[0].duration, 241);
  assert.strictEqual(r.continuation, 'CONT');
});

test('radio rows carry their album, for the now-playing line', () => {
  const albumRun = { text: 'Best Of', navigationEndpoint: { browseEndpoint: { browseId: 'MPREb_y' } } };
  const json = { x: [{ playlistPanelVideoRenderer: { videoId: 'v2', title: { runs: [{ text: 'T' }] }, longBylineText: { runs: [artistRun('A', 'UCa'), { text: ' • ' }, albumRun, { text: ' • ' }, { text: '2020' }] } } }] };
  assert.deepStrictEqual(parseNext(json).items[0].album, { id: 'MPREb_y', title: 'Best Of' });
});

test('durations', () => { assert.strictEqual(toSeconds('1:02:03'), 3723); assert.strictEqual(toSeconds(null), null); });
