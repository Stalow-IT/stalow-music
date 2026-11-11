'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Sync, newCode, cleanCode } = require('../src/sync');

/** The stalow-sync server in memory: rows per code, server time cursor. */
function fakeServer() {
  const rows = new Map(); // code -> Map(kind:key -> row)
  let clock = 0;
  const pushes = [];
  const fetchImpl = async (_url, init) => {
    const b = JSON.parse(init.body);
    const code = cleanCode(b.code);
    if (!code) return { ok: false, status: 400, json: async () => ({ error: 'bad sync code' }) };
    if (!rows.has(code)) rows.set(code, new Map());
    const mine = rows.get(code);
    if (b.action === 'push') {
      pushes.push(b.items.length);
      for (const it of b.items) mine.set(`${it.kind}:${it.key}`, { kind: it.kind, key: it.key, data: it.data, deleted: !!it.deleted, device: b.device, updated_at: new Date(1e12 + ++clock).toISOString() });
      return { ok: true, json: async () => ({ saved: b.items.length }) };
    }
    if (b.action === 'pull') {
      const items = [...mine.values()].filter((r) => !b.since || r.updated_at >= b.since).sort((x, y) => x.updated_at.localeCompare(y.updated_at));
      return { ok: true, json: async () => ({ items }) };
    }
    if (b.action === 'forget') { rows.delete(code); return { ok: true, json: async () => ({ deleted: true }) }; }
    return { ok: false, status: 400, json: async () => ({}) };
  };
  return { fetchImpl, rows, pushes };
}

/** One device's local data. */
function device(server, dir, name, store = (l) => l) {
  const d = { history: [], likes: [], downloads: [], queued: [], settings: { theme: 'dark', allowFemale: false, historyDays: 30 }, applied: [], session: null };
  d.sync = new Sync({
    file: path.join(dir, `${name}.json`), deviceName: name, fetchImpl: server.fetchImpl,
    local: {
      history: () => d.history, setHistory: (l) => { d.history = store(l); },
      likes: () => d.likes, setLikes: (l) => { d.likes = store(l); },
      downloads: () => d.downloads, queueDownloads: (songs) => { d.queued.push(...songs.map((s) => s.id)); },
      settings: () => d.settings, applySettings: (c) => { Object.assign(d.settings, c); if (d.settings.theme === 'black' && name === 'Phone2') d.settings.theme = 'dark'; d.applied.push(c); },
      session: () => d.session,
    },
  });
  return d;
}
const song = (id, extra = {}) => ({ type: 'song', id, title: `Song ${id}`, artists: [{ id: 'UCx', name: 'A' }], thumbnail: '', duration: 200, ...extra });

test('sync codes', () => {
  const c = newCode();
  assert.match(c, /^[A-Z2-7]{4}(-[A-Z2-7]{4}){5}$/);
  assert.strictEqual(cleanCode(c.toLowerCase().replace(/-/g, ' ')), c);
  assert.strictEqual(cleanCode('short'), null);
  assert.notStrictEqual(newCode(), newCode());
});

test('phone and PC: history, likes, downloads, settings and what is playing reach the other device', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stalow-sync-'));
  const server = fakeServer();
  const pc = device(server, dir, 'PC');
  const phone = device(server, dir, 'Phone');
  pc.history = [song('aaaaaaaaaaa', { playedAt: 100 })];
  pc.settings.theme = 'light';
  const { code } = await pc.sync.create();
  // the phone has its own history, a like, a download, and is playing something
  phone.history = [song('bbbbbbbbbbb', { playedAt: 200 })];
  phone.likes = [song('ccccccccccc', { likedAt: 5 })];
  phone.downloads = [song('ddddddddddd')];
  phone.session = { queue: [song('bbbbbbbbbbb')], index: 0, time: 42, at: 300 };
  await phone.sync.join(code);
  assert.deepStrictEqual(phone.history.map((s) => s.id), ['bbbbbbbbbbb', 'aaaaaaaaaaa'], 'the PC history arrived, newest first');
  assert.strictEqual(phone.settings.theme, 'light', 'the PC settings arrived');
  await pc.sync.syncNow();
  assert.deepStrictEqual(pc.history.map((s) => s.id), ['bbbbbbbbbbb', 'aaaaaaaaaaa']);
  assert.deepStrictEqual(pc.likes.map((s) => s.id), ['ccccccccccc']);
  assert.deepStrictEqual(pc.queued, ['ddddddddddd'], 'the phone download is downloaded on the PC too');
  assert.strictEqual(pc.settings.theme, 'light', 'the joining phone did not overwrite the shared settings');
  assert.strictEqual(phone.settings.theme, 'light');
  const offer = Object.values(pc.sync.info().remoteSessions)[0];
  assert.strictEqual(offer.device, 'Phone');
  assert.strictEqual(offer.time, 42);
  // nothing bounces back and forth once both are up to date
  const before = server.pushes.length;
  await pc.sync.syncNow(); await phone.sync.syncNow(); await pc.sync.syncNow();
  assert.strictEqual(server.pushes.length, before, 'no further pushes when nothing changed');
  // an unlike on the PC reaches the phone
  pc.likes = [{ ...pc.likes[0], unliked: true, likedAt: 9 }];
  await pc.sync.syncNow(); await phone.sync.syncNow();
  assert.strictEqual(phone.likes[0].unliked, true);
  // a settings change on the phone reaches the PC
  phone.settings.allowFemale = true;
  await phone.sync.syncNow(); await pc.sync.syncNow();
  assert.strictEqual(pc.settings.allowFemale, true);
  // a different code sees nothing
  const other = device(server, dir, 'Other');
  await other.sync.create();
  assert.deepStrictEqual(other.history, []);
  // stop and delete
  await pc.sync.leave(true);
  assert.strictEqual(pc.sync.info().state, 'off');
  assert.ok(!server.rows.has(code));
  await assert.rejects(pc.sync.join('nope'), /not a sync code/);
});

test('devices that store songs differently do not send them back and forth', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stalow-sync-'));
  const server = fakeServer();
  // this "phone" keeps other thumbnails, no artist ids and a millisecond-rounded time, and has no black theme
  const store = (l) => l.map((s) => ({ ...s, thumbnail: 'phone-size', artists: s.artists.map((a) => ({ name: a.name })), playedAt: s.playedAt && s.playedAt - (s.playedAt % 1000) + 7 }));
  const pc = device(server, dir, 'PC');
  const phone = device(server, dir, 'Phone2', store);
  pc.history = [song('aaaaaaaaaaa', { playedAt: 1700000000123 })];
  pc.likes = [song('ccccccccccc', { likedAt: 1700000000456 })];
  pc.settings.theme = 'black';
  const { code } = await pc.sync.create();
  await phone.sync.join(code);
  assert.strictEqual(phone.history[0].thumbnail, 'phone-size');
  assert.strictEqual(phone.settings.theme, 'dark', 'the phone holds the nearest theme it has');
  for (let i = 0; i < 3; i++) { await pc.sync.syncNow(); await phone.sync.syncNow(); }
  const before = server.pushes.length;
  for (let i = 0; i < 3; i++) { await pc.sync.syncNow(); await phone.sync.syncNow(); }
  assert.strictEqual(server.pushes.length, before, 'quiet once both are up to date');
  assert.strictEqual(pc.settings.theme, 'black', 'the PC keeps black: the phone did not send its nearest theme back');
  // a real change still goes through
  phone.history = [{ ...phone.history[0], playedAt: 1800000000000 }];
  await phone.sync.syncNow(); await pc.sync.syncNow();
  assert.strictEqual(pc.history[0].playedAt, 1800000000000);
});
