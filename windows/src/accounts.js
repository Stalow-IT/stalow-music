'use strict';
// Stalow Music accounts (same server and rules as the Android app): this PC signs up with a name and waits until an
// admin approves it, as a user or an admin. It proves who it is with a random private key kept on the PC; the
// server keeps only its hash. The last answer is remembered, so an approved PC keeps working offline.
// Admins also manage the channel / artist list here (added, moved between categories, removed for everyone).
const fs = require('fs');
const crypto = require('crypto');

const URL = 'https://dzrnortzhpnoussbeedv.supabase.co/functions/v1/stalow-accounts';
const CATEGORIES = ['music', 'podcasts', 'shiurim', 'videos'];

const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJson = (file, data) => { try { fs.writeFileSync(file, JSON.stringify(data)); } catch { /* read-only disk: kept in memory */ } };

/** The admins' changes, checked: {version, entries: {id: {id, name, thumbnail, category, removed}}}. */
function cleanCatalog(json) {
  const entries = {};
  for (const e of Array.isArray(json && json.entries) ? json.entries : []) {
    if (!e || typeof e.id !== 'string' || !e.id.startsWith('UC') || !CATEGORIES.includes(e.category)) continue;
    entries[e.id] = {
      id: e.id, name: String(e.name || ''), category: e.category, removed: e.removed === true,
      thumbnail: typeof e.thumbnail === 'string' && /^https:\/\//.test(e.thumbnail) ? e.thumbnail : '',
    };
  }
  return { version: Number(json && json.version) || 0, entries };
}

class Accounts {
  constructor({ file, catalogFile, fetchImpl = fetch, deviceName = 'PC' }) {
    this.file = file;
    this.catalogFile = catalogFile;
    this.fetch = fetchImpl;
    this.deviceName = deviceName;
    const saved = readJson(file, {});
    this.key = typeof saved.key === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(saved.key) ? saved.key : crypto.randomBytes(32).toString('base64url');
    this.state = { status: ['pending', 'approved', 'blocked'].includes(saved.status) ? saved.status : 'none', role: saved.role || 'user', name: saved.name || '', id: saved.id || '' };
    this.save();
    this.catalog = cleanCatalog(readJson(catalogFile, {}));
  }

  save() { writeJson(this.file, { key: this.key, ...this.state }); }

  get isAdmin() { return this.state.status === 'approved' && (this.state.role === 'admin' || this.state.role === 'owner'); }

  /** One server call; throws with the server's reason. */
  async call(action, extra = {}) {
    const res = await this.fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...extra, action, key: this.key }) });
    let json;
    try { json = await res.json(); } catch { throw new Error(`bad answer (${res.status})`); }
    if (!res.ok || json.error) throw new Error(json.error || `failed (${res.status})`);
    return json;
  }

  apply(json) {
    const status = ['pending', 'approved', 'blocked'].includes(json.status) ? json.status : 'none';
    this.state = { status, role: json.role || 'user', name: json.name || this.state.name, id: json.id || '' };
    this.save();
    return this.state;
  }

  async register(name) { return this.apply(await this.call('register', { name: String(name || '').trim(), device: this.deviceName })); }

  async claimOwner(name, code) {
    if (this.state.status === 'none') await this.register(name);
    return this.apply(await this.call('claimOwner', { code: String(code || '').trim() }));
  }

  /** Asks for this PC's status; without a connection the last answer stays. */
  async refresh() {
    try { this.apply(await this.call('status')); return true; } catch { return false; }
  }

  /** Fetches the admins' channel changes; true when they changed. */
  async refreshCatalog() {
    if (this.state.status !== 'approved') return false;
    try {
      const json = await this.call('catalog.get');
      const next = cleanCatalog(json);
      if (JSON.stringify(next) === JSON.stringify(this.catalog)) return false;
      this.catalog = next;
      writeJson(this.catalogFile, json);
      return true;
    } catch { return false; }
  }

  // ---- admins ----
  async accounts() { return (await this.call('accounts.list')).accounts || []; }
  async decide(id, { status, role } = {}) { return this.call('accounts.decide', { id, status, role }); }
  async search(q) { return (await this.call('catalog.search', { q })).results || []; }
  async setEntry(entry) {
    await this.call('catalog.set', { entry });
    await this.refreshCatalog();
  }
}

module.exports = { Accounts, cleanCatalog, CATEGORIES, URL };
