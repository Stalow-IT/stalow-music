'use strict';
// Lyrics for the song that is playing, from the same providers as the Android app, in the user's order:
//   SimpMusic  - keyed by the exact YouTube video id (synced only when the durations match within 1 s)
//   LrcLib     - community database; used only when title AND artist match (and the duration, within 3 s)
//   YouTube    - YouTube Music's own lyrics tab (plain text, lower trust)
// The first synced result wins; otherwise the first plain one.

const PROVIDERS = ['SimpMusic', 'LrcLib', 'YouTube'];
const UA = 'StalowMusic/1.0 (Windows)';

/** "[01:02.50]" -> 62.5 */
function lrcTime(m, s) { return Number(m) * 60 + Number(s); }

/**
 * Parses LRC text (also "enhanced" LRC with <mm:ss.xx> word tags) into
 * { synced, lines: [{ time, text, words: [{ time, text }] | null }] }. Plain text gives time = null lines.
 */
function parseLrc(text) {
  const out = [];
  let synced = false;
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const tags = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)\]/g)];
    if (/^\s*\[(ar|ti|al|by|offset|length|re|ve):/i.test(raw)) continue; // metadata tags
    let body = raw.replace(/\[(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)\]/g, '');
    let words = null;
    const wordTags = [...body.matchAll(/<(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)>([^<]*)/g)];
    if (wordTags.length) {
      words = wordTags.map((w) => ({ time: lrcTime(w[1], w[2]), text: w[3] })).filter((w) => w.text.length);
      body = wordTags.map((w) => w[3]).join('');
    }
    body = body.replace(/\s+/g, ' ').trim();
    if (tags.length) {
      synced = true;
      for (const t of tags) out.push({ time: lrcTime(t[1], t[2]), text: body, words });
    } else if (body || out.length) {
      out.push({ time: null, text: body, words: null });
    }
  }
  if (synced) {
    const lines = out.filter((l) => l.time !== null).sort((a, b) => a.time - b.time);
    return { synced: true, lines };
  }
  while (out.length && !out[out.length - 1].text) out.pop();
  return { synced: false, lines: out };
}

// ---------- matching (same rules as the Android app's LrcLib provider) ----------
const clean = (s) => String(s || '').toLowerCase()
  .replace(/\(.*?\)|\[.*?\]/g, ' ')
  .replace(/\b(official|video|audio|lyrics?|live|remastered|hd|hq|music|clip)\b/g, ' ')
  .replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();

function levenshtein(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

function similarity(x, y) {
  const a = clean(x); const b = clean(y);
  if (a === b) return 1;
  if (!a || !b) return 0;
  if (a.includes(b) || b.includes(a)) return 0.8;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

const credited = (artist) => String(artist || '').split(/,|&| x |\bfeat\.?|\bft\.?|\bwith\b/i).map((s) => s.trim()).filter(Boolean);

/** An LrcLib track may be used only when the title and one credited artist both match (and the duration, within 3 s). */
function identityMatches(track, want) {
  const t = similarity(want.title, track.trackName);
  const a = Math.max(0, ...credited(want.artist).map((x) => similarity(x, track.artistName)));
  const d = !want.duration || Math.abs(Math.round(track.duration || 0) - want.duration) <= 3;
  return t >= 0.75 && a >= 0.75 && d;
}

// ---------- providers ----------
async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': UA } });
  if (!res.ok) return null;
  return res.json();
}

async function simpMusic(want, fetchImpl) {
  const json = await getJson('https://api-lyrics.simpmusic.org/v1/' + encodeURIComponent(want.videoId), fetchImpl);
  if (!json || json.type !== 'success' || !Array.isArray(json.data)) return null;
  const same = json.data.filter((t) => want.duration && t.durationSeconds && Math.abs(t.durationSeconds - want.duration) <= 5)
    .sort((a, b) => Math.abs(a.durationSeconds - want.duration) - Math.abs(b.durationSeconds - want.duration));
  const best = same[0];
  if (!best) return null;
  const syncOk = Math.abs(best.durationSeconds - want.duration) <= 1;
  const body = (syncOk && (best.richSyncLyrics || best.syncedLyrics)) || best.plainLyric;
  return body ? parseLrc(body) : null;
}

async function lrcLib(want, fetchImpl) {
  const q = new URLSearchParams({ track_name: want.title, artist_name: credited(want.artist)[0] || want.artist });
  let tracks = await getJson('https://lrclib.net/api/search?' + q, fetchImpl);
  if (!Array.isArray(tracks) || !tracks.length) tracks = await getJson('https://lrclib.net/api/search?' + new URLSearchParams({ q: `${want.artist} ${want.title}` }), fetchImpl);
  const candidates = (Array.isArray(tracks) ? tracks : []).filter((t) => identityMatches(t, want));
  const synced = candidates.find((t) => t.syncedLyrics && (!want.duration || Math.abs(Math.round(t.duration) - want.duration) <= 1));
  if (synced) return parseLrc(synced.syncedLyrics);
  const plain = candidates.find((t) => t.plainLyrics && t.plainLyrics.trim());
  return plain ? parseLrc(plain.plainLyrics) : null;
}

async function youTube(want, _fetchImpl, api) {
  if (!api || !api.lyrics) return null;
  const text = await api.lyrics(want.videoId);
  return text ? parseLrc(text) : null;
}

const IMPL = { SimpMusic: simpMusic, LrcLib: lrcLib, YouTube: youTube };

/** The user's provider list: known names only, each once; an empty or broken setting means the default order. */
function normalizeProviders(list) {
  if (!Array.isArray(list)) return PROVIDERS.map((name) => ({ name, enabled: true }));
  const seen = new Set();
  const out = list.filter((p) => p && IMPL[p.name] && !seen.has(p.name) && seen.add(p.name)).map((p) => ({ name: p.name, enabled: p.enabled !== false }));
  for (const name of PROVIDERS) if (!seen.has(name)) out.push({ name, enabled: true });
  return out;
}

/**
 * want: { videoId, title, artist, album, duration (s) }. Returns { source, synced, lines } or null.
 * Tries the enabled providers in order; the first synced answer wins, else the first plain one.
 */
async function getLyrics(want, providers, { fetchImpl = fetch, api = null } = {}) {
  let plain = null;
  for (const p of normalizeProviders(providers)) {
    if (!p.enabled) continue;
    let r = null;
    try { r = await IMPL[p.name](want, fetchImpl, api); } catch { r = null; }
    if (!r || !r.lines.length) continue;
    if (r.synced) return { source: p.name, ...r };
    if (!plain) plain = { source: p.name, ...r };
  }
  return plain;
}

module.exports = { PROVIDERS, parseLrc, identityMatches, normalizeProviders, getLyrics };
