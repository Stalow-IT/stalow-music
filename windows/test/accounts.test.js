'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { applyOverrides, catalogRows, Catalog } = require('../src/catalog');
const { Accounts, cleanCatalog } = require('../src/accounts');

const A = 'UCaaaaaaaaaaaaaaaaaaaaaa';
const B = 'UCbbbbbbbbbbbbbbbbbbbbbb';
const P = 'UCpppppppppppppppppppppp';
const N = 'UCnnnnnnnnnnnnnnnnnnnnnn';
const list = { version: 4, artists: [{ id: A, name: 'Artist A', thumbnail: 'https://x/a.jpg' }, { id: B, name: 'Artist B' }] };
const channels = { version: 2, podcasts: [{ id: P, name: 'Pod', thumbnailUrl: 'https://x/p.jpg' }], shiurim: [], videos: [{ id: P, name: 'Pod' }] };

test('admin changes: removed shows nowhere, moved shows only in its new place, added joins', () => {
  const entries = {
    [A]: { id: A, name: 'Artist A', category: 'music', removed: true, thumbnail: '' },
    [B]: { id: B, name: 'Artist B', category: 'podcasts', removed: false, thumbnail: '' },
    [P]: { id: P, name: '', category: 'shiurim', removed: false, thumbnail: '' },
    [N]: { id: N, name: 'New one', category: 'music', removed: false, thumbnail: 'https://x/n.jpg' },
  };
  const out = applyOverrides(list, channels, entries);
  assert.deepStrictEqual(out.list.artists.map((a) => a.id), [N]);
  assert.strictEqual(out.list.version, 4);
  assert.deepStrictEqual(out.channels.podcasts.map((c) => c.id), [B]);
  assert.deepStrictEqual(out.channels.shiurim.map((c) => [c.id, c.name, c.thumbnailUrl]), [[P, 'Pod', 'https://x/p.jpg']]);
  assert.deepStrictEqual(out.channels.videos, []);
  const cat = new Catalog(out.list, { channels: out.channels });
  assert.ok(!cat.isApprovedArtist(A));
  assert.ok(cat.isApprovedArtist(N));
  assert.ok(cat.isApprovedChannel(B));
  assert.deepStrictEqual(applyOverrides(list, channels, {}), { list, channels });
});

test('the admin list: built in plus changes, removed last', () => {
  const rows = catalogRows(list, channels, { [A]: { id: A, name: 'Artist A', category: 'videos', removed: true, thumbnail: '' } });
  assert.deepStrictEqual(rows.map((r) => [r.id, r.category, r.removed]), [[B, 'music', false], [P, 'podcasts', false], [A, 'videos', true]]);
  assert.strictEqual(rows[2].thumbnail, 'https://x/a.jpg');
});

test('server list is checked', () => {
  const c = cleanCatalog({ version: 3, entries: [{ id: N, name: 'x', category: 'music' }, { id: 'bad', category: 'music' }, { id: P, category: 'other' }, { id: B, category: 'videos', thumbnail: 'javascript:1' }] });
  assert.strictEqual(c.version, 3);
  assert.deepStrictEqual(Object.keys(c.entries), [N, B]);
  assert.strictEqual(c.entries[B].thumbnail, '');
});

test('account: key kept, sign up, approval, offline keeps the last answer, catalog saved', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stalow-acc-'));
  const file = path.join(dir, 'account.json');
  const catalogFile = path.join(dir, 'catalog.json');
  const calls = [];
  let answer = { id: 'u1', name: 'Moshe', status: 'pending', role: 'user' };
  let offline = false;
  const fetchImpl = async (_url, init) => {
    if (offline) throw new Error('net::ERR_INTERNET_DISCONNECTED');
    const body = JSON.parse(init.body);
    calls.push(body);
    const json = body.action === 'catalog.get' ? { version: 2, entries: [{ id: N, name: 'New', category: 'podcasts', removed: false }] } : answer;
    return { ok: true, status: 200, json: async () => json };
  };
  const acc = new Accounts({ file, catalogFile, fetchImpl, deviceName: 'Windows: test' });
  assert.match(acc.key, /^[A-Za-z0-9_-]{43}$/);
  assert.strictEqual(acc.state.status, 'none');
  await acc.register('Moshe');
  assert.strictEqual(acc.state.status, 'pending');
  assert.deepStrictEqual([calls[0].action, calls[0].name, calls[0].device, calls[0].key], ['register', 'Moshe', 'Windows: test', acc.key]);
  assert.strictEqual(await acc.refreshCatalog(), false); // not approved yet
  answer = { ...answer, status: 'approved', role: 'admin' };
  await acc.refresh();
  assert.ok(acc.isAdmin);
  assert.strictEqual(await acc.refreshCatalog(), true);
  assert.strictEqual(await acc.refreshCatalog(), false); // unchanged
  offline = true;
  assert.strictEqual(await acc.refresh(), false);
  const again = new Accounts({ file, catalogFile, fetchImpl });
  assert.strictEqual(again.key, acc.key);
  assert.strictEqual(again.state.status, 'approved');
  assert.strictEqual(again.catalog.entries[N].category, 'podcasts');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a refused call reports the server reason', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stalow-acc-'));
  const acc = new Accounts({ file: path.join(dir, 'a.json'), catalogFile: path.join(dir, 'c.json'), fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ error: 'admins only' }) }) });
  await assert.rejects(acc.accounts(), /admins only/);
  fs.rmSync(dir, { recursive: true, force: true });
});
