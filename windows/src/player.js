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
  window.__stalow = {
    expect(id) { expected = id; endedSent = false; wantPlaying = true; },
    play() { wantPlaying = true; const v = video(); if (v) v.play().catch(() => {}); },
    pause() { wantPlaying = false; const v = video(); if (v) v.pause(); },
    seek(s) { const v = video(); if (v && isFinite(s)) v.currentTime = s; },
    volume(x) { volume = Math.max(0, Math.min(1, x)); const v = video(); if (v && !isAd()) v.volume = volume; },
    audio(o) { opts = Object.assign(opts, o || {}); applyGraph(); applyQuality(); applyVideoBlock(); },
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
    if (opts.skipSilence && !v.paused && v.currentTime > 0.5) {
      silentMs = level() < 0.004 ? silentMs + 400 : 0;
      const want = silentMs >= 800;
      if (want !== speeding) { speeding = want; v.playbackRate = want ? 4 : 1; }
    } else if (speeding) { speeding = false; silentMs = 0; v.playbackRate = 1; }
    // YouTube moved on to a song of its own choosing: stop it, the app picks the next song.
    if (expected && vidInUrl() && vidInUrl() !== expected) {
      v.pause();
      if (!endedSent) { endedSent = true; report({ state: 'ended', id: expected }); }
      return;
    }
    if (wantPlaying && v.paused && !v.ended && v.readyState > 2) v.play().catch(() => {});
    if (!wantPlaying && !v.paused) v.pause();
    if (v.ended || (isFinite(v.duration) && v.duration > 0 && v.currentTime >= v.duration - 0.3)) {
      if (!endedSent) { endedSent = true; v.pause(); report({ state: 'ended', id: expected }); }
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
      webPreferences: { partition: PARTITION, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    this.win.webContents.setAudioMuted(false);
    this.win.on('close', (e) => { if (!this.quitting) { e.preventDefault(); this.win.hide(); } });
    this.win.webContents.on('console-message', (...args) => {
      // Electron passes either (event, level, message) or (event) with event.message, depending on version
      const msg = typeof args[2] === 'string' ? args[2] : args[0] && args[0].message;
      if (typeof msg === 'string' && msg.startsWith(STATUS_PREFIX)) {
        try { this.onEvent(JSON.parse(msg.slice(STATUS_PREFIX.length))); } catch (e) { /* ignore */ }
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

  /** Settings > "Show the YouTube player": to see what YouTube is showing when a song will not play. */
  toggleVisible() { if (!this.win) return false; if (this.win.isVisible()) this.win.hide(); else this.win.show(); return this.win.isVisible(); }

  destroy() { this.quitting = true; if (this.win) this.win.destroy(); }
}

module.exports = { Player, PAGE_SCRIPT, BLOCKED_URLS };
