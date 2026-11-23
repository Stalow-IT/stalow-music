'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createDriveHandler, driveIdOf, driveErrorText } = require('../src/drive-stream');

const ID = '16utrQ93IPfPJeUyw6lYntT6BDQgA91Ez';
const req = (url, range) => ({ url, headers: new Headers(range ? { Range: range } : {}) });
const reply = (status, type, body = 'x', extra = {}) => new Response(body, { status, headers: { 'content-type': type, ...extra } });

test('the song is fetched from Drive with the player\'s range, and served as audio', async () => {
  const seen = [];
  const handler = createDriveHandler({
    fetchImpl: async (url, init) => { seen.push({ url, init }); return reply(206, 'application/octet-stream', 'ID3', { 'content-range': 'bytes 0-2/100', 'content-length': '3' }); },
    sleep: async () => {},
  });
  const res = await handler(req(`stalow-drive://file/${ID}`, 'bytes=0-'));
  assert.strictEqual(res.status, 206);
  assert.strictEqual(res.headers.get('content-type'), 'audio/mpeg');
  assert.strictEqual(res.headers.get('content-range'), 'bytes 0-2/100');
  assert.strictEqual(await res.text(), 'ID3');
  assert.strictEqual(seen.length, 1);
  assert.match(seen[0].url, new RegExp(`id=${ID}&export=download&confirm=t$`));
  assert.strictEqual(seen[0].init.headers.Range, 'bytes=0-');
  assert.ok(!('Cookie' in seen[0].init.headers));
});

test('a refusal or a web page is tried again, then the song plays', async () => {
  const answers = [reply(429, 'text/html'), reply(200, 'text/html; charset=utf-8', '<html>'), reply(200, 'audio/mpeg', 'ID3')];
  const waits = [];
  const handler = createDriveHandler({ fetchImpl: async () => answers.shift(), sleep: async (ms) => { waits.push(ms); } });
  const res = await handler(req(`stalow-drive://file/${ID}`));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(await res.text(), 'ID3');
  assert.deepStrictEqual(waits, [700, 1400]);
});

test('after the last try it gives up and says why; a missing file is not tried again', async () => {
  const errors = [];
  let calls = 0;
  const handler = createDriveHandler({ fetchImpl: async () => { calls++; return reply(429, 'text/html'); }, sleep: async () => {}, onError: (e) => errors.push(e) });
  const res = await handler(req(`stalow-drive://file/${ID}`));
  assert.strictEqual(res.status, 502);
  assert.strictEqual(calls, 4);
  assert.match(driveErrorText(errors[0]), /too many plays/);

  calls = 0;
  const gone = createDriveHandler({ fetchImpl: async () => { calls++; return reply(404, 'text/html'); }, sleep: async () => {}, onError: (e) => errors.push(e) });
  assert.strictEqual((await gone(req(`stalow-drive://file/${ID}`))).status, 502);
  assert.strictEqual(calls, 1);
  assert.match(driveErrorText(errors[1]), /gone or no longer shared/);
});

test('only stalow-drive://file/<id> addresses', async () => {
  assert.strictEqual(driveIdOf(`stalow-drive://file/${ID}`), ID);
  assert.strictEqual(driveIdOf('stalow-drive://file/../x'), null);
  assert.strictEqual(driveIdOf('https://example.com'), null);
  const handler = createDriveHandler({ fetchImpl: async () => { throw new Error('should not fetch'); } });
  assert.strictEqual((await handler(req('stalow-drive://file/bad'))).status, 400);
});
