'use strict';
// Playback through YouTube Music's own web player, in a hidden window. YouTube's player handles stream
// protection itself, so playback keeps working when YouTube changes its formats. The window is never shown,
// ads are blocked (and, if one slips through, muted and skipped), and YouTube's own "up next" is stopped:
// the app decides what plays next, so only approved songs are ever played.
const { BrowserWindow, session } = require('electron');

const PARTITION = 'persist:ytmusic';
const STATUS_PREFIX = '__STALOW__';

// Runs inside the YouTube Music page. Reports status through console messages (no Node access is given to
// the page) and exposes a few controls on window.__stalow.
const PAGE_SCRIPT = String.raw`
(() => {
  if (window.__stalow) return;
  const report = (o) => console.log('${STATUS_PREFIX}' + JSON.stringify(o));
  const video = () => document.querySelector('video');
  let expected = null, wantPlaying = true, endedSent = false, volume = 1;
  // Settings > Player & audio. Normalisation and skip silence run through Web Audio, which works on YouTube's
  // own (blob:) media streams; on anything else the sound is left untouched rather than risk silence.
  let opts = { normalize: false, skipSilence: false, quality: 'auto', blockVideo: false };
  let graph = null, silentMs = 0, speeding = false;
  const ensureGraph = (v) => {
    if (graph && graph.v === v) return graph;
    if (!String(v.currentSrc || v.src || '').startsWith('blob:')) return null;
    try {
      const ctx = new AudioContext();
      const src = ctx.createMediaElementSource(v);
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -24; comp.knee.value = 24; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.25;
      const makeup = ctx.createGain(); makeup.gain.value = 1.35;
      const dry = ctx.createGain(), wet = ctx.createGain();
      const analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
      src.connect(dry); dry.connect(ctx.destination);
      src.connect(comp); comp.connect(makeup); makeup.connect(wet); wet.connect(ctx.destination);
      src.connect(analyser);
      graph = { v, ctx, dry, wet, analyser, buf: new Float32Array(2048) };
    } catch (e) { graph = { v, failed: true }; }
    applyGraph();
    return graph;
  };
  const applyGraph = () => {
    if (!graph || graph.failed) return;
    graph.dry.gain.value = opts.normalize ? 0 : 1;
    graph.wet.gain.value = opts.normalize ? 1 : 0;
    if (graph.ctx.state === 'suspended') graph.ctx.resume().catch(() => {});
  };
  const level = () => {
    if (!graph || graph.failed) return 1;
    graph.analyser.getFloatTimeDomainData(graph.buf);
    let sum = 0; for (let i = 0; i < graph.buf.length; i++) sum += graph.buf[i] * graph.buf[i];
    return Math.sqrt(sum / graph.buf.length);
  };
  const applyQuality = () => {
    const p = document.getElementById('movie_player');
    const q = opts.quality === 'low' ? 'tiny' : opts.quality === 'high' ? 'hd1080' : 'auto';
    try { if (p && p.setPlaybackQualityRange) p.setPlaybackQualityRange(q, q); } catch (e) {}
  };
  // Download: the song is recorded from the player while it plays once from the start to the end (the web
  // player gives no file). Paused during adverts and pauses; a song that is left early is not saved.
  let rec = null;
  const finishRec = (r) => { r.chain.then(() => { if (window.__stalowRecorder) window.__stalowRecorder.done(r.id, r.ok); }); };
  const stopRec = (ok) => {
    if (!rec) return;
    const r = rec; rec = null; r.ok = ok;
    try { if (r.mr.state !== 'inactive') r.mr.stop(); else finishRec(r); } catch (e) { finishRec(r); }
  };
  const startRec = (id) => {
    const v = video();
    if (!v || !window.__stalowRecorder || rec) return false;
    let stream;
    try { stream = new MediaStream(v.captureStream().getAudioTracks()); } catch (e) { return false; }
    if (!stream.getAudioTracks().length) return false;
    const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 160000 });
    const r = { id, mr, ok: false, chain: Promise.resolve() };
    mr.ondataavailable = (e) => { if (e.data && e.data.size) r.chain = r.chain.then(() => e.data.arrayBuffer()).then((b) => window.__stalowRecorder.chunk(id, b)); };
    mr.onstop = () => finishRec(r);
    rec = r;
    if (speeding) { speeding = false; silentMs = 0; v.playbackRate = 1; }
    v.currentTime = 0; wantPlaying = true; v.play().catch(() => {});
    mr.start(2000);
    return true;
  };
  const applyVideoBlock = () => {
    let st = document.getElementById('__stalow_block');
    if (opts.blockVideo && !st) { st = document.createElement('style'); st.id = '__stalow_block'; st.textContent = 'video{visibility:hidden!important}'; document.documentElement.appendChild(st); }
    if (!opts.blockVideo && st) st.remove();
  };
  const vidInUrl = () => new URLSearchParams(location.search).get('v');
  const isAd = () => !!document.querySelector('#movie_player.ad-showing, .ytp-ad-player-overlay, .ytp-ad-module .ytp-ad-text');
  const setHandlers = () => {
    try {
      const ms = navigator.mediaSession;
      ms.setActionHandler('nexttrack', () => report({ action: 'next' }));
      ms.setActionHandler('previoustrack', () => report({ action: 'previous' }));
      ms.setActionHandler('play', () => report({ action: 'play' }));
      ms.setActionHandler('pause', () => report({ action: 'pause' }));
    } catch (e) {}
  };
  // Videos and podcasts play as video (Settings > Player & audio): the player fills the screen and only
  // Stalow's controls show, in one bar at the bottom: seek, previous / play / next, and Audio only.
  let videoOn = false, videoFull = false, vlabels = {}, bar = null, hideTimer = null, seeking = false;
  const fmtTime = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
  const VIDEO_CSS = '#movie_player .ytp-chrome-top,#movie_player .ytp-chrome-bottom,#movie_player .ytp-gradient-top,#movie_player .ytp-gradient-bottom,#movie_player .ytp-pause-overlay,#movie_player .ytp-ce-element,#movie_player .ytp-endscreen-content,#movie_player .ytp-paid-content-overlay{display:none!important}'
    + 'html.__stalow_v,html.__stalow_v body{background:#000!important;overflow:hidden!important}'
    + 'html.__stalow_v #movie_player{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;z-index:2147483000!important;background:#000!important;margin:0!important}'
    + 'html.__stalow_v #movie_player video{width:100vw!important;height:100vh!important;left:0!important;top:0!important;object-fit:contain!important}'
    + '#__stalow_bar{position:absolute;left:0;right:0;bottom:0;z-index:2147483647;padding:32px 24px 14px;background:linear-gradient(transparent,rgba(0,0,0,.78));color:#fff;font:14px "DM Sans",system-ui,sans-serif;transition:opacity .25s;display:flex;flex-direction:column;gap:6px;direction:ltr}'
    + '#__stalow_bar.hide{opacity:0;pointer-events:none}#movie_player.__stalow_idle,#movie_player.__stalow_idle *{cursor:none!important}'
    + '#__stalow_bar input[type=range]{width:100%;accent-color:#2fd5c4;margin:0;cursor:pointer}'
    + '#__stalow_bar .r{display:flex;align-items:center;gap:10px}#__stalow_bar .g{flex:1}#__stalow_bar .t{font-variant-numeric:tabular-nums;opacity:.9}'
    + '#__stalow_bar button{background:none;border:0;color:#fff;cursor:pointer;padding:8px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center}#__stalow_bar button:hover{background:rgba(255,255,255,.16)}'
    + '#__stalow_bar button.p{background:#2fd5c4;color:#0b1220;width:52px;height:52px}#__stalow_bar button.p:hover{background:#5fe3d6}'
    + '#__stalow_bar label{display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none}#__stalow_bar .sw{width:42px;height:24px;border-radius:12px;background:rgba(255,255,255,.35);position:relative;flex:none}'
    + '#__stalow_bar .sw::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff}';
  const ICONS = { prev: 'M6 6h2v12H6zm3.5 6 8.5 6V6z', next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z', play: 'M8 5v14l11-7z', pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z', full: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z', win: 'M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z' };
  const svg = (d, size) => { const n = 'http://www.w3.org/2000/svg'; const e = document.createElementNS(n, 'svg'); e.setAttribute('viewBox', '0 0 24 24'); e.setAttribute('width', size || 26); e.setAttribute('height', size || 26); e.setAttribute('fill', 'currentColor'); const p = document.createElementNS(n, 'path'); p.setAttribute('d', d); e.appendChild(p); return e; };
  const btn = (cls, icon, label, onclick, size) => { const b = document.createElement('button'); b.className = cls; b.title = label || ''; b.setAttribute('aria-label', label || ''); b.appendChild(svg(icon, size)); b.addEventListener('click', (e) => { e.stopPropagation(); onclick(); }); return b; };
  const setIcon = (b, d) => { if (b.dataset.icon === d) return; b.dataset.icon = d; b.replaceChildren(svg(d, 30)); };
  const makeBar = () => {
    const b = document.createElement('div'); b.id = '__stalow_bar';
    const seek = document.createElement('input'); seek.type = 'range'; seek.min = '0'; seek.step = '1'; seek.value = '0'; seek.setAttribute('aria-label', vlabels.position || 'Position');
    seek.addEventListener('input', () => { seeking = true; });
    seek.addEventListener('change', () => { const v = video(); if (v) v.currentTime = Number(seek.value); seeking = false; });
    const time = document.createElement('span'); time.className = 't';
    const play = btn('p', ICONS.pause, vlabels.play || 'Play', () => { const v = video(); if (!v) return; if (v.paused) window.__stalow.play(); else window.__stalow.pause(); }, 30);
    const prev = btn('', ICONS.prev, vlabels.previous || 'Previous', () => report({ action: 'previous' }));
    const next = btn('', ICONS.next, vlabels.next || 'Next', () => report({ action: 'next' }));
    const full = btn('', ICONS.full, vlabels.fullScreen || 'Full screen', () => report({ action: videoFull ? 'videoWindowed' : 'videoFull' }));
    const audio = document.createElement('label'); const sw = document.createElement('span'); sw.className = 'sw'; sw.setAttribute('role', 'switch'); sw.setAttribute('aria-checked', 'false');
    const txt = document.createElement('span'); txt.textContent = vlabels.audioOnly || 'Audio only';
    audio.append(txt, sw); audio.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); report({ action: 'audioOnly' }); });
    const row = document.createElement('div'); row.className = 'r';
    const g1 = document.createElement('span'); g1.className = 'g'; const g2 = document.createElement('span'); g2.className = 'g';
    row.append(time, g1, prev, play, next, g2, full, audio);
    b.append(seek, row);
    b.__seek = seek; b.__time = time; b.__play = play; b.__full = full;
    return b;
  };
  const showBar = () => {
    if (!bar) return;
    bar.classList.remove('hide'); const mp = document.getElementById('movie_player'); if (mp) mp.classList.remove('__stalow_idle');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { const v = video(); if (bar && v && !v.paused && !seeking) { bar.classList.add('hide'); const m = document.getElementById('movie_player'); if (m) m.classList.add('__stalow_idle'); } }, 3000);
  };
  const applyVideoMode = () => {
    let st = document.getElementById('__stalow_vcss');
    const mp = document.getElementById('movie_player');
    if (!videoOn) {
      if (st) st.remove(); if (bar) { bar.remove(); bar = null; }
      document.documentElement.classList.remove('__stalow_v');
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      return;
    }
    if (!st) { st = document.createElement('style'); st.id = '__stalow_vcss'; st.textContent = VIDEO_CSS; document.documentElement.appendChild(st); }
    document.documentElement.classList.add('__stalow_v');
    if (!mp) return;
    if (!bar || !mp.contains(bar)) { if (bar) bar.remove(); bar = makeBar(); mp.appendChild(bar); showBar(); }
    if (videoFull && document.fullscreenElement !== mp && mp.requestFullscreen) mp.requestFullscreen().catch(() => {});
    if (!videoFull && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    setIcon(bar.__full, videoFull ? ICONS.win : ICONS.full);
    bar.__full.title = videoFull ? (vlabels.exitFullScreen || 'Exit full screen') : (vlabels.fullScreen || 'Full screen');
  };
  const updateBar = () => {
    if (!videoOn) return;
    if (!bar || !bar.isConnected) applyVideoMode();
    const v = video(); if (!bar || !v) return;
    const d = isFinite(v.duration) ? v.duration : 0;
    if (!seeking) { bar.__seek.max = String(Math.floor(d)); bar.__seek.value = String(Math.floor(v.currentTime || 0)); }
    bar.__time.textContent = fmtTime(seeking ? Number(bar.__seek.value) : v.currentTime) + (d ? ' / ' + fmtTime(d) : '');
    setIcon(bar.__play, v.paused ? ICONS.play : ICONS.pause);
  };
  setInterval(updateBar, 250);
  document.addEventListener('mousemove', () => { if (videoOn) showBar(); }, true);
  document.addEventListener('keydown', (e) => {
    if (!videoOn) return;
    showBar();
    if (e.key === 'Escape' && videoFull) { e.preventDefault(); report({ action: 'videoWindowed' }); }
    else if (e.key === ' ' || e.key === 'k') { e.preventDefault(); e.stopPropagation(); const v = video(); if (v) { if (v.paused) window.__stalow.play(); else window.__stalow.pause(); } }
  }, true);
  document.addEventListener('fullscreenchange', () => { if (videoOn && videoFull && !document.fullscreenElement) report({ action: 'videoWindowed' }); });
  window.__stalow = {
    expect(id) { expected = id; endedSent = false; wantPlaying = true; },
    play() { wantPlaying = true; const v = video(); if (v) v.play().catch(() => {}); },
    pause() { wantPlaying = false; const v = video(); if (v) v.pause(); },
    seek(s) { const v = video(); if (v && isFinite(s)) v.currentTime = s; },
    volume(x) { volume = Math.max(0, Math.min(1, x)); const v = video(); if (v && !isAd()) v.volume = volume; },
    audio(o) { opts = Object.assign(opts, o || {}); applyGraph(); applyQuality(); applyVideoBlock(); },
    record(id) { return expected === id && startRec(id); },
    cancelRecord() { stopRec(false); },
    videoMode(on, full, labels) { videoOn = !!on; videoFull = !!full; if (labels) vlabels = labels; applyVideoMode(); updateBar(); return videoOn; },
  };
  setInterval(() => {
    if (/^consent\./.test(location.hostname)) {
      // the cookie-consent page: press "Reject all" (only necessary cookies) so the song can load
      const btn = [...document.querySelectorAll('button, input[type=submit]')].find((b) => /reject|ablehnen|refuser|rechazar|דחה/i.test(b.textContent || b.value || b.getAttribute('aria-label') || ''));
      if (btn) btn.click();
      return report({ state: 'loading' });
    }
    setHandlers();
    // dismiss "Video paused. Continue watching?" and similar prompts
    document.querySelectorAll('ytmusic-you-there-renderer button, .ytmusic-you-there-renderer button').forEach((b) => b.click());
    const v = video();
    if (!v) return report({ state: 'loading' });
    if (rec) { const pause = isAd() || v.paused; if (pause && rec.mr.state === 'recording') rec.mr.pause(); else if (!pause && rec.mr.state === 'paused') rec.mr.resume(); }
    if (isAd()) {
      // Never let an advert be heard: mute it, jump to its end and press Skip.
      v.muted = true;
      if (isFinite(v.duration) && v.duration > 0) v.currentTime = v.duration;
      document.querySelectorAll('.ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-skip-button-modern').forEach((b) => b.click());
      return report({ state: 'loading' });
    }
    if (v.muted) v.muted = false;
    if (Math.abs(v.volume - volume) > 0.01) v.volume = volume;
    if (opts.normalize || opts.skipSilence) ensureGraph(v);
    applyQuality(); applyVideoBlock();
    // Skip silence: quiet stretches (intros, gaps, long fade-outs) play fast until the music comes back.
    // (Not while a song is being saved: the file gets the song as it is.)
    if (opts.skipSilence && !rec && !v.paused && v.currentTime > 0.5) {
      silentMs = level() < 0.004 ? silentMs + 400 : 0;
      const want = silentMs >= 800;
      if (want !== speeding) { speeding = want; v.playbackRate = want ? 4 : 1; }
    } else if (speeding) { speeding = false; silentMs = 0; v.playbackRate = 1; }
    // YouTube moved on to a song of its own choosing: stop it, the app picks the next song.
    if (expected && vidInUrl() && vidInUrl() !== expected) {
      stopRec(false);
      v.pause();
      if (!endedSent) { endedSent = true; report({ state: 'ended', id: expected }); }
      return;
    }
    if (wantPlaying && v.paused && !v.ended && v.readyState > 2) v.play().catch(() => {});
    if (!wantPlaying && !v.paused) v.pause();
    if (v.ended || (isFinite(v.duration) && v.duration > 0 && v.currentTime >= v.duration - 0.3)) {
      if (!endedSent) { endedSent = true; stopRec(true); v.pause(); report({ state: 'ended', id: expected }); }
      return;
    }
    const md = navigator.mediaSession && navigator.mediaSession.metadata;
    report({ state: v.paused ? 'paused' : 'playing', time: v.currentTime, duration: isFinite(v.duration) ? v.duration : 0, id: expected, album: (md && md.album) || '' });
  }, 400);
})();
`;

