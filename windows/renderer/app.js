'use strict';
/* global stalow */
const $ = (sel) => document.querySelector(sel);
const view = $('#view');

// ---------- small DOM helpers (text is always set with textContent) ----------
function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c) n.append(c);
  return n;
}
// An image, or the first letter of [label] on a coloured tile when there is none or it fails to load.
function img(src, label = '') {
  const ph = () => el('div', { class: 'ph', text: (label.trim()[0] || '♪').toUpperCase() });
  if (!src) return ph();
  const i = el('img', { src, alt: '', loading: 'lazy' });
  i.addEventListener('error', () => i.replaceWith(ph()));
  return i;
}
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const artistNames = (it) => (it.artists || []).map((a) => a.name).join(', ');
function status(text, isError) { view.replaceChildren(el('div', { class: 'status' + (isError ? ' error' : ''), text })); }

// ---------- queue + playback ----------
const state = { queue: [], index: -1, playing: false, radio: null, duration: 0, seeking: false };

// Playing never stops by itself: when the chosen songs run out, similar approved songs (YouTube Music's radio
// for the last song) are added, and when that radio runs out a new one starts from the song that is playing.
const newRadio = (videoId) => (videoId ? { videoId, continuation: null, started: false } : null);
function playQueue(songs, start = 0, radioSeed = null) {
  state.queue = songs.slice();
  state.index = -1;
  state.radio = newRadio(radioSeed || (songs.length && songs[songs.length - 1].id));
  playAt(start);
}
function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------- the queue survives a restart or an update ----------
// The queue, the song and its position are saved on this computer. After a restart the same song is
// ready where it stopped (press Play); after an update it carries on playing by itself.
const SESSION_KEY = 'stalow.session';
const RESUME_KEY = 'stalow.resumeAfterUpdate';
function saveSession(time) {
  if (state.index < 0 || !state.queue.length) return;
  // keep the songs around the current one, so a long radio queue stays small
  const from = Math.max(0, state.index - 50);
  const queue = state.queue.slice(from, from + 250).map((x) => ({ type: 'song', id: x.id, title: x.title, artists: x.artists || [], album: x.album || (x.albumName ? { id: '', title: x.albumName } : null), thumbnail: x.thumbnail || '', duration: x.duration || null }));
  const r = state.radio;
  const session = { queue, index: state.index - from, time: Math.floor(time || 0), radio: r ? { videoId: r.videoId, continuation: r.continuation, started: r.started } : null };
  stalow.saveSession(session).catch(() => {});
}
async function restoreSession() {
  let s = await stalow.loadSession().catch(() => null);
  if (!s) { try { s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { s = null; } } // saved by 1.0.8
  let resume = !!(s && s.resume);
  try { if (localStorage.getItem(RESUME_KEY) === '1') resume = true; localStorage.removeItem(RESUME_KEY); } catch { /* ignore */ }
  if (!s || !Array.isArray(s.queue) || !s.queue.length) return;
  const index = Math.min(Math.max(0, s.index | 0), s.queue.length - 1);
  state.queue = s.queue.filter((x) => x && typeof x.id === 'string');
  if (!state.queue.length) return;
  state.radio = s.radio && s.radio.videoId ? { ...s.radio, busy: false } : newRadio(state.queue[state.queue.length - 1].id);
  state.index = index;
  state.pendingSeek = { id: state.queue[index].id, time: s.time || 0 };
  state.notLoaded = true; // the song is shown but not loaded in the player yet
  const cur = state.queue[index];
  $('#np-title').textContent = cur.title;
  showNowLine(cur);
  const art = $('#np-art'); art.hidden = !cur.thumbnail; if (cur.thumbnail) art.src = cur.thumbnail;
  if (cur.duration) { $('#seek').max = Math.floor(cur.duration); $('#t-dur').textContent = fmt(cur.duration); }
  $('#seek').value = Math.floor(s.time || 0); $('#t-cur').textContent = fmt(s.time || 0);
  if (resume) playAt(index);
}

// ---------- recently played (kept on this computer) ----------
const RECENT_KEY = 'stalow.recent';
function recentSongs() { try { const r = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(r) ? r : []; } catch { return []; } }
function rememberPlayed(song) {
  const keep = { type: 'song', id: song.id, title: song.title, artists: song.artists || [], thumbnail: song.thumbnail || '', duration: song.duration || null };
  const list = [keep, ...recentSongs().filter((s) => s && s.id !== song.id)].slice(0, 100);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* storage unavailable: nothing to remember */ }
}
/** Artist ids from the recently played songs, most recent first. */
function recentArtistIds() {
  const ids = [];
  for (const s of recentSongs()) for (const a of (s.artists || [])) if (a && a.id && !ids.includes(a.id)) ids.push(a.id);
  return ids;
}
function addToQueue(song) { state.queue.push(song); if (state.index < 0) playAt(state.queue.length - 1); renderQueueIfOpen(); }
async function playAt(i) {
  if (i < 0 || i >= state.queue.length) return;
  if (state.pendingSeek && state.pendingSeek.id !== state.queue[i].id) state.pendingSeek = null;
  state.notLoaded = false;
  state.index = i;
  saveSession(state.pendingSeek ? state.pendingSeek.time : 0);
  const s = state.queue[i];
  $('#np-title').textContent = s.title;
  showNowLine(s);
  const art = $('#np-art'); art.hidden = !s.thumbnail; if (s.thumbnail) art.src = s.thumbnail;
  document.title = `${s.title} - Stalow Music`;
  clearTimeout(state.watchdog);
  // YouTube Music should start within ~25 s; if not, say so instead of waiting silently
  state.watchdog = setTimeout(() => playFailed('YouTube Music did not start playing'), 25000);
  try { await stalow.play(s.id); } catch (e) { playFailed(e.message); }
  renderQueueIfOpen();
  topUpRadio();
}
/** Under the song name: the artist and the album ("Artist · Album"). */
function showNowLine(song) {
  const album = (song.album && song.album.title) || song.albumName || '';
  $('#np-artist').textContent = [artistNames(song), album].filter(Boolean).join(' · ');
  $('#np-artist').title = $('#np-artist').textContent;
  $('#np-title').title = song.title || '';
}
function hideNotice() { const n = document.getElementById('play-notice'); if (n) n.remove(); }
function playFailed(message) {
  clearTimeout(state.watchdog);
  state.failures = (state.failures || 0) + 1;
  hideNotice();
  const box = el('div', { id: 'play-notice', class: 'notice' },
    el('span', { text: state.failures >= 3
      ? 'Songs are not starting. Check your internet connection, or open Settings > "Show the YouTube player" to see what YouTube is showing.'
      : `Could not play this song (${message || 'unknown error'}). Trying the next one…` }),
    el('button', { class: 'btn secondary', text: 'Show the YouTube player', onclick: () => stalow.togglePlayer() }));
  $('#main').prepend(box);
  if (state.failures < 3) setTimeout(next, 2000);
}
function next() {
  if (state.index + 1 < state.queue.length) return playAt(state.index + 1);
  const cur = state.queue[state.index];
  if (!state.radio && cur) state.radio = newRadio(cur.id); // the radio ran out: start a new one from this song
  topUpRadio(true);
}
function prev() { if (state.index > 0) playAt(state.index - 1); else stalow.seek(0); }

