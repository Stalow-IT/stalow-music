'use strict';
/* global stalow, icon, t, setLanguage */
// Stalow Music for Windows: playback, queue, history and the browsing pages. Settings pages are in
// settings-view.js, the Now playing page (with lyrics) in nowplaying.js; start.js starts the app.
const $ = (sel) => document.querySelector(sel);
const view = $('#view');

// ---------- settings (stored by the main process; see src/settings.js for the list and defaults) ----------
let S = {};
const HOME_GENRES = ['Chassidish', 'Wedding', 'Kumzits', 'Acapella', 'Shabbos', 'Children', 'Instrumental', 'Cantorial', 'Yiddish', 'Mizrachi'];

/** Changes one setting: stored by the main process, then applied here. */
async function setSetting(key, value) {
  const stored = await stalow.setSetting(key, value);
  S[key] = stored;
  applySetting(key);
  return stored;
}

/** Applies a renderer-side setting (theme, palette, art, language, history, queue...). */
function applySetting(key) {
  const root = document.documentElement;
  if (!key || key === 'theme') {
    const sys = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    root.dataset.theme = S.theme === 'system' ? sys : S.theme;
  }
  if (!key || key === 'palette') root.dataset.palette = S.palette;
  if (!key || key === 'cropAlbumArt') root.dataset.crop = String(!!S.cropAlbumArt);
  if (!key || key === 'language') { setLanguage(S.language, S.systemLocale); translateStatic(); }
  if (key === 'hideAlbumArt' || key === 'blockVideos') { renderNowBar(); rerender(); }
  if (key === 'historyDays') pruneHistory();
  if (key === 'persistentQueue') { if (S.persistentQueue) saveSession(Number($('#seek').value)); else stalow.saveSession({ queue: [] }).catch(() => {}); }
  if (key === 'shuffle' || key === 'repeat' || !key) renderToggles();
}
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (S.theme === 'system') applySetting('theme'); });

/** Texts written in index.html, translated, and the icons drawn. */
function translateStatic() {
  document.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.dataset.i18n); });
  document.querySelectorAll('[data-icon]').forEach((n) => { if (!n.querySelector('svg')) n.prepend(icon(n.dataset.icon)); });
  $('#btn-back').replaceChildren(icon('back'), document.createTextNode(' ' + t('back')));
  for (const [id, key] of [['btn-prev', 'previous'], ['btn-next', 'next'], ['btn-shuffle', 'shuffle'], ['btn-now', 'now_playing']]) { $('#' + id).title = t(key); $('#' + id).setAttribute('aria-label', t(key)); }
  $('#seek').setAttribute('aria-label', t('position')); $('#vol').setAttribute('aria-label', t('volume'));
  renderToggles(); renderPlayButton();
  if (state.index < 0) $('#np-title').textContent = t('nothing_playing');
}

// ---------- small DOM helpers (text is always set with textContent) ----------
function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c) n.append(c);
  return n;
}
/**
 * A picture, or the first letter of [label] on a Stalow tile: when there is none, it fails to load, Settings
 * hides album art, or (Block videos) it is a video's frame.
 */
function img(src, label = '', { isVideo = false } = {}) {
  const ph = () => el('div', { class: 'ph', text: (String(label).trim()[0] || '♪').toUpperCase() });
  if (!src || S.hideAlbumArt || (isVideo && S.blockVideos)) return ph();
  const i = el('img', { src, alt: '', loading: 'lazy', class: 'art-img' });
  i.addEventListener('error', () => i.replaceWith(ph()));
  return i;
}
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const artistNames = (it) => (it.artists || []).map((a) => a.name).join(', ');
function status(text, isError) { view.replaceChildren(el('div', { class: 'status' + (isError ? ' error' : ''), text })); }
function sectionHead(title, onSeeAll) {
  return el('div', { class: 'section-head' }, el('h2', { text: title }), onSeeAll ? el('button', { class: 'link', text: t('see_all'), onclick: onSeeAll }) : '');
}

// ---------- queue + playback ----------
const state = { queue: [], index: -1, playing: false, radio: null, duration: 0, seeking: false, order: null, time: 0 };

