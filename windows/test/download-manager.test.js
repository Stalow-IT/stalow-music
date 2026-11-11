'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DownloadManager, MAX_PARALLEL } = require('../src/download-manager');

/** A stand-in for a hidden BrowserWindow: records what the manager does with it. */
function fakeWindow() {
  const handlers = {};
  const wc = {
    muted: false, url: null,
    on: (ev, fn) => { handlers[ev] = fn; },
    setAudioMuted: (m) => { wc.muted = m; },
    setWindowOpenHandler: () => {},
    executeJavaScript: async () => true,
  };
  const win = { webContents: wc, destroyed: false, isDestroyed: () => win.destroyed, destroy: () => { win.destroyed = true; }, loadURL: async (u) => { wc.url = u; }, handlers };
  return win;
}

const song = (n) => ({ type: 'song', id: `song${String(n).padStart(6, '0')}`, title: `Song ${n}`, artists: [{ id: null, name: 'A' }], duration: 100 });

test('background downloads: three at a time, silent, saved, the next one starts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stalow-dm-'));
  const saved = [];
  const wins = [];
  const downloads = { get: (id) => saved.find((s) => s.id === id) || null, save: (s, data) => { saved.push({ id: s.id, size: data.length }); } };
  const m = new DownloadManager({ downloads, pageScript: '', statusPrefix: '__STALOW__', maxBytes: 1e8, queueFile: path.join(dir, 'q.json'), createWindow: () => { const w = fakeWindow(); wins.push(w); return w; } });
  assert.strictEqual(m.add([song(1), song(2), song(3), song(4), song(1)]), 4); // the repeated song is listed once
  assert.strictEqual(MAX_PARALLEL, 3);
  assert.strictEqual(wins.length, 3);
  assert.ok(wins.every((w) => w.webContents.muted), 'download players are silent');
  assert.ok(wins[0].webContents.url.includes('watch?v=song000001'));
  assert.strictEqual(m.list().filter((j) => j.state === 'saving').length, 3);
  // the first song's audio arrives and it finishes
  m.onChunk(wins[0].webContents, 'song000001', new ArrayBuffer(4000));
  m.onChunk(wins[1].webContents, 'song000001', new ArrayBuffer(4000)); // from another song's window: ignored
  m.onDone(wins[0].webContents, 'song000001', true);
  assert.deepStrictEqual(saved, [{ id: 'song000001', size: 4000 }]);
  assert.ok(wins[0].destroyed);
  assert.strictEqual(wins.length, 4, 'the fourth song starts when one finishes');
  // a song stopped early is tried again, then marked failed
  m.onDone(wins[1].webContents, 'song000002', false);
  assert.strictEqual(m.list().find((j) => j.id === 'song000002').state, 'saving'); // second try started
  m.onDone(wins[4].webContents, 'song000002', false);
  assert.strictEqual(m.list().find((j) => j.id === 'song000002').state, 'failed');
  // the waiting list survives a restart (failed songs are not kept)
  const m2 = new DownloadManager({ downloads, pageScript: '', statusPrefix: '__STALOW__', maxBytes: 1e8, queueFile: path.join(dir, 'q.json'), createWindow: fakeWindow });
  assert.deepStrictEqual(m2.list().map((j) => j.id).sort(), ['song000003', 'song000004']);
  // cancel
  m.cancel('song000003');
  assert.ok(!m.list().some((j) => j.id === 'song000003'));
  m.cancel(null);
  assert.strictEqual(m.list().length, 0);
  assert.ok(wins.every((w) => w.destroyed));
});