/** Keeps a radio queue going with more approved songs. */
async function topUpRadio(playWhenAdded = false) {
  const r = state.radio;
  if (!r || state.queue.length - state.index > 3) return;
  if (r.busy) return; r.busy = true;
  try {
    const res = await stalow.radio(r.started ? null : r.videoId, r.started ? r.continuation : null);
    r.started = true; r.continuation = res.continuation;
    const have = new Set(state.queue.map((s) => s.id));
    const added = res.items.filter((s) => !have.has(s.id));
    const before = state.queue.length;
    state.queue.push(...added);
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
  if (ev.state === 'ended') return next();
  if (ev.state === 'error') return playFailed(ev.message);
  // the album name, from YouTube Music's player, when the list the song came from did not have it
  if (cur && ev.album && !(cur.album && cur.album.title) && cur.albumName !== ev.album) { cur.albumName = ev.album; showNowLine(cur); }
  if (ev.state === 'playing' || ev.state === 'paused') {
    // a restored song continues where it stopped
    if (state.pendingSeek && cur && state.pendingSeek.id === cur.id && ev.state === 'playing') {
      const t = state.pendingSeek.time; state.pendingSeek = null;
      if (t > 3 && (!ev.duration || t < ev.duration - 5)) stalow.seek(t);
    }
    if (!state.lastSave || Date.now() - state.lastSave > 5000) { state.lastSave = Date.now(); saveSession(ev.time); }
  }
  if (ev.state === 'playing') {
    clearTimeout(state.watchdog); state.failures = 0; hideNotice();
    if (cur && state.remembered !== state.index + ':' + cur.id) { state.remembered = state.index + ':' + cur.id; rememberPlayed(cur); }
  }
  state.playing = ev.state === 'playing';
  $('#btn-play').innerHTML = state.playing ? '&#10074;&#10074;' : '&#9654;';
  $('#btn-play').title = state.playing ? 'Pause' : 'Play';
  if (ev.duration && !state.seeking) {
    state.duration = ev.duration;
    $('#seek').max = Math.floor(ev.duration); $('#seek').value = Math.floor(ev.time || 0);
    $('#t-cur').textContent = fmt(ev.time); $('#t-dur').textContent = fmt(ev.duration);
  }
});

