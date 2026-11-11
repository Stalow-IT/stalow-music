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

const CHANNEL_CATEGORIES = ['podcasts', 'shiurim', 'videos'];

/** The approved Podcasts, Shiurim and Videos channels (same file as the Android app). A channel can be in several. */
function loadChannels(file = path.join(__dirname, '..', 'data', 'channels.json')) {
  let json = {};
  try { json = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { json = {}; }
  const out = { version: json.version || 0 };
  for (const c of CHANNEL_CATEGORIES) {
    out[c] = (Array.isArray(json[c]) ? json[c] : []).filter((x) => x && typeof x.id === 'string' && x.id.startsWith('UC') && x.name);
  }
  return out;
}

class Catalog {
  constructor(list, { allowFemale = false, channels = null } = {}) {
    this.version = list.version;
    this.artists = list.artists;
    this.channelLists = channels || { version: 0, podcasts: [], shiurim: [], videos: [] };
    this.setAllowFemale(allowFemale);
  }

  setAllowFemale(allow) {
    this.allowFemale = !!allow;
    this.allowed = new Map(this.artists.filter((a) => this.allowFemale || !a.isFemale).map((a) => [a.id, a]));
    this.matcher = new ArtistMatcher([...this.allowed.values()].map((a) => ({ id: a.id, names: [a.name, a.altName].filter(Boolean) })));
    this.channels = new Map();
    for (const c of CHANNEL_CATEGORIES) {
      for (const ch of this.channelLists[c] || []) {
        if ((this.allowFemale || !ch.isFemale) && !this.channels.has(ch.id)) this.channels.set(ch.id, ch);
      }
    }
  }

  /** An approved Podcasts, Shiurim or Videos channel: it vouches for its own uploads. */
  isApprovedChannel(id) { return !!id && this.channels.has(id); }

  /** One category's approved channels whose name contains the text, A to Z, as cards. */
  channelList(category, text = '') {
    const q = (text || '').trim().toLowerCase();
    return (this.channelLists[category] || []).filter((ch) => this.channels.has(ch.id))
      .filter((ch) => !q || ch.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
      .map((ch) => ({ type: 'artist', id: ch.id, title: ch.name, thumbnail: ch.thumbnailUrl || '', subtitle: 'Channel' }));
  }

  /** An artist page or a channel page may be opened. */
  canOpen(id) { return this.isApprovedArtist(id) || this.isApprovedChannel(id); }

  /** Approved artists the text refers to: nicknames ("mbd"), initials, loose or Hebrew spellings, typos. */
  matchArtists(text, limit = 8) {
    return this.matcher.match(text, limit).map((e) => this.allowed.get(e.id))
      .map((a) => ({ type: 'artist', id: a.id, title: a.name, thumbnail: a.thumbnail || '' }));
  }

  isApprovedArtist(id) { return !!id && this.allowed.has(id); }

  /** A song/video passes when ANY credited artist is approved; with no credits, the page's artist stands in. */
  songAllowed(song, fallbackArtistId = null) {
    const ids = (song.artists || []).map((a) => a.id).filter(Boolean);
    if (!ids.length) return this.canOpen(fallbackArtistId);
    return ids.some((id) => this.canOpen(id)) || this.isApprovedChannel(fallbackArtistId);
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
      else if (it.type === 'artist') keep = this.canOpen(it.id) ? it : null;
      else if (it.type === 'playlist') keep = this.canOpen(it.author && it.author.id) ? it : { ...it, thumbnail: '' };
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

module.exports = { loadArtists, loadChannels, Catalog };
