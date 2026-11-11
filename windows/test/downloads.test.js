'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Downloads, safe } = require('../src/downloads');

test('downloads: saved, listed, removed; a deleted file drops out; junk is refused', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stalow-dl-'));
  const d = new Downloads(path.join(dir, 'downloads.json'), path.join(dir, 'Music', 'Stalow Music'));
  const song = { id: 'abcdefghijk', title: 'Yidden / Live: "2020"', artists: [{ id: 'UCx', name: 'MBD' }], album: { title: 'Live' }, thumbnail: 'https://lh3/x', duration: 250 };
  const e = d.save(song, Buffer.alloc(50 * 1024, 1));
  assert.ok(fs.existsSync(e.file));
  assert.ok(path.basename(e.file).startsWith('MBD - Yidden'));
  assert.ok(!/[<>:"/\\|?*]/.test(path.basename(e.file)));
  assert.strictEqual(d.list().length, 1);
  assert.ok(d.get('abcdefghijk').url.startsWith('file:'));
  assert.throws(() => d.save(song, Buffer.alloc(10)), /not a song/);
  assert.throws(() => d.save({ ...song, id: '../../evil' }, Buffer.alloc(50 * 1024)), /Not a song/);
  fs.rmSync(e.file);
  assert.strictEqual(d.list().length, 0); // deleted in Explorer: gone from the list
  d.save(song, Buffer.alloc(50 * 1024, 1));
  d.remove('abcdefghijk');
  assert.strictEqual(d.list().length, 0);
  assert.strictEqual(safe('a/b\\c:d'), 'a b c d');
});