// Playing never stops by itself (Settings > Auto load more songs): when the chosen songs run out, similar approved
// songs (YouTube Music's radio for the last song) are added, and when that radio runs out a new one starts.
const newRadio = (videoId) => (videoId ? { videoId, continuation: null, started: false } : null);
function playQueue(songs, start = 0, radioSeed = null) {
  state.queue = songs.slice();
  state.index = -1;
  state.order = null;
  state.radio = newRadio(radioSeed || (songs.length && songs[songs.length - 1].id));
  if (S.shuffle && songs.length > 1) {
    // shuffle on: the chosen song first, the rest in random order (the original order is kept for "shuffle off")
    state.order = songs.slice();
    const first = state.queue.splice(start, 1)[0];
    state.queue = [first, ...shuffled(state.queue)];
    start = 0;
  }
  playAt(start);
}
function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
/** Shuffle on: the songs after the current one are mixed. Off: they go back to their original order. */
function applyShuffleToQueue() {
  if (state.index < 0) return;
  const head = state.queue.slice(0, state.index + 1);
  const rest = state.queue.slice(state.index + 1);
  if (S.shuffle) {
    state.order = state.queue.slice();
    state.queue = head.concat(shuffled(rest));
  } else if (state.order) {
    const inHead = new Set(head.map((x) => x.id));
    const restIds = new Set(rest.map((x) => x.id));
    const ordered = state.order.filter((x) => restIds.has(x.id) && !inHead.has(x.id));
    const extra = rest.filter((x) => !state.order.some((o) => o.id === x.id));
    state.queue = head.concat(ordered, extra);
    state.order = null;
  }
  renderQueueIfOpen();
}

// ---------- the queue survives a restart or an update (Settings > Persistent queue) ----------
function saveSession(time) {
  if (!S.persistentQueue || state.index < 0 || !state.queue.length) return;
  const from = Math.max(0, state.index - 50); // the songs around the current one, so a long radio queue stays small
  const queue = state.queue.slice(from, from + 250).map((x) => ({ type: 'song', id: x.id, title: x.title, artists: x.artists || [], album: x.album || (x.albumName ? { id: '', title: x.albumName } : null), thumbnail: x.thumbnail || '', duration: x.duration || null }));
  const r = state.radio;
  stalow.saveSession({ queue, index: state.index - from, time: Math.floor(time || 0), radio: r ? { videoId: r.videoId, continuation: r.continuation, started: r.started } : null }).catch(() => {});
}
async function restoreSession() {
  let s = await stalow.loadSession().catch(() => null);
  if (!s) { try { s = JSON.parse(localStorage.getItem('stalow.session') || 'null'); } catch { s = null; } } // saved by 1.0.8
  const resume = !!(s && s.resume);
  if (!S.persistentQueue || !s || !Array.isArray(s.queue) || !s.queue.length) return;
  state.queue = s.queue.filter((x) => x && typeof x.id === 'string');
  if (!state.queue.length) return;
  const index = Math.min(Math.max(0, s.index | 0), state.queue.length - 1);
  state.radio = s.radio && s.radio.videoId ? { ...s.radio, busy: false } : newRadio(state.queue[state.queue.length - 1].id);
  state.index = index;
  state.pendingSeek = { id: state.queue[index].id, time: s.time || 0 };
  state.notLoaded = true; // the song is shown but not loaded in the player yet
  const cur = state.queue[index];
  renderNowBar();
  if (cur.duration) { $('#seek').max = Math.floor(cur.duration); $('#t-dur').textContent = fmt(cur.duration); }
  $('#seek').value = Math.floor(s.time || 0); $('#t-cur').textContent = fmt(s.time || 0);
  state.time = s.time || 0;
  if (resume) playAt(index);
}

