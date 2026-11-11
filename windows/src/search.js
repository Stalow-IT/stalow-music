'use strict';
// Search: YouTube Music's general results plus each category, merged and filtered by the approved list.
// The general search alone already works when a category search comes back empty.

const SECTIONS = [
  ['songs', 'song'], ['albums', 'album'], ['artists', 'artist'], ['playlists', 'playlist'],
];

const MIN_PLAYLIST_SONGS = 15;
const MAX_PLAYLIST_CHECKS = 20;
const counts = new Map(); // playlist id -> { approved, total } (remembered while the app runs)

/**
 * Lists only playlists with at least 15 songs by approved artists (checked in parallel). On an approved artist's own
 * page ([ownPage]), a smaller playlist is kept when every item in it is approved - e.g. a label's own collections.
 */
async function keepFullPlaylists(api, catalog, playlists, ownPage = false) {
  const checked = await Promise.all(playlists.slice(0, MAX_PLAYLIST_CHECKS).map(async (p) => {
    if (!counts.has(p.id)) {
      try {
        const page = await api.playlist(p.id);
        counts.set(p.id, { approved: page.songs.filter((s) => catalog.songAllowed(s)).length, total: page.songs.length });
      } catch (e) { return [p, null]; } // not remembered: checked again next time
    }
    return [p, counts.get(p.id)];
  }));
  return checked.filter(([, c]) => c && (c.approved >= MIN_PLAYLIST_SONGS || (ownPage && c.total > 0 && c.approved === c.total))).map(([p]) => p);
}

async function searchAll(api, catalog, query) {
  const q = (query || '').trim();
  if (!q) return { songs: [], albums: [], artists: [], playlists: [] };
  // "mbd", "fried", "מרדכי בן דוד"...: also search by the approved artist's full name
  const matched = catalog.matchArtists(q, 8);
  const expanded = matched[0] && matched[0].title.toLowerCase() !== q.toLowerCase() ? matched[0].title : null;
  const run = (text) => [api.search(text, null).catch(() => [])].concat(SECTIONS.map(([, type]) => api.search(text, type).catch(() => [])));
  const jobs = run(q).concat(expanded ? run(expanded) : []);
  const res = await Promise.all(jobs);
  const n = SECTIONS.length + 1;
  const [general, ...byType] = res.slice(0, n);
  const extra = res.slice(n).flat();
  const all = catalog.filterItems([...extra, ...byType.flat(), ...general]);
  const out = {};
  for (const [key, type] of SECTIONS) out[key] = all.filter((x) => x.type === type);
  out.playlists = await keepFullPlaylists(api, catalog, out.playlists);
  const ids = new Set(matched.map((a) => a.id));
  out.artists = [...matched, ...out.artists.filter((a) => !ids.has(a.id))];
  return out;
}

module.exports = { searchAll, keepFullPlaylists, MIN_PLAYLIST_SONGS };
