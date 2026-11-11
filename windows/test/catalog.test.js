'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadArtists, Catalog } = require('../src/catalog');
const { searchAll, keepFullPlaylists } = require('../src/search');

const list = { version: 1, artists: [
  { id: 'UCaaaaaaaaaaaaaaaaaaaaaa', name: 'Avraham Fried' },
  { id: 'UCbbbbbbbbbbbbbbbbbbbbbb', name: 'Bracha Example', isFemale: true },
] };

test('the shared artist list loads with real channel ids', () => {
  const l = loadArtists(path.join(__dirname, '..', 'data', 'artists.json'));
  assert.ok(l.version >= 1);
  assert.ok(l.artists.length > 1000);
  assert.ok(l.artists.every((a) => /^UC[\w-]{22}$/.test(a.id)));
});

test('songs pass only with an approved artist; women singers only when allowed', () => {
  const c = new Catalog(list);
  assert.ok(c.songAllowed({ artists: [{ id: 'UCzz' }, { id: 'UCaaaaaaaaaaaaaaaaaaaaaa' }] }));
  assert.ok(!c.songAllowed({ artists: [{ id: 'UCzz' }] }));
  assert.ok(!c.songAllowed({ artists: [{ id: 'UCbbbbbbbbbbbbbbbbbbbbbb' }] }));
  c.setAllowFemale(true);
  assert.ok(c.songAllowed({ artists: [{ id: 'UCbbbbbbbbbbbbbbbbbbbbbb' }] }));
});

test('a song with no credits uses the page artist', () => {
  const c = new Catalog(list);
  assert.ok(c.songAllowed({ artists: [] }, 'UCaaaaaaaaaaaaaaaaaaaaaa'));
  assert.ok(!c.songAllowed({ artists: [] }, null));
});

test('other people\'s playlists are kept without their cover, unapproved artists are dropped', () => {
  const c = new Catalog(list);
  const out = c.filterItems([
    { type: 'playlist', id: 'p1', title: 'x', author: { id: 'UCzz' }, thumbnail: 'https://img' },
    { type: 'playlist', id: 'p2', title: 'y', author: { id: 'UCaaaaaaaaaaaaaaaaaaaaaa' }, thumbnail: 'https://img2' },
    { type: 'artist', id: 'UCzz', title: 'Someone' },
    { type: 'artist', id: 'UCaaaaaaaaaaaaaaaaaaaaaa', title: 'Avraham Fried' },
  ]);
  assert.deepStrictEqual(out.map((x) => [x.id, x.thumbnail || '']), [['p1', ''], ['p2', 'https://img2'], ['UCaaaaaaaaaaaaaaaaaaaaaa', '']]);
});

test('search merges the general and category results, filters them and survives failed categories', async () => {
  const c = new Catalog(list);
  const api = { search: async (q, type) => {
    if (type === 'album') throw new Error('down');
    if (!type) return [{ type: 'song', id: 's1', title: 'Good', artists: [{ id: 'UCaaaaaaaaaaaaaaaaaaaaaa' }] }, { type: 'song', id: 's2', title: 'Other', artists: [{ id: 'UCzz' }] }];
    if (type === 'song') return [{ type: 'song', id: 's1', title: 'Good', artists: [{ id: 'UCaaaaaaaaaaaaaaaaaaaaaa' }] }];
    return [];
  } };
  const r = await searchAll(api, c, 'fried');
  assert.deepStrictEqual(r.songs.map((s) => s.id), ['s1']);
  assert.deepStrictEqual(r.artists.map((a) => a.id), ['UCaaaaaaaaaaaaaaaaaaaaaa']);
});

test('playlists with fewer than 15 approved songs are not listed', async () => {
  const c = new Catalog(list);
  const ok = { id: 'UCaaaaaaaaaaaaaaaaaaaaaa' };
  const songs = (n, artist) => Array.from({ length: n }, (_, i) => ({ type: 'song', id: 's' + i, artists: [artist] }));
  const api = { playlist: async (id) => ({ songs: id === 'full' ? songs(15, ok) : id === 'mixed' ? [...songs(14, ok), ...songs(30, { id: 'UCzz' })] : [] }) };
  const out = await keepFullPlaylists(api, c, [{ id: 'full' }, { id: 'mixed' }, { id: 'empty' }]);
  assert.deepStrictEqual(out.map((p) => p.id), ['full']);
});

test('an approved artist\'s own small collections stay on their page', async () => {
  const c = new Catalog(list);
  const ok = { id: 'UCaaaaaaaaaaaaaaaaaaaaaa' };
  const api = { playlist: async (id) => ({ songs: id === 'own4' ? Array.from({ length: 4 }, (_, i) => ({ id: 'o' + i, artists: [ok] })) : [{ id: 'x', artists: [ok] }, { id: 'y', artists: [{ id: 'UCzz' }] }] }) };
  assert.deepStrictEqual((await keepFullPlaylists(api, c, [{ id: 'own4' }, { id: 'mixed2' }], true)).map((p) => p.id), ['own4']);
  assert.deepStrictEqual((await keepFullPlaylists(api, c, [{ id: 'own4' }], false)).map((p) => p.id), []);
});

test('Welcome lists recently played artists first, then others; unapproved ids are skipped', () => {
  const c = new Catalog(loadArtists(path.join(__dirname, '..', 'data', 'artists.json')));
  const all = c.findArtists('');
  const [a, b] = [all[5].id, all[9].id];
  const home = c.homeArtists([b, 'UCnotapproved', a, b], 18);
  assert.strictEqual(home.length, 18);
  assert.deepStrictEqual(home.slice(0, 2).map((x) => x.id), [b, a]);
  assert.strictEqual(new Set(home.map((x) => x.id)).size, 18);
  assert.strictEqual(c.homeArtists([], 18).length, 18);
});