$('#btn-play').addEventListener('click', () => {
  if (state.index < 0) {
    // nothing chosen yet: say what to do instead of silently ignoring the press
    hideNotice();
    $('#main').prepend(el('div', { id: 'play-notice', class: 'notice' }, el('span', { text: 'Choose a song, album or artist first, then press Play.' })));
    setTimeout(hideNotice, 4000);
    return;
  }
  if (state.notLoaded) return playAt(state.index); // a restored song: load it, it continues where it stopped
  if (state.playing || state.anyPlaying) { state.anyPlaying = false; stalow.pause(); } else stalow.resume();
});
$('#btn-next').addEventListener('click', next);
$('#btn-prev').addEventListener('click', prev);
$('#seek').addEventListener('input', () => { state.seeking = true; $('#t-cur').textContent = fmt($('#seek').value); });
$('#seek').addEventListener('change', () => {
  if (state.pendingSeek) state.pendingSeek.time = Number($('#seek').value);
  stalow.seek(Number($('#seek').value)); state.seeking = false;
});
window.addEventListener('beforeunload', () => saveSession(Number($('#seek').value)));
$('#vol').addEventListener('input', () => stalow.volume(Number($('#vol').value)));
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); $('#btn-play').click(); }
});

// ---------- item rendering ----------
function songRows(songs, { onPlay } = {}) {
  return el('div', { class: 'rows' }, songs.map((s, i) => el('button', {
    class: 'row' + (state.queue[state.index] && state.queue[state.index].id === s.id ? ' playing' : ''),
    onclick: () => (onPlay ? onPlay(i) : playQueue(songs, i)),
  },
  el('span', { class: 'n', text: String(i + 1) }), img(s.thumbnail, s.title),
  el('div', { class: 'ellipsis' }, el('div', { class: 'rt ellipsis', text: s.title }), el('div', { class: 'muted ellipsis', text: artistNames(s) })),
  el('span', { class: 'd', text: s.duration ? fmt(s.duration) : '' }),
  el('span', { class: 'add', role: 'button', title: 'Add to queue', text: '+ Queue', onclick: (e) => { e.stopPropagation(); addToQueue(s); } }))));
}
function cards(items) {
  return el('div', { class: 'grid' }, items.map((it) => el('button', {
    class: 'card' + (it.type === 'artist' ? ' round' : ''),
    onclick: () => open(it),
  }, img(it.thumbnail, it.title), el('div', { class: 't ellipsis', text: it.title }),
  el('div', { class: 's muted ellipsis', text: it.type === 'artist' ? 'Artist' : it.type === 'album' ? [artistNames(it), it.year].filter(Boolean).join(' · ') || 'Album' : it.type === 'playlist' ? 'Playlist' : artistNames(it) }))));
}
function open(it) {
  // pass the card's picture along, used when the page itself has none
  if (it.type === 'artist') return go('artist', { id: it.id, thumbnail: it.thumbnail });
  if (it.type === 'album') return go('album', { id: it.id, thumbnail: it.thumbnail });
  if (it.type === 'playlist') return go('playlist', it.id);
  if (it.type === 'song') return playQueue([it], 0, it.id);
}