// ---------- listen history (Settings > Privacy) ----------
let listenHistory = [];
async function loadHistory() {
  try { listenHistory = await stalow.getData('history'); } catch { listenHistory = []; }
  if (!Array.isArray(listenHistory) || !listenHistory.length) {
    // 1.0.7 - 1.0.9 kept recently played songs in browser storage: move them over once
    try { const old = JSON.parse(localStorage.getItem('stalow.recent') || '[]'); if (Array.isArray(old) && old.length) { listenHistory = old.map((x) => ({ ...x, playedAt: Date.now() })); stalow.setData('history', listenHistory).catch(() => {}); } localStorage.removeItem('stalow.recent'); } catch { /* none */ }
  }
  if (!Array.isArray(listenHistory)) listenHistory = [];
  pruneHistory();
}
function pruneHistory() {
  if (!S.historyDays) return;
  const cutoff = Date.now() - S.historyDays * 86400000;
  const kept = listenHistory.filter((x) => !x.playedAt || x.playedAt >= cutoff);
  if (kept.length !== listenHistory.length) { listenHistory = kept; stalow.setData('history', listenHistory).catch(() => {}); }
}
function rememberPlayed(song) {
  if (S.pauseListenHistory) return;
  const keep = { type: 'song', id: song.id, title: song.title, artists: song.artists || [], album: song.album || (song.albumName ? { id: '', title: song.albumName } : null), thumbnail: song.thumbnail || '', duration: song.duration || null, playedAt: Date.now() };
  listenHistory = [keep, ...listenHistory.filter((s) => s && s.id !== song.id)].slice(0, 500);
  stalow.setData('history', listenHistory).catch(() => {});
}
async function clearHistory() { listenHistory = []; await stalow.setData('history', []); }
/** Artist ids from the recently played songs, most recent first. */
function recentArtistIds() {
  const ids = [];
  for (const s of listenHistory) for (const a of (s.artists || [])) if (a && a.id && !ids.includes(a.id)) ids.push(a.id);
  return ids;
}

// ---------- search history ----------
let searches = [];
async function loadSearches() { try { searches = await stalow.getData('searchHistory'); } catch { searches = []; } if (!Array.isArray(searches)) searches = []; }
function rememberSearch(q) {
  if (S.pauseSearchHistory || !q) return;
  searches = [{ q, at: Date.now() }, ...searches.filter((x) => x.q.toLowerCase() !== q.toLowerCase())].slice(0, 50);
  stalow.setData('searchHistory', searches).catch(() => {});
}
function forgetSearch(q) { searches = searches.filter((x) => x.q !== q); stalow.setData('searchHistory', searches).catch(() => {}); }
async function clearSearches() { searches = []; await stalow.setData('searchHistory', []); }

function addToQueue(song) { state.queue.push(song); if (state.index < 0) playAt(state.queue.length - 1); renderQueueIfOpen(); }
async function playAt(i) {
  if (i < 0 || i >= state.queue.length) return;
  if (state.pendingSeek && state.pendingSeek.id !== state.queue[i].id) state.pendingSeek = null;
  state.notLoaded = false;
  state.index = i;
  state.time = 0;
  saveSession(state.pendingSeek ? state.pendingSeek.time : 0);
  const s = state.queue[i];
  renderNowBar();
  document.title = `${s.title} - Stalow Music`;
  clearTimeout(state.watchdog);
  // YouTube Music should start within ~25 s; if not, say so instead of waiting silently
  state.watchdog = setTimeout(() => playFailed(t('error_not_starting')), 25000);
  if (typeof onNowPlayingChanged === 'function') onNowPlayingChanged(); // eslint-disable-line no-undef
  try { await stalow.play(s.id); } catch (e) { playFailed(e.message); }
  renderQueueIfOpen();
  topUpRadio();
}
/** The player bar: picture, song name, and "Artist · Album" under it. */
function renderNowBar() {
  const s = state.queue[state.index];
  if (!s) { $('#np-art-box').replaceChildren(); $('#np-title').textContent = t('nothing_playing'); $('#np-artist').textContent = ''; return; }
  $('#np-art-box').replaceChildren(img(s.thumbnail, s.title, { isVideo: s.isVideo }));
  $('#np-title').textContent = s.title; $('#np-title').title = s.title || '';
  const line = nowLine(s);
  $('#np-artist').textContent = line; $('#np-artist').title = line;
}
function nowLine(song) {
  const album = (song.album && song.album.title) || song.albumName || '';
  return [artistNames(song), album].filter(Boolean).join(' · ');
}
function hideNotice() { const n = document.getElementById('play-notice'); if (n) n.remove(); }
/** A song failed. Settings > Auto skip to next on error decides whether the next one starts by itself. */
function playFailed(message) {
  clearTimeout(state.watchdog);
  state.failures = (state.failures || 0) + 1;
  hideNotice();
  const auto = S.autoSkipNextOnError && state.failures < 3;
  const box = el('div', { id: 'play-notice', class: 'notice' },
    el('span', { text: state.failures >= 3 ? t('error_songs_not_starting') : `${t('error_could_not_play')} (${message || t('error_unknown')}).${auto ? ' ' + t('trying_next') : ''}` }),
    el('div', { class: 'actions' },
      !auto ? el('button', { class: 'btn', text: t('next'), onclick: () => { hideNotice(); next(); } }) : '',
      el('button', { class: 'btn secondary', text: t('show_player'), onclick: () => stalow.togglePlayer() })));
  $('#main').prepend(box);
  if (auto) setTimeout(next, 2000);
}
/** The next song; at the end of the queue Repeat all and Auto load more decide what happens. */
function next() {
  if (state.index + 1 < state.queue.length) return playAt(state.index + 1);
  const loadMore = S.autoLoadMore && !(S.repeat === 'all' && S.disableLoadMoreWhenRepeatAll);
  if (loadMore) {
    const cur = state.queue[state.index];
    if (!state.radio && cur) state.radio = newRadio(cur.id); // the radio ran out: start a new one from this song
    return topUpRadio(true);
  }
  if (S.repeat === 'all' && state.queue.length) return playAt(0);
  stalow.pause();
}
function prev() { if (state.time > 3 || state.index <= 0) stalow.seek(0); else playAt(state.index - 1); }