// Ad, tracking and recommendation-autoplay requests the hidden player never needs.
const BLOCKED_URLS = [
  '*://*.doubleclick.net/*', '*://*.googlesyndication.com/*', '*://*.googleadservices.com/*',
  '*://*.google-analytics.com/*', '*://*.googletagservices.com/*',
  '*://*.youtube.com/pagead/*', '*://*.youtube.com/api/stats/ads*', '*://*.youtube.com/ptracking*',
  '*://*.youtube.com/get_midroll_*', '*://*.youtube.com/youtubei/v1/log_event*',
];

class Player {
  constructor(onEvent) {
    this.onEvent = onEvent;
    this.win = null;
    this.current = null;
    this.audioOpts = { normalize: false, skipSilence: false, quality: 'auto', blockVideo: false };
  }

  /** Settings > Player & audio (and Content > Block videos), applied to the current song and every next one. */
  setAudio(o) {
    this.audioOpts = { ...this.audioOpts, ...o };
    this.run(`audio(${JSON.stringify(this.audioOpts)})`);
  }

  async init() {
    const ses = session.fromPartition(PARTITION);
    ses.webRequest.onBeforeRequest({ urls: BLOCKED_URLS }, (_d, cb) => cb({ cancel: true }));
    // UK/EU visitors first get YouTube's cookie-consent page, which would stop playback. Answer it up front
    // ("reject all" = only the cookies YouTube needs to work), the way the consent page itself stores it.
    const far = Math.floor(Date.now() / 1000) + 3600 * 24 * 365 * 2;
    for (const url of ['https://www.youtube.com', 'https://music.youtube.com']) {
      await ses.cookies.set({ url, name: 'SOCS', value: 'CAI', domain: '.youtube.com', path: '/', secure: true, sameSite: 'lax', expirationDate: far }).catch(() => {});
      await ses.cookies.set({ url, name: 'CONSENT', value: 'PENDING+987', domain: '.youtube.com', path: '/', secure: true, expirationDate: far }).catch(() => {});
    }
    try {
      const { ElectronBlocker } = require('@ghostery/adblocker-electron');
      const blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
      blocker.enableBlockingInSession(ses);
    } catch (e) {
      console.warn('Ad blocker lists unavailable, using the built-in block list only:', e.message);
    }
    this.win = new BrowserWindow({
      show: false, width: 1100, height: 800, title: 'Stalow Music - YouTube sign-in',
      webPreferences: { partition: PARTITION, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: true, preload: require('path').join(__dirname, 'player-preload.js') },
    });
    this.win.webContents.setAudioMuted(false);
    this.win.on('close', (e) => {
      if (this.quitting) return;
      e.preventDefault();
      if (this.videoMode && this.videoMode !== 'off') { this.showVideo('off'); this.onEvent({ action: 'videoClosed' }); } else this.win.hide();
    });
    this.win.webContents.on('console-message', (...args) => {
      // Electron passes either (event, level, message) or (event) with event.message, depending on version
      const msg = typeof args[2] === 'string' ? args[2] : args[0] && args[0].message;
      if (typeof msg === 'string' && msg.startsWith(STATUS_PREFIX)) {
        let ev = null;
        try { ev = JSON.parse(msg.slice(STATUS_PREFIX.length)); } catch (e) { /* ignore */ }
        if (!ev) return;
        if (ev.state === 'playing' && this.videoMode && this.videoMode !== 'off' && this.videoAppliedFor !== this.current) { this.videoAppliedFor = this.current; this.applyVideo(); }
        this.onEvent(ev);
      }
    });
    this.win.webContents.on('dom-ready', () => this.inject());
    // YouTube Music asks "leave this page?" while a song plays; that silently cancelled loading the next song.
    // The app always means to leave, so allow it.
    this.win.webContents.on('will-prevent-unload', (e) => e.preventDefault());
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  }

