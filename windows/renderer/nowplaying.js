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

// Which side panel shows: Up next (the queue) or Lyrics. Remembered on this computer.
let npTab = (() => { try { return localStorage.getItem('stalow.npTab') || 'upnext'; } catch { return 'upnext'; } })();

views.nowplaying = async () => {
  const s = currentSong();
  const viewEl = document.getElementById('view');
  if (!s) { viewEl.replaceChildren(el('div', { class: 'status', text: t('nothing_playing') })); return; }

  // big controls, the same actions as the player bar
  const ctl = (name, label, onclick, cls = '') => el('button', { class: cls, title: label, 'aria-label': label, onclick }, icon(name));
  const shuffleBtn = ctl('shuffle', t('shuffle'), () => document.getElementById('btn-shuffle').click(), 'toggle' + (S.shuffle ? ' on' : ''));
  const repeatBtn = ctl('repeat', t(S.repeat === 'one' ? 'repeat_mode_one' : S.repeat === 'all' ? 'repeat_mode_all' : 'repeat_mode_off'), () => document.getElementById('btn-repeat').click(), 'toggle' + (S.repeat !== 'off' ? ' on' : ''));
  if (S.repeat === 'one') repeatBtn.append(el('span', { class: 'badge', text: '1' }));
  const playBtn = ctl(state.playing ? 'pause' : 'play', t(state.playing ? 'pause' : 'play'), () => document.getElementById('btn-play').click(), 'play big');
  playBtn.id = 'np-play';
  const seek = el('input', { id: 'np-seek', type: 'range', min: '0', max: String(Math.floor(state.duration || s.duration || 0)), step: '1', value: String(Math.floor(state.time || 0)), 'aria-label': t('position') });
  seek.addEventListener('input', () => { state.seeking = true; document.getElementById('np-cur').textContent = fmt(seek.value); });
  seek.addEventListener('change', () => { state.seeking = false; P.seek(Number(seek.value)); state.time = Number(seek.value); }); // eslint-disable-line no-undef

  // Download: Download / Saving… (Cancel) / Downloaded
  let dl;
  if (downloaded.has(s.id)) dl = el('button', { class: 'btn secondary', disabled: true }, icon('backup'), t('downloaded')); // eslint-disable-line no-undef
  else if (jobFor(s.id)) { // eslint-disable-line no-undef
    const j = jobFor(s.id); // eslint-disable-line no-undef
    dl = el('button', { class: 'btn secondary', id: 'np-dl', onclick: () => cancelDownload(s.id) }, icon('backup'), j.state === 'saving' ? t('download_saving_pct', pct(j)) : j.state === 'failed' ? t('download_failed_short', j.reason) : t('download_waiting')); // eslint-disable-line no-undef
  } else dl = el('button', { class: 'btn secondary', onclick: () => downloadSongs([s]) }, icon('backup'), t('action_download')); // eslint-disable-line no-undef

  const tabBtn = (id, label) => el('button', { class: 'chip' + (npTab === id ? ' on' : ''), onclick: () => { npTab = id; try { localStorage.setItem('stalow.npTab', id); } catch { /* ignore */ } views.nowplaying(); } }, label);
  const side = el('div', { id: 'np-side' });

  viewEl.replaceChildren(el('div', { class: 'np' },
    el('div', { class: 'np-left' },
      el('div', { class: 'np-art' }, img(s.thumbnail ? s.thumbnail.replace(/=w\d+-h\d+/, '=w544-h544') : '', s.title, { isVideo: s.isVideo })),
      el('div', { class: 'np-title', text: s.title }),
      el('div', { class: 'np-sub', text: nowLine(s) }),
      el('div', { class: 'np-seek' }, seek, el('div', { class: 'np-times mono' }, el('span', { id: 'np-cur', text: fmt(state.time) }), el('span', { id: 'np-dur', text: fmt(state.duration || s.duration) }))),
      el('div', { class: 'buttons np-buttons' }, shuffleBtn, ctl('prev', t('previous'), () => document.getElementById('btn-prev').click()), playBtn, ctl('next', t('next'), () => document.getElementById('btn-next').click()), repeatBtn),
      el('div', { class: 'actions np-actions' },
        el('button', { class: 'btn secondary like-big' + (isLiked(s.id) ? ' on' : ''), 'aria-pressed': String(isLiked(s.id)), onclick: () => toggleLike(s) }, icon('heart'), t(isLiked(s.id) ? 'liked' : 'like')), // eslint-disable-line no-undef
        dl,
        isVideoItem(s) && !S.blockVideos && !downloaded.has(s.id) && videoMode === 'off' ? el('button', { class: 'btn secondary', onclick: () => watchVideo() }, icon('play'), t('watch_video')) : '', // eslint-disable-line no-undef
        jobFor(s.id) ? el('span', { class: 'muted small', text: t('downloading_hint') }) : '')), // eslint-disable-line no-undef
    el('div', { class: 'np-right' },
      el('div', { class: 'chips' }, tabBtn('upnext', t('stalow_up_next')), tabBtn('lyrics', t('stalow_lyrics'))),
      side)));

  if (npTab === 'upnext') return renderUpNext();
  if (!S.showLyrics) { side.replaceChildren(el('div', { class: 'status', text: t('lyrics_hidden') })); return; }
  const lyricsBox = el('div', { id: 'lyrics', class: 'lyrics', 'data-pos': S.lyricsPosition || 'center' });
  lyricsBox.addEventListener('wheel', () => { lyricsState.userScrolledAt = Date.now(); }, { passive: true });
  side.replaceChildren(lyricsBox);
  if (lyricsState.id !== s.id) loadLyrics(s);
  renderLyrics();
};

