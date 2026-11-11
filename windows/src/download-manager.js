'use strict';
// Background downloads. Each song is saved by its own hidden, silent YouTube Music player: it plays the song once
// from the start and the sound is recorded (YouTube's web player gives out no file). Up to three songs are saved at
// the same time, whatever is playing in the app. The waiting list survives a restart.

const fs = require('fs');

const MAX_PARALLEL = 3;
const START_TIMEOUT_MS = 90 * 1000; // the song did not start playing
const STALL_TIMEOUT_MS = 60 * 1000; // no progress for this long
const MAX_ATTEMPTS = 2;

class DownloadManager {
  /**
   * opts: { downloads (Downloads), createWindow () => BrowserWindow, pageScript (the player's page script),
   *         statusPrefix, queueFile, onChange (jobs) => void, maxBytes }
   */
  constructor(opts) {
    this.o = opts;
    this.jobs = []; // { song, state: waiting|saving|failed, attempts, progress, duration, win, chunks, size, reason }
    this.loadQueue();
  }

  /** What the Downloads page shows: the songs waiting, being saved, or failed. */
  list() {
    return this.jobs.map((j) => ({ id: j.song.id, song: j.song, state: j.state, progress: j.progress || 0, duration: j.duration || j.song.duration || 0, reason: j.reason || '' }));
  }

  /** Adds songs to the download list (songs already saved or already listed are skipped). */
  add(songs) {
    let added = 0;
    for (const song of songs) {
      if (!song || this.o.downloads.get(song.id)) continue;
      const existing = this.jobs.find((j) => j.song.id === song.id);
      if (existing) { if (existing.state === 'failed') { existing.state = 'waiting'; existing.attempts = 0; existing.reason = ''; added++; } continue; }
      this.jobs.push({ song, state: 'waiting', attempts: 0, progress: 0 });
      added++;
    }
    this.changed();
    this.pump();
    return added;
  }

  /** Stops and removes one song from the list (or all of them with no id). */
  cancel(id) {
    for (const j of this.jobs.filter((x) => !id || x.song.id === id)) this.stopWindow(j);
    this.jobs = this.jobs.filter((x) => id && x.song.id !== id);
    this.changed();
    this.pump();
  }

  /** Tries the failed songs again. */
  retry() {
    for (const j of this.jobs) if (j.state === 'failed') { j.state = 'waiting'; j.attempts = 0; j.reason = ''; }
    this.changed();
    this.pump();
  }

  pump() {
    while (this.jobs.filter((j) => j.state === 'saving').length < MAX_PARALLEL) {
      const next = this.jobs.find((j) => j.state === 'waiting');
      if (!next) break;
      this.start(next);
    }
  }

  start(job) {
    job.state = 'saving'; job.attempts++; job.progress = 0; job.chunks = []; job.size = 0; job.recording = false;
    job.startedAt = Date.now(); job.lastProgressAt = Date.now();
    const win = this.o.createWindow();
    job.win = win;
    const wc = win.webContents;
    wc.setAudioMuted(true); // silent: the recording is taken from the player, not from the speakers
    wc.on('will-prevent-unload', (e) => e.preventDefault());
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('dom-ready', () => {
      wc.executeJavaScript(this.o.pageScript + `;window.__stalow.audio({});window.__stalow.expect(${JSON.stringify(job.song.id)});`, true).catch(() => {});
    });
    wc.on('console-message', (...args) => {
      const msg = typeof args[2] === 'string' ? args[2] : args[0] && args[0].message;
      if (typeof msg !== 'string' || !msg.startsWith(this.o.statusPrefix)) return;
      let ev; try { ev = JSON.parse(msg.slice(this.o.statusPrefix.length)); } catch { return; }
      if (job.recording && typeof ev.time === 'number') {
        if (ev.time > job.progress + 0.5) job.lastProgressAt = Date.now();
        job.progress = ev.time; if (ev.duration) job.duration = ev.duration;
        this.changedSoon();
      }
    });
    // start recording as soon as the song is ready (the page script plays it from the start)
    job.timer = setInterval(() => {
      if (job.win !== win || win.isDestroyed()) return clearInterval(job.timer);
      const now = Date.now();
      if (!job.recording) {
        if (now - job.startedAt > START_TIMEOUT_MS) return this.finish(job, false, 'did not start');
        wc.executeJavaScript(`!!(window.__stalow && window.__stalow.record(${JSON.stringify(job.song.id)}))`, true)
          .then((ok) => { if (ok && job.win === win) { job.recording = true; job.lastProgressAt = Date.now(); } }).catch(() => {});
      } else if (now - job.lastProgressAt > STALL_TIMEOUT_MS) {
        this.finish(job, false, 'stopped playing');
      }
    }, 1000);
    win.loadURL(`https://music.youtube.com/watch?v=${encodeURIComponent(job.song.id)}`).catch(() => { /* redirects (consent, sign-in) are fine */ });
    this.changed();
  }