// ---------- views ----------
const views = {
  async home() {
    view.replaceChildren(el('h1', { text: 'Welcome' }), el('div', { class: 'status', text: 'Loading…' }));
    const recentIds = recentArtistIds();
    const { artists } = await stalow.home(recentIds);
    const recent = recentSongs().slice(0, 12);
    const played = artists.filter((a) => recentIds.includes(a.id)).length;
    view.replaceChildren(
      el('h1', { text: 'Welcome' }),
      el('p', { class: 'muted', text: 'Only approved artists appear in Stalow Music. Pick an artist, or search for a song.' }),
      recent.length ? el('h2', { text: 'Recently played' }) : '',
      recent.length ? cards(recent) : '',
      el('h2', { text: played ? 'Your artists' : 'Artists to listen to' }), cards(artists),
      el('div', { class: 'actions' }, el('button', { class: 'btn secondary', text: 'Show other artists', onclick: () => views.home() })));
  },
  async search(q = '') {
    const box = el('input', { class: 'searchbox', type: 'search', placeholder: 'Search songs, albums and artists', value: q });
    const results = el('div');
    const run = async () => {
      const text = box.value.trim();
      if (!text) { results.replaceChildren(); return; }
      results.replaceChildren(el('div', { class: 'status', text: 'Searching…' }));
      try {
        const r = await stalow.search(text);
        const parts = [];
        if (r.songs.length) parts.push(el('h2', { text: 'Songs' }), songRows(r.songs.slice(0, 20), { onPlay: (i) => playQueue([r.songs[i]], 0, r.songs[i].id) }));
        if (r.artists.length) parts.push(el('h2', { text: 'Artists' }), cards(r.artists.slice(0, 12)));
        if (r.albums.length) parts.push(el('h2', { text: 'Albums' }), cards(r.albums.slice(0, 12)));
        if (r.playlists.length) parts.push(el('h2', { text: 'Playlists' }), cards(r.playlists.slice(0, 12)));
        results.replaceChildren(...(parts.length ? parts : [el('div', { class: 'status', text: 'Nothing by approved artists matched. Try an artist name.' })]));
      } catch (e) { results.replaceChildren(el('div', { class: 'status error', text: 'Search failed: ' + e.message + '. Check your internet connection.' })); }
    };
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
    view.replaceChildren(el('h1', { text: 'Search' }), box, results);
    box.focus();
    if (q) run();
  },
  async artists() {
    const all = await stalow.artists('');
    const filter = el('input', { class: 'searchbox', type: 'search', placeholder: `Filter ${all.length} approved artists` });
    const list = el('div');
    const letters = [...new Set(all.map((a) => (a.title[0] || '#').toUpperCase()))];
    const show = (items) => list.replaceChildren(cards(items.slice(0, 300)), items.length > 300 ? el('p', { class: 'muted', text: `Showing 300 of ${items.length}. Type to narrow down.` }) : '');
    filter.addEventListener('input', () => { const q = filter.value.trim().toLowerCase(); show(all.filter((a) => a.title.toLowerCase().includes(q))); });
    view.replaceChildren(el('h1', { text: 'Artists' }), filter,
      el('div', { class: 'letters' }, letters.map((L) => el('button', { text: L, onclick: () => show(all.filter((a) => (a.title[0] || '#').toUpperCase() === L)) }))), list);
    show(all);
  },
  async artist(arg) {
    const id = typeof arg === 'string' ? arg : arg.id;
    status('Loading…');
    const p = await stalow.artist(id);
    if (p.artist && !p.artist.thumbnail && arg.thumbnail) p.artist.thumbnail = arg.thumbnail;
    if (p.notApproved) return status('This artist is not in the approved list.');
    const songs = p.sections.flatMap((s) => s.items).filter((x) => x.type === 'song');
    view.replaceChildren(
      el('div', { class: 'head round' }, img(p.artist.thumbnail, p.artist.title), el('div', {}, el('h1', { text: p.artist.title }),
        el('div', { class: 'actions' },
          songs.length ? el('button', { class: 'btn', text: 'Play', title: 'Shuffle this artist', onclick: () => playQueue(shuffled(songs), 0) }) : '',
          songs.length ? el('button', { class: 'btn secondary', text: 'Radio', onclick: () => playQueue([songs[0]], 0, songs[0].id) }) : ''))),
      ...p.sections.flatMap((s) => {
        const sSongs = s.items.filter((x) => x.type === 'song');
        const others = s.items.filter((x) => x.type !== 'song');
        return [el('h2', { text: s.title || 'More' }), sSongs.length ? songRows(sSongs) : '', others.length ? cards(others) : ''];
      }),
      p.sections.length ? '' : el('div', { class: 'status', text: 'No songs found for this artist right now.' }));
  },
  async album(arg) {
    const id = typeof arg === 'string' ? arg : arg.id;
    status('Loading…');
    const p = await stalow.album(id);
    if (p.notApproved) return status('This album has no songs by approved artists.');
    if (!p.album.thumbnail) p.album.thumbnail = arg.thumbnail || (p.songs[0] && p.songs[0].thumbnail) || '';
    // album tracks often come without their own picture: show the album cover beside them
    p.songs = p.songs.map((s) => (s.thumbnail ? s : { ...s, thumbnail: p.album.thumbnail }));
    view.replaceChildren(
      el('div', { class: 'head' }, img(p.album.thumbnail, p.album.title), el('div', {}, el('h1', { text: p.album.title }), el('div', { class: 'muted', text: artistNames(p.album) }),
        el('div', { class: 'actions' }, el('button', { class: 'btn', text: 'Play', onclick: () => playQueue(p.songs, 0) })))),
      songRows(p.songs));
  },
  async playlist(id) {
    status('Loading…');
    const p = await stalow.playlist(id);
    view.replaceChildren(
      el('div', { class: 'head' }, img(p.playlist.thumbnail || (p.songs[0] && p.songs[0].thumbnail), p.playlist.title), el('div', {}, el('h1', { text: p.playlist.title }),
        el('div', { class: 'muted', text: `${p.songs.length} songs by approved artists` }),
        el('div', { class: 'actions' }, p.songs.length ? el('button', { class: 'btn', text: 'Play', onclick: () => playQueue(p.songs, 0) }) : ''))),
      p.songs.length ? songRows(p.songs) : el('div', { class: 'status', text: 'This playlist has no songs by approved artists.' }));
  },
  async queue() {
    if (!state.queue.length) return status('The queue is empty. Play a song, album or artist.');
    view.replaceChildren(el('h1', { text: 'Queue' }), songRows(state.queue, { onPlay: (i) => playAt(i) }));
  },
  async settings() {
    const s = await stalow.settings();
    view.replaceChildren(el('h1', { text: 'Settings' }), el('div', { class: 'settings' },
      el('div', { class: 'item' }, el('div', {}, el('div', { text: 'YouTube account (optional)' }), el('div', { class: 'muted', text: 'Signing in to your own Google account can mean fewer interruptions. The window closes by itself once you are signed in.' })),
        el('button', { class: 'btn secondary', text: 'Sign in', onclick: () => stalow.signIn() })),
      el('div', { class: 'item' }, el('div', {}, el('div', { text: 'Show the YouTube player' }), el('div', { class: 'muted', text: 'For troubleshooting: shows the hidden YouTube Music window that plays the songs. Press again to hide it.' })),
        el('button', { class: 'btn secondary', text: 'Show / hide', onclick: () => stalow.togglePlayer() })),
      el('div', { class: 'item' }, el('div', {}, el('div', { text: `Version ${s.version}` }), el('div', { class: 'muted', text: 'Updates install automatically from stalow.netlify.app.' })),
        el('button', { class: 'btn secondary', text: 'Check for updates', onclick: () => stalow.checkUpdates() })),
      el('div', { class: 'item' }, el('div', {}, el('div', { text: 'Approved artists' }), el('div', { class: 'muted', text: `${s.artistCount} artists, list version ${s.listVersion}` }))),
      el('div', { class: 'item' }, el('div', { class: 'muted', text: 'Stalow Music is based on Zemer by ZemerTeam and Metrolist, and is free software under the GNU GPL v3.' }))));
  },
};

