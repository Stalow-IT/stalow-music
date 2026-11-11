'use strict';
// Stalow Music for Windows settings: the same settings as the Android app where they make sense on a computer,
// with the same defaults (exceptions are noted). Every value is checked before it is stored, so a broken or
// hand-edited settings file, or a backup from another version, can never put the app in a bad state.

const { PROVIDERS, normalizeProviders } = require('./lyrics');

const oneOf = (...values) => (v) => (values.includes(v) ? v : undefined);
const bool = (v) => (typeof v === 'boolean' ? v : undefined);
const num = (min, max) => (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined);

/** key -> [default, check]. The check returns the cleaned value, or undefined to reject it. */
const SCHEMA = {
  // Appearance
  theme: ['dark', oneOf('dark', 'light', 'black', 'system')],
  palette: ['stalow', oneOf('stalow', 'mint', 'sky', 'violet', 'rose', 'amber')],
  cropAlbumArt: [true, bool],
  hideAlbumArt: [false, bool],
  showRecentlyPlayed: [true, bool],
  showGenres: [true, bool],
  startPage: ['home', oneOf('home', 'search', 'artists', 'queue')],
  // Player & audio
  audioQuality: ['auto', oneOf('auto', 'high', 'low')],
  audioNormalization: [true, bool],
  skipSilence: [false, bool], // Android: on. Off here because Windows trims silence by speeding it up (new behaviour).
  persistentQueue: [true, bool],
  autoLoadMore: [true, bool],
  disableLoadMoreWhenRepeatAll: [false, bool],
  autoSkipNextOnError: [true, bool], // Android: off. On here: the Windows app has always moved on after a failed song.
  progressiveSeek: [false, bool],
  shuffle: [false, bool],
  repeat: ['off', oneOf('off', 'all', 'one')],
  volume: [1, num(0, 1)],
  // Lyrics
  showLyrics: [true, bool],
  lyricsProviders: [PROVIDERS.map((name) => ({ name, enabled: true })), (v) => (Array.isArray(v) ? normalizeProviders(v) : undefined)],
  lyricsPosition: ['center', oneOf('left', 'center', 'right')],
  lyricsWordSync: [true, bool],
  lyricsAutoScroll: [true, bool],
  lyricsOffsetMs: [0, (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(5000, Math.max(-5000, v)) / 50) * 50 : undefined)],
  // Content
  language: ['system', oneOf('system', 'en', 'iw')], // the languages the Android app is translated into
  allowFemale: [false, bool],
  blockPodcasts: [false, bool],
  blockVideos: [false, bool],
  // Privacy
  pauseListenHistory: [false, bool],
  pauseSearchHistory: [false, bool],
  historyDays: [30, (v) => ([7, 30, 90, 365, 0].includes(v) ? v : undefined)], // 0 = keep everything
  // Storage
  maxCacheMB: [512, (v) => ([128, 256, 512, 1024, 2048, 4096].includes(v) ? v : undefined)],
};

const DEFAULTS = Object.fromEntries(Object.entries(SCHEMA).map(([k, [d]]) => [k, d]));

/** The cleaned value for a key, or undefined when the key is unknown or the value is not allowed. */
function clean(key, value) {
  const entry = SCHEMA[key];
  return entry ? entry[1](value) : undefined;
}

/** A full settings object from anything (a stored file, a backup): unknown keys dropped, bad values defaulted. */
function normalize(raw) {
  const out = { ...DEFAULTS };
  if (raw && typeof raw === 'object') {
    for (const key of Object.keys(SCHEMA)) {
      if (!(key in raw)) continue;
      const v = clean(key, raw[key]);
      if (v !== undefined) out[key] = v;
    }
  }
  return out;
}

/** The YouTube Music language (hl) for a language setting; "system" follows Windows. */
function contentLanguage(setting, systemLocale = 'en') {
  if (setting && setting !== 'system') return setting;
  const l = String(systemLocale || 'en').toLowerCase();
  if (l.startsWith('he') || l.startsWith('iw')) return 'iw';
  if (l.startsWith('yi') || l.startsWith('ji')) return 'yi';
  if (l.startsWith('fr')) return 'fr';
  return 'en';
}

module.exports = { SCHEMA, DEFAULTS, clean, normalize, contentLanguage };