/** Keeps a radio queue going with more approved songs (Settings > Auto load more songs). */
async function topUpRadio(playWhenAdded = false) {
  const r = state.radio;
  if (!S.autoLoadMore || (S.repeat === 'all' && S.disableLoadMoreWhenRepeatAll)) return;
  if (!r || state.queue.length - state.index > 3) return;
  if (r.busy) return; r.busy = true;
  try {
    const res = await stalow.radio(r.started ? null : r.videoId, r.started ? r.continuation : null);
    r.started = true; r.continuation = res.continuation;
    const have = new Set(state.queue.map((s) => s.id));
    const added = res.items.filter((s) => !have.has(s.id));
    const before = state.queue.length;
    state.queue.push(...(S.shuffle ? shuffled(added) : added));
    if (!res.continuation || !added.length) state.radio = null;
    renderQueueIfOpen();
    if (playWhenAdded) {
      if (state.queue.length > before) playAt(before);
      else if ((r.retries || 0) < 3 && state.queue.length) {
        // nothing new from this radio: try one started from another song in the queue
        const seed = state.queue[Math.floor(Math.random() * state.queue.length)];
        state.radio = { ...newRadio(seed.id), retries: (r.retries || 0) + 1 };
        r.busy = false;
        return topUpRadio(true);
      }
    }
  } catch (e) {
    console.warn('radio', e);
    // a saved radio can be out of date after a restart: start a fresh one from the song that is playing
    const cur = state.queue[state.index];
    if (state.radio === r && r.started && cur && (r.retries || 0) < 3) {
      state.radio = { ...newRadio(cur.id), retries: (r.retries || 0) + 1 };
      if (playWhenAdded) setTimeout(() => topUpRadio(true), 1000);
    }
  } finally { r.busy = false; }
}

stalow.onPlayer((ev) => {
  if (ev.action === 'next') return next();
  if (ev.action === 'previous') return prev();
  if (ev.action === 'play') return stalow.resume();
  if (ev.action === 'pause') return stalow.pause();
  // what the player is really doing, whichever song it reports: Pause must always be able to stop the sound
  if (ev.state === 'playing' || ev.state === 'paused') state.anyPlaying = ev.state === 'playing';
  const cur = state.queue[state.index];
  if (cur && ev.id && ev.id !== cur.id) return;
  if (ev.state === 'ended') {
    if (S.repeat === 'one' && cur) return playAt(state.index); // Repeat one: the same song again
    return next();
  }
  if (ev.state === 'error') return playFailed(ev.message);
  // the album name, from YouTube Music's player, when the list the song came from did not have it
  if (cur && ev.album && !(cur.album && cur.album.title) && cur.albumName !== ev.album) { cur.albumName = ev.album; renderNowBar(); }
  if (ev.state === 'playing' || ev.state === 'paused') {
    // a restored song continues where it stopped
    if (state.pendingSeek && cur && state.pendingSeek.id === cur.id && ev.state === 'playing') {
      const tm = state.pendingSeek.time; state.pendingSeek = null;
      if (tm > 3 && (!ev.duration || tm < ev.duration - 5)) stalow.seek(tm);
    }
    if (!state.lastSave || Date.now() - state.lastSave > 5000) { state.lastSave = Date.now(); saveSession(ev.time); }
  }
  if (ev.state === 'playing') {
    clearTimeout(state.watchdog); state.failures = 0; hideNotice();
    if (cur && state.remembered !== state.index + ':' + cur.id) { state.remembered = state.index + ':' + cur.id; rememberPlayed(cur); }
  }
  state.playing = ev.state === 'playing';
  renderPlayButton();
  if (typeof ev.time === 'number') state.time = ev.time;
  if (ev.duration && !state.seeking) {
    state.duration = ev.duration;
    $('#seek').max = Math.floor(ev.duration); $('#seek').value = Math.floor(ev.time || 0);
    $('#t-cur').textContent = fmt(ev.time); $('#t-dur').textContent = fmt(ev.duration);
  }
  if (typeof onPlayerTime === 'function') onPlayerTime(state.time); // eslint-disable-line no-undef
});