  inject() {
    if (!this.win) return;
    const id = this.current;
    this.win.webContents.executeJavaScript(PAGE_SCRIPT + `;window.__stalow.audio(${JSON.stringify(this.audioOpts)});` + (id ? `;window.__stalow.expect(${JSON.stringify(id)});` : ''), true).catch(() => {});
    this.applyVideo();
  }

  async play(videoId) {
    // stop the current song first, so it can never keep playing under the new song's name
    if (/youtube\.com/.test(this.win.webContents.getURL())) {
      const stop = this.win.webContents.executeJavaScript("window.__stalow && window.__stalow.pause(); var v=document.querySelector('video'); if (v) v.pause();", true).catch(() => {});
      await Promise.race([stop, new Promise((r) => setTimeout(r, 1000))]); // never hold up the next song
    }
    this.current = videoId;
    this.onEvent({ state: 'loading', id: videoId });
    await this.win.loadURL(`https://music.youtube.com/watch?v=${encodeURIComponent(videoId)}`).catch((e) => {
      // A redirect (consent page, sign-in check) aborts the first load but the page keeps loading: not an error.
      if (/ERR_ABORTED|\(-3\)/.test(String(e && (e.code || e.message)))) return;
      this.onEvent({ state: 'error', id: videoId, message: e.message });
    });
  }