const history = [];
async function go(name, arg, push = true) {
  document.querySelectorAll('.nav').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (push) history.push([name, arg]);
  $('#btn-back').hidden = history.length < 2;
  $('#main').scrollTop = 0;
  try { await views[name](arg); } catch (e) { status('Something went wrong: ' + e.message + '. Check your internet connection and try again.', true); }
}
function back() {
  if (history.length < 2) return;
  history.pop();
  const [n, a] = history[history.length - 1];
  go(n, a, false);
}
document.querySelectorAll('.nav').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));
$('#btn-back').addEventListener('click', back);
window.addEventListener('mouseup', (e) => { if (e.button === 3) back(); });
document.addEventListener('keydown', (e) => {
  if ((e.altKey && e.key === 'ArrowLeft') || (e.key === 'Backspace' && e.target.tagName !== 'INPUT') || e.key === 'BrowserBack') { e.preventDefault(); back(); }
});

// ---------- updates ----------
stalow.onUpdate((u) => {
  const b = $('#update-banner');
  if (u.state === 'ready') {
    b.replaceChildren(el('span', { text: `Version ${u.version} is ready.` }), el('button', { class: 'btn', text: 'Restart to update', onclick: () => {
      // after the update, carry on with the same song from the same place
      saveSession(Number($('#seek').value));
      stalow.installUpdate(!!(state.playing || state.anyPlaying));
    } }));
    b.hidden = false;
  } else if (u.state === 'downloading') {
    b.replaceChildren(el('span', { text: `Downloading update${u.percent ? ` (${u.percent}%)` : ''}…` })); b.hidden = false;
  } else if (u.state === 'none') { b.replaceChildren(el('span', { text: 'Stalow Music is up to date.' })); b.hidden = false; setTimeout(() => { b.hidden = true; }, 4000); }
  else if (u.state === 'error') { b.replaceChildren(el('span', { text: 'Could not check for updates: ' + u.message })); b.hidden = false; }
  else if (u.state === 'dev') { b.replaceChildren(el('span', { text: 'Updates work in the installed app.' })); b.hidden = false; setTimeout(() => { b.hidden = true; }, 4000); }
});

$('#np-art').addEventListener('error', () => { $('#np-art').hidden = true; });
stalow.settings().then((s) => { if (typeof s.volume === 'number') $('#vol').value = s.volume; }).catch(() => {});
restoreSession();
go('home');