function renderPlayButton() {
  const b = $('#btn-play');
  b.replaceChildren(icon(state.playing ? 'pause' : 'play'));
  b.title = t(state.playing ? 'pause' : 'play'); b.setAttribute('aria-label', b.title);
}
function renderToggles() {
  const sh = $('#btn-shuffle');
  sh.classList.toggle('on', !!S.shuffle); sh.setAttribute('aria-pressed', String(!!S.shuffle));
  const rp = $('#btn-repeat');
  rp.classList.toggle('on', !!S.repeat && S.repeat !== 'off'); rp.setAttribute('aria-pressed', String(!!S.repeat && S.repeat !== 'off'));
  $('#repeat-badge').textContent = S.repeat === 'one' ? '1' : '';
  const label = t(S.repeat === 'one' ? 'repeat_mode_one' : S.repeat === 'all' ? 'repeat_mode_all' : 'repeat_mode_off');
  rp.title = label; rp.setAttribute('aria-label', label);
}

$('#btn-play').addEventListener('click', () => {
  if (state.index < 0) {
    // nothing chosen yet: say what to do instead of silently ignoring the press
    hideNotice();
    $('#main').prepend(el('div', { id: 'play-notice', class: 'notice' }, el('span', { text: t('choose_first') })));
    setTimeout(hideNotice, 4000);
    return;
  }
  if (state.notLoaded) return playAt(state.index); // a restored song: load it, it continues where it stopped
  if (state.playing || state.anyPlaying) { state.anyPlaying = false; stalow.pause(); } else stalow.resume();
});
$('#btn-next').addEventListener('click', next);
$('#btn-prev').addEventListener('click', prev);
$('#btn-shuffle').addEventListener('click', async () => { await setSetting('shuffle', !S.shuffle); applyShuffleToQueue(); });
$('#btn-repeat').addEventListener('click', () => setSetting('repeat', S.repeat === 'off' ? 'all' : S.repeat === 'all' ? 'one' : 'off'));
$('#btn-now').addEventListener('click', () => { if (state.index >= 0) go('nowplaying'); });
$('#seek').addEventListener('input', () => { state.seeking = true; $('#t-cur').textContent = fmt($('#seek').value); });
$('#seek').addEventListener('change', () => {
  if (state.pendingSeek) state.pendingSeek.time = Number($('#seek').value);
  state.time = Number($('#seek').value);
  stalow.seek(Number($('#seek').value)); state.seeking = false;
});
window.addEventListener('beforeunload', () => saveSession(Number($('#seek').value)));
$('#vol').addEventListener('input', () => stalow.volume(Number($('#vol').value)));

/** Keyboard: Space plays/pauses; Left/Right seek 5 s (Settings > Progressive seek: faster when pressed repeatedly). */
let seekStreak = { dir: 0, at: 0, n: 0 };
document.addEventListener('keydown', (e) => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  if (e.code === 'Space') { e.preventDefault(); $('#btn-play').click(); return; }
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.altKey && state.index >= 0 && !state.notLoaded) {
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const now = Date.now();
    seekStreak = S.progressiveSeek && seekStreak.dir === dir && now - seekStreak.at < 1000 ? { dir, at: now, n: seekStreak.n + 1 } : { dir, at: now, n: 1 };
    const step = 5 * (S.progressiveSeek ? seekStreak.n : 1);
    const target = Math.max(0, Math.min((state.duration || 1e9) - 1, state.time + dir * step));
    state.time = target;
    stalow.seek(target);
  }
});