  /** Audio from a download window: accepted only from that song's own window, up to the size limit. */
  onChunk(sender, id, data) {
    const job = this.jobs.find((j) => j.win && !j.win.isDestroyed() && j.win.webContents === sender);
    if (!job || job.song.id !== id || !(data instanceof ArrayBuffer)) return;
    job.size += data.byteLength;
    if (job.size > this.o.maxBytes) return this.finish(job, false, 'too large');
    job.chunks.push(Buffer.from(data));
  }

  onDone(sender, id, ok) {
    const job = this.jobs.find((j) => j.win && !j.win.isDestroyed() && j.win.webContents === sender);
    if (!job || job.song.id !== id) return;
    this.finish(job, ok, ok ? '' : 'stopped early');
  }

  /** True when [sender] is one of the download windows (their messages are handled here). */
  owns(sender) { return this.jobs.some((j) => j.win && !j.win.isDestroyed() && j.win.webContents === sender); }

  finish(job, ok, reason) {
    const chunks = job.chunks || [];
    this.stopWindow(job);
    if (ok) {
      try {
        this.o.downloads.save(job.song, Buffer.concat(chunks));
        this.jobs = this.jobs.filter((j) => j !== job);
        if (this.o.onSaved) this.o.onSaved(job.song);
      } catch (e) { ok = false; reason = e.message; }
    }
    if (!ok) {
      if (job.attempts < MAX_ATTEMPTS) { job.state = 'waiting'; job.reason = reason; } // one more try
      else { job.state = 'failed'; job.reason = reason; }
    }
    this.changed();
    this.pump();
  }

  stopWindow(job) {
    clearInterval(job.timer);
    if (job.win && !job.win.isDestroyed()) job.win.destroy();
    job.win = null; job.chunks = []; job.size = 0; job.recording = false;
  }

  /** Closes every download window (the app is quitting); the waiting list is kept for next time. */
  destroy() { for (const j of this.jobs) this.stopWindow(j); this.saveQueue(); }

  changed() { this.saveQueue(); if (this.o.onChange) this.o.onChange(this.list()); }

  changedSoon() {
    if (this.soon) return;
    this.soon = setTimeout(() => { this.soon = null; if (this.o.onChange) this.o.onChange(this.list()); }, 1000);
  }

  saveQueue() {
    if (!this.o.queueFile) return;
    try { fs.writeFileSync(this.o.queueFile, JSON.stringify(this.jobs.filter((j) => j.state !== 'failed').map((j) => j.song))); } catch { /* ignore */ }
  }

  loadQueue() {
    if (!this.o.queueFile) return;
    let songs = [];
    try { songs = JSON.parse(fs.readFileSync(this.o.queueFile, 'utf8')); } catch { songs = []; }
    if (!Array.isArray(songs)) return;
    for (const s of songs) if (s && typeof s.id === 'string' && /^[\w-]{6,20}$/.test(s.id)) this.jobs.push({ song: s, state: 'waiting', attempts: 0, progress: 0 });
  }
}

module.exports = { DownloadManager, MAX_PARALLEL };