/** The Up next panel (called again whenever the queue changes). */
function renderUpNext() { // eslint-disable-line no-unused-vars
  const side = document.getElementById('np-side');
  if (!side || npTab !== 'upnext') return;
  side.replaceChildren(el('div', { class: 'np-queue' }, queueList({ compact: true }))); // eslint-disable-line no-undef
  const cur = side.querySelector('.qrow.playing');
  if (cur) cur.scrollIntoView({ block: 'center' });
}

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
      onclick: d.synced ? () => P.seek(Math.max(0, line.time - (S.lyricsOffsetMs || 0) / 1000)) : null,
    }, words);
  });
  box.replaceChildren(...lyricsState.lines,
    el('div', { class: 'lyrics-src', text: t('lyrics_from', d.source) + ' · ' + t(d.synced ? 'lyrics_synced' : 'lyrics_plain') }));
  lyricsState.active = -1;
  onPlayerTime(state.time);
}

/** Called by app.js with the playing position: highlights the current line (and word) and scrolls to it. */
function onPlayerTime(time) { // eslint-disable-line no-unused-vars
  if (isNowPlayingOpen()) {
    const seek = document.getElementById('np-seek');
    if (seek && !state.seeking) {
      seek.max = String(Math.floor(state.duration || 0)); seek.value = String(Math.floor(time || 0));
      document.getElementById('np-cur').textContent = fmt(time); document.getElementById('np-dur').textContent = fmt(state.duration);
    }
    const pb = document.getElementById('np-play');
    if (pb && pb.dataset.playing !== String(state.playing)) { pb.dataset.playing = String(state.playing); pb.replaceChildren(icon(state.playing ? 'pause' : 'play')); }
  }
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

/** Called by app.js when the download list changes: keeps the Download button's progress current. */
function onJobsChanged() { // eslint-disable-line no-unused-vars
  const s = currentSong();
  if (!isNowPlayingOpen() || !s) return;
  const j = jobFor(s.id); // eslint-disable-line no-undef
  const b = document.getElementById('np-dl');
  if (j && b && j.state === 'saving') b.lastChild.textContent = t('download_saving_pct', pct(j)); // eslint-disable-line no-undef
  else if (!!j !== !!b || (!j && downloaded.has(s.id))) views.nowplaying(); // eslint-disable-line no-undef
}