// ---------- item rendering ----------
function songRows(songs, { onPlay } = {}) {
  return el('div', { class: 'rows' }, songs.map((s, i) => el('button', {
    class: 'row' + (state.queue[state.index] && state.queue[state.index].id === s.id ? ' playing' : ''),
    onclick: () => (onPlay ? onPlay(i) : playQueue(songs, i)),
  },
  el('span', { class: 'n', text: String(i + 1) }), img(s.thumbnail, s.title, { isVideo: s.isVideo }),
  el('div', { class: 'ellipsis' }, el('div', { class: 'rt ellipsis', text: s.title }), el('div', { class: 'muted ellipsis', text: artistNames(s) })),
  el('span', { class: 'd', text: s.duration ? fmt(s.duration) : '' }),
  el('span', { class: 'add', role: 'button', title: t('add_to_queue'), text: '+ ' + t('queue'), onclick: (e) => { e.stopPropagation(); addToQueue(s); } }))));
}
function cards(items) {
  return el('div', { class: 'grid' }, items.map((it) => el('button', {
    class: 'card' + (it.type === 'artist' ? ' round' : ''),
    onclick: () => open(it),
  }, img(it.thumbnail, it.title, { isVideo: it.isVideo }), el('div', { class: 't ellipsis', text: it.title }),
  el('div', { class: 's muted ellipsis', text: it.type === 'artist' ? t('artist') : it.type === 'album' ? [artistNames(it), it.year].filter(Boolean).join(' · ') || t('album') : it.type === 'playlist' ? t('playlist') : artistNames(it) }))));
}
function open(it) {
  // pass the card's picture along, used when the page itself has none
  if (it.type === 'artist') return go('artist', { id: it.id, thumbnail: it.thumbnail });
  if (it.type === 'album') return go('album', { id: it.id, thumbnail: it.thumbnail });
  if (it.type === 'playlist') return go('playlist', it.id);
  if (it.type === 'song') return playQueue([it], 0, it.id);
}
function approvedNote() {
  return el('div', { class: 'note' }, icon('shield'), el('span', { text: t('stalow_only_approved') }));
}

