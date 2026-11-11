'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseArtist, parseMultiRow, parseTwoRow, wordsToSeconds } = require('../src/ytm');

// The shapes YouTube Music sends for a podcast channel (trimmed from a real 18Forty response).
const episode = {
  onTap: { watchEndpoint: { videoId: 'ZiLVylXYU44', watchEndpointMusicSupportedConfigs: { watchEndpointMusicConfig: { musicVideoType: 'MUSIC_VIDEO_TYPE_PODCAST_EPISODE' } } } },
  title: { runs: [{ text: "Manis Friedman: 'We can't remain strangers to God'" }] },
  subtitle: { runs: [{ text: '1.6K views' }, { text: ' • ' }] },
  thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/ZiLVylXYU44/hq720.jpg', width: 720 }] } } },
  playbackProgress: { musicPlaybackProgressRenderer: { durationText: { runs: [{ text: ' • ' }, { text: '1 hr 26 min' }] } } },
};
const show = {
  title: { runs: [{ text: '18 Questions, 40 Jewish Mystics' }] },
  subtitle: { runs: [{ text: '18Forty', navigationEndpoint: { browseEndpoint: { browseId: 'UCp3HDDoqMXaNOCkqKz7EjiQ', browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_USER_CHANNEL' } } } } }] },
  navigationEndpoint: { browseEndpoint: { browseId: 'MPSPPLF6IVQZ92dcatTFMClxZF-FDyZvSX98G3', browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_PODCAST_SHOW_DETAIL_PAGE' } } } },
  thumbnailRenderer: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/pl_c/x.jpg', width: 400 }] } } },
};
const shelf = (title, item) => ({ musicCarouselShelfRenderer: { header: { musicCarouselShelfBasicHeaderRenderer: { title: { runs: [{ text: title }] } } }, contents: [item] } });

test('podcast lengths in words', () => {
  assert.strictEqual(wordsToSeconds('26 min'), 1560);
  assert.strictEqual(wordsToSeconds('1 hr 5 min'), 3900);
  assert.strictEqual(wordsToSeconds('45 sec'), 45);
  assert.strictEqual(wordsToSeconds('3:05'), 185);
  assert.strictEqual(wordsToSeconds('Played'), null);
});

test('an episode is a playable podcast song by the channel', () => {
  const s = parseMultiRow(episode, { artists: [{ id: 'UCp3HDDoqMXaNOCkqKz7EjiQ', name: '18Forty' }] });
  assert.deepStrictEqual([s.type, s.id, s.isPodcast, s.duration, s.artists[0].id], ['song', 'ZiLVylXYU44', true, 5160, 'UCp3HDDoqMXaNOCkqKz7EjiQ']);
});

test('a podcast show card opens its episodes', () => {
  const p = parseTwoRow(show);
  assert.deepStrictEqual([p.type, p.id, p.author.id, p.isPodcast], ['playlist', 'MPSPPLF6IVQZ92dcatTFMClxZF-FDyZvSX98G3', 'UCp3HDDoqMXaNOCkqKz7EjiQ', true]);
});

test('a podcast channel page shows its latest episodes and its shows', () => {
  const json = { header: { musicImmersiveHeaderRenderer: { title: { runs: [{ text: '18Forty' }] } } }, contents: { singleColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [
    shelf('Latest episodes', { musicMultiRowListItemRenderer: episode }), shelf('Podcasts', { musicTwoRowItemRenderer: show }),
  ] } } } }] } } };
  const page = parseArtist(json, 'UCp3HDDoqMXaNOCkqKz7EjiQ');
  assert.deepStrictEqual(page.sections.map((s) => [s.title, s.items.length]), [['Latest episodes', 1], ['Podcasts', 1]]);
  assert.strictEqual(page.sections[0].items[0].artists[0].name, '18Forty');
});
