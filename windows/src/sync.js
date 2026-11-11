'use strict';
// Phone <-> PC sync through Stalow's Supabase project. There are no accounts: the first device makes a private sync
// code (24 letters/digits) and the others type it in. The server keeps each code's data apart and never stores the
// code itself. What is shared:
//   history   recently played songs
//   like      liked songs
//   download  the list of downloaded songs - each device downloads the songs itself (no song files go online)
//   settings  the settings both apps have (theme, content filters, lyrics, history and queue options)
//   session   what each device is playing, for "Continue from your phone"
const crypto = require('crypto');
const fs = require('fs');

const SYNC_URL = 'https://dzrnortzhpnoussbeedv.supabase.co/functions/v1/stalow-sync';
const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
/** Settings that both apps have, under the Windows app's names. */
const SHARED_SETTINGS = ['theme', 'allowFemale', 'blockPodcasts', 'blockVideos', 'audioNormalization', 'skipSilence', 'persistentQueue',
  'autoLoadMore', 'lyricsWordSync', 'lyricsAutoScroll', 'lyricsPosition', 'pauseListenHistory', 'pauseSearchHistory', 'historyDays', 'videoFirst'];

/** A new sync code: 24 characters in groups of four, about 120 bits. */
function newCode(random = crypto.randomBytes) {
  const bytes = random(24);
  const chars = [...bytes].map((b) => CODE_ALPHABET[b % 32]).join('');
  return chars.match(/.{4}/g).join('-');
}

/** "abcd efgh-..." -> "ABCD-EFGH-..."; null when it is not a sync code. */
function cleanCode(text) {
  const c = String(text || '').toUpperCase().replace(/[\s-]/g, '');
  return /^[A-Z2-7]{24}$/.test(c) ? c.match(/.{4}/g).join('-') : null;
}

/**
 * What counts as a change, per kind. The phone and the PC store songs a little differently (thumbnail sizes, artist
 * ids), so comparing whole rows would make them send their own copy back forever. Only what matters is compared:
 * when it was played / liked (to the second), whether it is liked or downloaded, the setting's value, and for what
 * is playing, the song and the position to half a minute. The Android app uses the same rules.
 */
function fingerprint(kind, data, deleted) {
  const d = data || {};
  const sec = (ms) => Math.floor((Number(ms) || 0) / 1000);
  switch (kind) {
    case 'history': return `h:${sec(d.playedAt)}`;
    case 'like': return `l:${deleted ? 0 : 1}:${sec(d.likedAt)}`;
    case 'download': return `d:${deleted ? 0 : 1}`;
    case 'settings': return `s:${JSON.stringify(d.value === undefined ? null : d.value)}`;
    case 'session': return `p:${Number(d.at) || 0}:${Math.floor((Number(d.time) || 0) / 30)}`;
    default: return `x:${JSON.stringify(d)}:${!!deleted}`;
  }
}
const fp = (row) => fingerprint(row.kind, row.data, row.deleted);
const songOf = (s) => ({ id: s.id, title: s.title || '', artists: (s.artists || []).map((a) => ({ id: a.id || null, name: a.name })), album: s.album || null, thumbnail: s.thumbnail || '', duration: s.duration || null });

class Sync {
  /**
   * opts: { file (sync.json), deviceName, fetchImpl, local: { history(), setHistory(list), likes(), setLikes(list),
   *         downloads(), queueDownloads(songs), settings(), applySettings(changes), session() }, onChange(status) }
   */
  constructor(opts) {
    this.o = opts;
    this.fetch = opts.fetchImpl || fetch;
    this.state = this.load();
    this.status = { state: this.state.code ? 'idle' : 'off', lastSync: this.state.lastSync || null, error: null };
    this.remoteSessions = this.state.remoteSessions || {};
    this.timer = null;
    this.running = null;
  }

  load() {
    let s = {};
    try { s = JSON.parse(fs.readFileSync(this.o.file, 'utf8')); } catch { s = {}; }
    if (!s.deviceId) s.deviceId = crypto.randomBytes(8).toString('hex');
    if (!s.pushed || typeof s.pushed !== 'object') s.pushed = {};
    return s;
  }