// ---------- views ----------
const views = {
  async home() {
    view.replaceChildren(el('h1', { text: t('welcome') }), el('div', { class: 'status', text: t('loading') }));
    const recentIds = recentArtistIds();
    const { artists } = await stalow.home(recentIds);
    const recent = S.showRecentlyPlayed ? listenHistory.slice(0, 12) : [];
    const played = artists.filter((a) => recentIds.includes(a.id)).length;
    view.replaceChildren(
      el('h1', { text: t('welcome') }),
      el('p', { class: 'muted', text: t('welcome_hint') }),
      recent.length ? sectionHead(t('keep_listening')) : '',
      recent.length ? cards(recent) : '',
      S.showGenres ? sectionHead(t('genres')) : '',
      S.showGenres ? el('div', { class: 'chips' }, HOME_GENRES.map((g) => el('button', { class: 'chip', text: g, onclick: () => go('search', g) }))) : '',
      sectionHead(played ? t('your_artists') : t('stalow_artists_for_you'), () => go('artists')), cards(artists),
      el('div', { class: 'actions' }, el('button', { class: 'btn secondary', text: t('show_other_artists'), onclick: () => views.home() })));
  },
  async search(q = '') {
    const box = el('input', { class: 'searchbox', type: 'search', placeholder: t('stalow_search_hint'), value: q });
    const results = el('div');
    const showHistory = () => {
      if (!searches.length || S.pauseSearchHistory) return results.replaceChildren(approvedNote());
      results.replaceChildren(sectionHead(t('search_history')),
        el('div', { class: 'chips' }, searches.slice(0, 20).map((x) => el('button', { class: 'chip', onclick: () => { box.value = x.q; run(); } }, x.q,
          el('span', { class: 'x', role: 'button', 'aria-label': t('remove'), text: '✕', onclick: (e) => { e.stopPropagation(); forgetSearch(x.q); showHistory(); } })))),
        approvedNote());
    };
    const run = async () => {
      const text = box.value.trim();
      if (!text) return showHistory();
      rememberSearch(text);
      results.replaceChildren(el('div', { class: 'status', text: t('searching') }));
      try {
        const r = await stalow.search(text);
        const parts = [];
        if (r.artists.length) {
          const top = r.artists[0];
          parts.push(el('h2', { class: 'overline', text: t('stalow_top_result') }),
            el('div', { class: 'group' }, el('button', { class: 'item category', onclick: () => open(top) },
              el('div', { class: 'grow' }, el('div', { class: 'top-pic' }, img(top.thumbnail, top.title)),
                el('div', {}, el('div', { class: 'it', text: top.title }), el('div', { class: 'id', text: t('stalow_top_result_artist', text) }))),
              el('span', { class: 'btn' }, icon('play'), t('play')))));
        }
        if (r.songs.length) parts.push(el('h2', { text: t('songs') }), songRows(r.songs.slice(0, 20), { onPlay: (i) => playQueue([r.songs[i]], 0, r.songs[i].id) }));
        if (r.artists.length) parts.push(el('h2', { text: t('artists') }), cards(r.artists.slice(0, 12)));
        if (r.albums.length) parts.push(el('h2', { text: t('albums') }), cards(r.albums.slice(0, 12)));
        if (r.playlists.length) parts.push(el('h2', { text: t('playlists') }), cards(r.playlists.slice(0, 12)));
        results.replaceChildren(...(parts.length ? parts : [el('div', { class: 'status', text: t('nothing_matched') })]), approvedNote());
      } catch (e) { results.replaceChildren(el('div', { class: 'status error', text: t('search_failed', e.message) })); }
    };
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
    box.addEventListener('input', () => { if (!box.value.trim()) showHistory(); });
    view.replaceChildren(el('h1', { text: t('search') }), box, results);
    box.focus();
    if (q) run(); else showHistory();
  },
  async artists() {
    const all = await stalow.artists('');
    const filter = el('input', { class: 'searchbox', type: 'search', placeholder: t('filter_artists_hint', all.length) });
    const list = el('div');
    const letters = [...new Set(all.map((a) => (a.title[0] || '#').toUpperCase()))];
    const show = (items) => list.replaceChildren(cards(items.slice(0, 300)), items.length > 300 ? el('p', { class: 'muted', text: t('showing_n_of', 300, items.length) }) : '');
    filter.addEventListener('input', () => { const q = filter.value.trim().toLowerCase(); show(all.filter((a) => a.title.toLowerCase().includes(q))); });
    view.replaceChildren(el('h1', { text: t('artists') }), filter,
      el('div', { class: 'letters' }, letters.map((L) => el('button', { text: L, onclick: () => show(all.filter((a) => (a.title[0] || '#').toUpperCase() === L)) }))), list);
    show(all);
  },
  async artist(arg) {
    const id = typeof arg === 'string' ? arg : arg.id;
    status(t('loading'));
    const p = await stalow.artist(id);
    if (p.notApproved) return status(t('artist_not_approved'));
    if (p.artist && !p.artist.thumbnail && arg.thumbnail) p.artist.thumbnail = arg.thumbnail;
    const songs = p.sections.flatMap((s) => s.items).filter((x) => x.type === 'song');
    view.replaceChildren(
      el('div', { class: 'head round' }, img(p.artist.thumbnail, p.artist.title), el('div', {},
        el('div', { class: 'overline', text: t('stalow_approved_artist') }), el('h1', { text: p.artist.title }),
        el('div', { class: 'actions' },
          songs.length ? el('button', { class: 'btn', title: t('shuffle'), onclick: () => playQueue(shuffled(songs), 0) }, icon('play'), t('play')) : '',
          songs.length ? el('button', { class: 'btn secondary', onclick: () => playQueue(shuffled(songs), 0) }, icon('shuffle'), t('shuffle')) : '',
          songs.length ? el('button', { class: 'btn secondary', onclick: () => playQueue([songs[0]], 0, songs[0].id) }, icon('radio'), t('radio')) : ''))),
      ...p.sections.flatMap((s) => {
        const sSongs = s.items.filter((x) => x.type === 'song');
        const others = s.items.filter((x) => x.type !== 'song');
        return [el('h2', { text: s.title || t('more') }), sSongs.length ? songRows(sSongs) : '', others.length ? cards(others) : ''];
      }),
      p.sections.length ? '' : el('div', { class: 'status', text: t('no_songs_for_artist') }));
  },
  async album(arg) {
    const id = typeof arg === 'string' ? arg : arg.id;
    status(t('loading'));
    const p = await stalow.album(id);
    if (p.notApproved) return status(t('album_not_approved'));
    if (!p.album.thumbnail) p.album.thumbnail = arg.thumbnail || (p.songs[0] && p.songs[0].thumbnail) || '';
    // album tracks often come without their own picture: show the album cover beside them
    p.songs = p.songs.map((s) => (s.thumbnail ? s : { ...s, thumbnail: p.album.thumbnail }));
    view.replaceChildren(
      el('div', { class: 'head' }, img(p.album.thumbnail, p.album.title), el('div', {}, el('div', { class: 'overline', text: t('album') }), el('h1', { text: p.album.title }), el('div', { class: 'muted', text: artistNames(p.album) }),
        el('div', { class: 'actions' }, el('button', { class: 'btn', onclick: () => playQueue(p.songs, 0) }, icon('play'), t('play')),
          el('button', { class: 'btn secondary', onclick: () => playQueue(shuffled(p.songs), 0) }, icon('shuffle'), t('shuffle'))))),
      songRows(p.songs));
  },
  async playlist(id) {
    status(t('loading'));
    const p = await stalow.playlist(id);
    view.replaceChildren(
      el('div', { class: 'head' }, img(p.playlist.thumbnail || (p.songs[0] && p.songs[0].thumbnail), p.playlist.title), el('div', {}, el('div', { class: 'overline', text: t('playlist') }), el('h1', { text: p.playlist.title }),
        el('div', { class: 'muted', text: t('n_songs_approved', p.songs.length) }),
        el('div', { class: 'actions' }, p.songs.length ? el('button', { class: 'btn', onclick: () => playQueue(p.songs, 0) }, icon('play'), t('play')) : ''))),
      p.songs.length ? songRows(p.songs) : el('div', { class: 'status', text: t('playlist_empty') }));
  },
  async queue() {
    if (!state.queue.length) return status(t('queue_empty'));
    view.replaceChildren(el('h1', { text: t('queue') }), songRows(state.queue, { onPlay: (i) => playAt(i) }));
  },
};