  /** Download: records the current song while it plays from the start; resolves false when it cannot. */
  async record(videoId) {
    if (!this.win || this.current !== videoId) return false;
    return this.win.webContents.executeJavaScript(`!!(window.__stalow && window.__stalow.record(${JSON.stringify(videoId)}))`, true).catch(() => false);
  }

  cancelRecord() { this.run('cancelRecord()'); }

  run(code) { if (this.win) this.win.webContents.executeJavaScript(`window.__stalow && window.__stalow.${code}`, true).catch(() => {}); }
  resume() { this.run('play()'); }
  pause() { this.run('pause()'); }
  seek(seconds) { this.run(`seek(${Number(seconds) || 0})`); }
  volume(v) { this.run(`volume(${Number(v)})`); }

  /** Shows the hidden window on the Google sign-in page; signing in is optional. */
  showSignIn() {
    this.signingIn = true;
    this.pause();
    this.win.loadURL('https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F');
    this.win.show();
  }

  hide() { if (this.win) this.win.hide(); }

  /**
   * Videos and podcasts as video: 'full' (full screen), 'window' (a normal window) or 'off' (hidden: audio only).
   * The window is YouTube Music's own player, so the video and the sound stay one stream.
   */
  showVideo(mode, labels) {
    this.videoMode = ['full', 'window'].includes(mode) ? mode : 'off';
    if (labels) this.videoLabels = labels;
    if (!this.win || this.signingIn) return this.videoMode;
    if (this.videoMode === 'off') {
      this.run('videoMode(false)');
      if (this.win.isFullScreen()) this.win.setFullScreen(false);
      this.win.hide();
      return this.videoMode;
    }
    this.win.setTitle('Stalow Music');
    if (!this.win.isVisible()) this.win.show();
    this.win.setFullScreen(this.videoMode === 'full');
    this.win.focus();
    this.applyVideo();
    return this.videoMode;
  }

  applyVideo() {
    if (!this.videoMode || this.videoMode === 'off') return;
    this.run(`videoMode(true, ${this.videoMode === 'full'}, ${JSON.stringify(this.videoLabels || {})})`);
  }

  /** Settings > "Show the YouTube player": to see what YouTube is showing when a song will not play. */
  toggleVisible() { if (!this.win) return false; if (this.win.isVisible()) this.win.hide(); else this.win.show(); return this.win.isVisible(); }

  destroy() { this.quitting = true; if (this.win) this.win.destroy(); }
}

module.exports = { Player, PAGE_SCRIPT, BLOCKED_URLS, STATUS_PREFIX };
