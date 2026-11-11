'use strict';
// The approved-artist list and the content rules. Same list and same rules as the Android app.
const fs = require('fs');
const path = require('path');
const { ArtistMatcher } = require('./matcher');

function loadArtists(file = path.join(__dirname, '..', 'data', 'artists.json')) {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const artists = (json.artists || []).filter((a) => a && typeof a.id === 'string' && a.id.startsWith('UC') && a.name);
  if (!artists.length) throw new Error('The approved artist list is empty');
  return { version: json.version || 0, artists };
}

class Catalog {
  constructor(list, { allowFemale = false, blockPodcasts = false } = {}) {
    this.version = list.version;
    this.artists = list.artists;
    this.blockPodcasts = !!blockPodcasts;
    this.setAllowFemale(allowFemale);
  }

  /** Content filters (Settings > Content): podcast episodes can be hidden everywhere. */
  setFilters({ blockPodcasts } = {}) {
    if (blockPodcasts !== undefined) this.blockPodcasts = !!blockPodcasts;
  }

  setAllowFemale(allow) {
    this.allowFemale = !!allow;
    this.allowed = new Map(this.artists.filter((a) => this.allowFemale || !a.isFemale).map((a) => [a.id, a]));
    this.matcher = new ArtistMatcher([...this.allowed.values()].map((a) => ({ id: a.id, names: [a.name, a.altName].filter(Boolean) })));
  }

  /** Approved artists the text refers to: nicknames ("mbd"), initials, loose or Hebrew spellings, typos. */
  matchArtists(text, limit = 8) {
    return this.matcher.match(text, limit).map((e) => this.allowed.get(e.id))
      .map((a) => ({ type: 'artist', id: a.id, title: a.name, thumbnail: a.thumbnail || '' }));
  }

  isApprovedArtist(id) { return !!id && this.allowed.has(id); }

  /** A song/video passes when ANY credited artist is approved; with no credits, the page's artist stands in. */
  songAllowed(song, fallbackArtistId = null) {
    if (this.blockPodcasts && song && song.isPodcast) return false;
    const ids = (song.artists || []).map((a) => a.id).filter(Boolean);
    if (!ids.length) return this.isApprovedArtist(fallbackArtistId);
    return ids.some((id) => this.isApprovedArtist(id));
  }

  albumAllowed(album, fallbackArtistId = null) { return this.songAllowed(album, fallbackArtistId); }

  /** Filters a mixed list. Playlists by others are kept, but without their cover unless the author is approved. */
  filterItems(items, fallbackArtistId = null) {
    const out = [];
    const seen = new Set();
    for (const it of items || []) {
      if (!it || seen.has(it.type + it.id)) continue;
      let keep = null;
      if (it.type === 'song') keep = this.songAllowed(it, fallbackArtistId) ? it : null;
      else if (it.type === 'album') keep = this.albumAllowed(it, fallbackArtistId) ? it : null;
      else if (it.type === 'artist') keep = this.isApprovedArtist(it.id) ? it : null;
      else if (it.type === 'playlist') keep = this.isApprovedArtist(it.author && it.author.id) ? it : { ...it, thumbnail: '' };
      if (keep) { seen.add(it.type + it.id); out.push(keep); }
    }
    return out;
  }

  /** Approved artists whose name contains the text (for the Artists page and suggestions). */
  findArtists(text, limit = Infinity) {
    const q = (text || '').trim().toLowerCase();
    const list = [...this.allowed.values()];
    const hits = q ? list.filter((a) => a.name.toLowerCase().includes(q)) : list;
    return hits.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })).slice(0, limit)
      .map((a) => ({ type: 'artist', id: a.id, title: a.name, thumbnail: a.thumbnail || '' }));
  }

  /** The approved artists among [ids], in the same order (unknown or unapproved ids are skipped). */
  artistsByIds(ids) {
    const seen = new Set();
    return (Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string' && this.allowed.has(id) && !seen.has(id) && seen.add(id))
      .map((id) => { const a = this.allowed.get(id); return { type: 'artist', id: a.id, title: a.name, thumbnail: a.thumbnail || '' }; });
  }

  /** Welcome page: the recently played artists first (most recent first), then random approved artists up to [n]. */
  homeArtists(recentIds, n) {
    const recent = this.artistsByIds(recentIds).slice(0, n);
    const have = new Set(recent.map((a) => a.id));
    return recent.concat(this.randomArtists(n + recent.length).filter((a) => !have.has(a.id)).slice(0, n - recent.length));
  }

  randomArtists(n) {
    const list = [...this.allowed.values()].filter((a) => !a.isKids);
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    return list.slice(0, n).map((a) => ({ type: 'artist', id: a.id, title: a.name, thumbnail: a.thumbnail || '' }));
  }
}

module.exports = { loadArtists, Catalog };