const navHistory = [];
let currentView = null;
async function go(name, arg, push = true) {
  document.querySelectorAll('.nav').forEach((b) => b.classList.toggle('active', b.dataset.view === name || (name === 'settingsPage' && b.dataset.view === 'settings')));
  if (push) navHistory.push([name, arg]);
  currentView = [name, arg];
  $('#btn-back').hidden = navHistory.length < 2;
  $('#main').scrollTop = 0;
  try { await views[name](arg); } catch (e) { status(t('something_went_wrong', e.message), true); }
}
function back() {
  if (navHistory.length < 2) return;
  navHistory.pop();
  const [n, a] = navHistory[navHistory.length - 1];
  go(n, a, false);
}
/** Shows the current page again (after a setting that changes how pages look). */
function rerender() { if (currentView && !['settingsPage', 'settings'].includes(currentView[0])) go(currentView[0], currentView[1], false); }
function renderQueueIfOpen() { if (currentView && currentView[0] === 'queue') views.queue(); }

document.querySelectorAll('.nav').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));
$('#btn-back').addEventListener('click', back);
window.addEventListener('mouseup', (e) => { if (e.button === 3) back(); });
document.addEventListener('keydown', (e) => {
  if ((e.altKey && e.key === 'ArrowLeft') || (e.key === 'Backspace' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) || e.key === 'BrowserBack') { e.preventDefault(); back(); }
});

// ---------- updates ----------
stalow.onUpdate((u) => {
  const b = $('#update-banner');
  if (u.state === 'ready') {
    b.replaceChildren(el('span', { text: t('update_ready', u.version) }), el('button', { class: 'btn', text: t('restart_to_update'), onclick: () => {
      // after the update, carry on with the same song from the same place
      saveSession(Number($('#seek').value));
      stalow.installUpdate(!!(state.playing || state.anyPlaying));
    } }));
    b.hidden = false;
  } else if (u.state === 'downloading') {
    b.replaceChildren(el('span', { text: t('update_downloading', u.percent || '') })); b.hidden = false;
  } else if (u.state === 'none') { b.replaceChildren(el('span', { text: t('up_to_date') })); b.hidden = false; setTimeout(() => { b.hidden = true; }, 4000); }
  else if (u.state === 'error') { b.replaceChildren(el('span', { text: t('update_check_failed', u.message) })); b.hidden = false; }
  else if (u.state === 'dev') { b.replaceChildren(el('span', { text: t('updates_installed_only') })); b.hidden = false; setTimeout(() => { b.hidden = true; }, 4000); }
});