  save() { try { fs.writeFileSync(this.o.file, JSON.stringify(this.state)); } catch { /* ignore */ } }

  /** For Settings > Sync. The code is shown so it can be typed on the other device. */
  info() {
    return { code: this.state.code || null, ...this.status, deviceName: this.o.deviceName, remoteSessions: this.remoteSessions };
  }

  setStatus(patch) { this.status = { ...this.status, ...patch }; if (this.o.onChange) this.o.onChange(this.info()); }

  /** Starts syncing with a new code (this is the first device). */
  async create() { return this.join(newCode()); }

  /** Starts syncing with a code made on another device. */
  async join(text) {
    const code = cleanCode(text);
    if (!code) throw new Error('That is not a sync code (24 letters and digits)');
    this.state = { deviceId: this.state.deviceId, code, cursor: null, pushed: {}, remoteSessions: {} };
    this.remoteSessions = {};
    this.save();
    this.setStatus({ state: 'idle', error: null });
    await this.syncNow();
    this.start();
    return this.info();
  }

  /** Stops syncing on this device; with [erase], also deletes everything synced under the code. */
  async leave(erase = false) {
    const code = this.state.code;
    this.stop();
    if (erase && code) await this.call({ action: 'forget', code });
    this.state = { deviceId: this.state.deviceId, pushed: {} };
    this.remoteSessions = {};
    this.save();
    this.setStatus({ state: 'off', lastSync: null, error: null });
  }

