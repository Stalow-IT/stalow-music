'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { isNewer, parseFeed, checkAndDownload } = require('../src/updater');

test('version comparison', () => {
  assert.ok(isNewer('1.0.5', '1.0.4'));
  assert.ok(isNewer('1.0.10', '1.0.9'));
  assert.ok(!isNewer('1.0.4', '1.0.4'));
  assert.ok(!isNewer('1.0.3', '1.0.4'));
});

test('an incomplete or unsafe update file is refused', () => {
  const sha = 'a'.repeat(64);
  assert.ok(parseFeed(JSON.stringify({ version: '1.0.5', parts: ['a.part1'], sha256: sha, size: 1 })));
  assert.strictEqual(parseFeed('nope'), null);
  assert.strictEqual(parseFeed(JSON.stringify({ version: '1.0.5', parts: [], sha256: sha, size: 1 })), null);
  assert.strictEqual(parseFeed(JSON.stringify({ version: '1.0.5', parts: ['../evil'], sha256: sha, size: 1 })), null);
  assert.strictEqual(parseFeed(JSON.stringify({ version: '1.0.5', parts: ['a'], sha256: 'short', size: 1 })), null);
});

function serve(files) {
  return new Promise((r) => {
    const srv = http.createServer((req, res) => {
      const body = files[req.url.slice(1)];
      if (body === undefined) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(body);
    }).listen(0, '127.0.0.1', () => r(srv));
  });
}

test('downloads the parts, joins and verifies them; a damaged part is refused', async () => {
  const installer = crypto.randomBytes(300000);
  const sha = crypto.createHash('sha256').update(installer).digest('hex');
  const parts = { 'S-1.0.5.part1': installer.subarray(0, 120000), 'S-1.0.5.part2': installer.subarray(120000, 240000), 'S-1.0.5.part3': installer.subarray(240000) };
  const feed = { version: '1.0.5', parts: Object.keys(parts), sha256: sha, size: installer.length, notes: 'x' };
  const srv = await serve({ ...parts, 'feed.json': JSON.stringify(feed) });
  const url = `http://127.0.0.1:${srv.address().port}/feed.json`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stalow-upd-'));
  try {
    assert.deepStrictEqual(await checkAndDownload('1.0.5', tmp, () => {}, url), { state: 'none' });
    const r = await checkAndDownload('1.0.4', tmp, () => {}, url);
    assert.strictEqual(r.state, 'ready');
    assert.ok(fs.readFileSync(r.installer).equals(installer));

    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'stalow-upd-'));
    const bad = { ...parts, 'S-1.0.5.part2': Buffer.alloc(120000) };
    const srv2 = await serve({ ...bad, 'feed.json': JSON.stringify(feed) });
    await assert.rejects(checkAndDownload('1.0.4', tmp2, () => {}, `http://127.0.0.1:${srv2.address().port}/feed.json`), /damaged/);
    srv2.close();
  } finally { srv.close(); }
});
