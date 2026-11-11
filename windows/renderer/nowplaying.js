'use strict';
/* global stalow, el, img, t, icon, state, S, views, currentView, nowLine, go, fmt */
// The Now playing page (click the song in the player bar): large artwork, the song, and its lyrics
// (Settings > Lyrics: providers and their order, text position, word-by-word, auto scroll, timing offset).

const lyricsState = { id: null, data: null, loading: false, lines: [], active: -1, userScrolledAt: 0 };

function currentSong() { return state.queue[state.index] || null; }

async function loadLyrics(song) {
  lyricsState.id = song.id; lyricsState.data = null; lyricsState.loading = true; lyricsState.active = -1;
  const want = { videoId: song.id, title: song.title, artist: (song.artists || []).map((a) => a.name).join(', '), album: (song.album && song.album.title) || song.albumName || '', duration: Math.round(song.duration || state.duration || 0) };
  let data = null;
  try { data = await stalow.lyrics(want); } catch { data = null; }
  if (lyricsState.id !== song.id) return; // the song changed meanwhile
  lyricsState.data = data; lyricsState.loading = false;
  if (isNowPlayingOpen()) renderLyrics();
}

function isNowPlayingOpen() { return currentView && currentView[0] === 'nowplaying'; }

/** Called by app.js when another song starts. */
function onNowPlayingChanged() { // eslint-disable-line no-unused-vars
  if (isNowPlayingOpen()) views.nowplaying();
}

views.nowplaying = async () => {
  const s = currentSong();
  const viewEl = document.getElementById('view');
  if (!s) { viewEl.replaceChildren(el('div', { class: 'status', text: t('nothing_playing') })); return; }
  const lyricsBox = el('div', { id: 'lyrics', class: 'lyrics', 'data-pos': S.lyricsPosition || 'center' });
  lyricsBox.addEventListener('wheel', () => { lyricsState.userScrolledAt = Date.now(); }, { passive: true });
  viewEl.replaceChildren(el('div', { class: 'np' },
    el('div', {},
      el('div', { class: 'np-art' }, img(s.thumbnail ? s.thumbnail.replace(/=w\d+-h\d+/, '=w544-h544') : '', s.title, { isVideo: s.isVideo })),
      el('div', { class: 'np-title', text: s.title }),
      el('div', { class: 'np-sub', text: nowLine(s) })),
    S.showLyrics ? el('div', {}, el('h2', { text: t('stalow_lyrics') }), lyricsBox) : el('div', { class: 'status', text: t('lyrics_hidden') })));
  if (!S.showLyrics) return;
  if (lyricsState.id !== s.id) loadLyrics(s);
  renderLyrics();
};

function renderLyrics() {
  const box = document.getElementById('lyrics');
  if (!box) return;
  const d = lyricsState.data;
  if (lyricsState.loading || lyricsState.id !== (currentSong() || {}).id) { box.replaceChildren(el('div', { class: 'status', text: t('loading') })); return; }
  if (!d || !d.lines.length) { box.replaceChildren(el('div', { class: 'status', text: t('lyrics_not_found') })); return; }
  lyricsState.lines = d.lines.map((line, i) => {
    const words = d.synced && S.lyricsWordSync && line.words && line.words.length
      ? line.words.map((w) => el('span', { class: 'w', 'data-t': String(w.time), text: w.text }))
      : [line.text || ' '];
    return el('div', {
      class: 'lyric' + (d.synced ? '' : ' plain'),
      'data-i': String(i),
      onclick: d.synced ? () => stalow.seek(Math.max(0, line.time - (S.lyricsOffsetMs || 0) / 1000)) : null,
    }, words);
  });
  box.replaceChildren(...lyricsState.lines,
    el('div', { class: 'lyrics-src', text: t('lyrics_from', d.source) + ' · ' + t(d.synced ? 'lyrics_synced' : 'lyrics_plain') }));
  lyricsState.active = -1;
  onPlayerTime(state.time);
}

/** Called by app.js with the playing position: highlights the current line (and word) and scrolls to it. */
function onPlayerTime(time) { // eslint-disable-line no-unused-vars
  const d = lyricsState.data;
  if (!isNowPlayingOpen() || !d || !d.synced || !lyricsState.lines.length) return;
  const now = time + (S.lyricsOffsetMs || 0) / 1000; // positive offset: lyrics earlier
  let idx = -1;
  for (let i = 0; i < d.lines.length; i++) { if (d.lines[i].time <= now) idx = i; else break; }
  if (idx !== lyricsState.active) {
    const prevEl = lyricsState.lines[lyricsState.active];
    if (prevEl) prevEl.classList.remove('active');
    lyricsState.active = idx;
    const cur = lyricsState.lines[idx];
    if (cur) {
      cur.classList.add('active');
      // auto scroll, unless the user scrolled the lyrics in the last few seconds
      if (S.lyricsAutoScroll && Date.now() - lyricsState.userScrolledAt > 4000) {
        const box = document.getElementById('lyrics');
        box.scrollTo({ top: cur.offsetTop - box.offsetTop - box.clientHeight / 3, behavior: 'smooth' });
      }
    }
  }
  const cur = lyricsState.lines[idx];
  if (cur && S.lyricsWordSync) cur.querySelectorAll('.w').forEach((w) => w.classList.toggle('sung', Number(w.dataset.t) <= now));
}

// the playing position arrives every 0.4 s; between reports, keep the words moving smoothly
setInterval(() => { if (state.playing && isNowPlayingOpen()) onPlayerTime(state.time); }, 400);

/* exported onNowPlayingChanged, onPlayerTime, fmt, icon, go */