  start(intervalMs = 60000) {
    this.stop();
    if (!this.state.code) return;
    this.timer = setInterval(() => this.syncNow().catch(() => {}), intervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop() { clearInterval(this.timer); this.timer = null; clearTimeout(this.soonTimer); }

  /** A local change: sync a few seconds later (changes close together go in one request). */
  soon() {
    if (!this.state.code) return;
    clearTimeout(this.soonTimer);
    this.soonTimer = setTimeout(() => this.syncNow().catch(() => {}), 4000);
    if (this.soonTimer.unref) this.soonTimer.unref();
  }

  async call(body) {
    const res = await this.fetch(SYNC_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, device: this.state.deviceId }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Sync failed (HTTP ${res.status})`);
    return json;
  }

  /** What this device has now, as sync rows: [{ kind, key, data, deleted }]. */
  localItems() {
    const L = this.o.local;
    const items = [];
    for (const s of L.history().slice(0, 200)) items.push({ kind: 'history', key: s.id, data: { ...songOf(s), playedAt: s.playedAt || 0 } });
    for (const s of L.likes()) items.push({ kind: 'like', key: s.id, data: { ...songOf(s), likedAt: s.likedAt || 0 }, deleted: !!s.unliked });
    for (const s of L.downloads()) items.push({ kind: 'download', key: s.id, data: songOf(s) });
    const settings = L.settings();
    for (const k of SHARED_SETTINGS) items.push({ kind: 'settings', key: k, data: { value: settings[k] } });
    const session = L.session();
    if (session) items.push({ kind: 'session', key: this.state.deviceId, data: { ...session, device: this.o.deviceName, at: session.at || Date.now() } });
    return items;
  }

  /** One round: fetch and apply what changed elsewhere, then send what changed here. */
  async syncNow() {
    if (!this.state.code) return this.info();
    if (this.running) return this.running;
    this.running = (async () => {
      this.setStatus({ state: 'syncing' });
      try {
        // first fetch and apply what changed elsewhere (rows this device already has are skipped)
        let more = true;
        while (more) {
          const r = await this.call({ action: 'pull', code: this.state.code, since: this.state.cursor });
          const fresh = (r.items || []).filter((x) => x.device !== this.state.deviceId && this.state.pushed[`${x.kind}:${x.key}`] !== fp(x));
          this.apply(fresh);
          const last = (r.items || [])[r.items.length - 1];
          more = (r.items || []).length >= 1000 && last && last.updated_at !== this.state.cursor;
          if (last) this.state.cursor = last.updated_at;
        }
        // then send what changed here (pulling first means a device that joins takes the shared settings, not its own)
        const changed = this.localItems().filter((it) => this.state.pushed[`${it.kind}:${it.key}`] !== fp(it));
        for (let i = 0; i < changed.length; i += 400) {
          const part = changed.slice(i, i + 400);
          await this.call({ action: 'push', code: this.state.code, items: part });
          for (const it of part) this.state.pushed[`${it.kind}:${it.key}`] = fp(it);
        }
        this.state.lastSync = new Date().toISOString();
        this.state.remoteSessions = this.remoteSessions;
        this.save();
        this.setStatus({ state: 'idle', lastSync: this.state.lastSync, error: null });
      } catch (e) {
        this.save();
        this.setStatus({ state: 'error', error: e.message || String(e) });
      } finally { this.running = null; }
      return this.info();
    })();
    return this.running;
  }

  /** Applies rows from the other devices. Each applied value is marked as already sent, so it does not bounce back. */
  apply(rows) {
    if (!rows.length) return;
    const L = this.o.local;
    const mark = (r) => { this.state.pushed[`${r.kind}:${r.key}`] = fp(r); };
    // history: merge, newest first
    const hist = rows.filter((r) => r.kind === 'history' && !r.deleted);
    if (hist.length) {
      const list = L.history();
      const byId = new Map(list.map((s) => [s.id, s]));
      for (const r of hist) {
        const mine = byId.get(r.key);
        if (!mine || (r.data.playedAt || 0) > (mine.playedAt || 0)) byId.set(r.key, { type: 'song', ...songOf({ ...r.data, id: r.key }), playedAt: r.data.playedAt || 0 });
      }
      L.setHistory([...byId.values()].sort((a, b) => (b.playedAt || 0) - (a.playedAt || 0)).slice(0, 500));
      hist.forEach(mark);
    }
    // likes: the latest change wins
    const likes = rows.filter((r) => r.kind === 'like');
    if (likes.length) {
      const byId = new Map(L.likes().map((s) => [s.id, s]));
      for (const r of likes) {
        const mine = byId.get(r.key);
        if (mine && (mine.likedAt || 0) > (r.data.likedAt || 0)) continue; // a newer change here wins
        byId.set(r.key, { type: 'song', ...songOf({ ...r.data, id: r.key }), likedAt: r.data.likedAt || 0, ...(r.deleted ? { unliked: true } : {}) });
      }
      L.setLikes([...byId.values()]);
      likes.forEach(mark);
    }
    // downloads: songs downloaded on another device are downloaded here too
    const dls = rows.filter((r) => r.kind === 'download' && !r.deleted);
    if (dls.length) {
      const have = new Set(L.downloads().map((d) => d.id));
      const want = dls.filter((r) => !have.has(r.key)).map((r) => ({ type: 'song', ...songOf({ ...r.data, id: r.key }) }));
      if (want.length) L.queueDownloads(want);
      dls.forEach(mark);
    }
    // settings
    const changes = {};
    for (const r of rows.filter((x) => x.kind === 'settings' && SHARED_SETTINGS.includes(x.key) && x.data && 'value' in x.data)) { changes[r.key] = r.data.value; mark(r); }
    if (Object.keys(changes).length) {
      L.applySettings(changes);
      const now = L.settings();
      for (const k of Object.keys(changes)) this.state.pushed[`settings:${k}`] = fingerprint('settings', { value: now[k] });
    }
    // what the other devices are playing
    for (const r of rows.filter((x) => x.kind === 'session' && x.key !== this.state.deviceId)) {
      if (r.deleted) delete this.remoteSessions[r.key]; else this.remoteSessions[r.key] = { ...r.data, updatedAt: r.updated_at };
    }
  }
}

module.exports = { Sync, newCode, cleanCode, fingerprint, SHARED_SETTINGS, SYNC_URL };
