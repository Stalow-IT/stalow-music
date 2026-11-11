'use strict';
// Stalow Music for Windows updates itself from the Stalow website. The installer is larger than the website can
// hold as one file, so it is published in parts next to an update file:
//
//   https://stalow.netlify.app/downloads/desktop/stalow-music-desktop.json
//   {"version":"1.0.5","parts":["StalowMusic-1.0.5.part1", ...],"sha256":"<installer sha-256>","size":123,"notes":"..."}
//
// The app downloads the parts, joins them, checks the size and SHA-256, and only then runs the installer silently.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FEED_URL = 'https://stalow.netlify.app/downloads/desktop/stalow-music-desktop.json';

/** 1.0.10 > 1.0.9; non-numbers count as 0. */
function isNewer(latest, current) {
  const a = String(latest).split('.').map((x) => parseInt(x, 10) || 0);
  const b = String(current).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

/** The release in an update file, or null when it is incomplete. */
function parseFeed(text) {
  let f;
  try { f = JSON.parse(text); } catch { return null; }
  if (!f || typeof f.version !== 'string' || !Array.isArray(f.parts) || !f.parts.length) return null;
  if (!/^[0-9a-f]{64}$/i.test(f.sha256 || '') || !Number.isFinite(f.size)) return null;
  if (!f.parts.every((p) => typeof p === 'string' && /^[\w.-]+$/.test(p))) return null; // plain file names only
  return f;
}

const partUrl = (feedUrl, part) => new URL(part, feedUrl).toString();

async function download(url, file, onBytes) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const out = fs.createWriteStream(file);
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
    onBytes(value.length);
  }
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
}

/**
 * Checks for an update; when there is one, downloads and verifies it. Returns
 * { state: 'none' } | { state: 'ready', version, notes, installer } and reports progress through onProgress(0..100).
 */
async function checkAndDownload(currentVersion, tempDir, onProgress, feedUrl = FEED_URL) {
  const res = await fetch(feedUrl, { cache: 'no-store' });
  if (res.status === 404) return { state: 'none' };
  if (!res.ok) throw new Error(`Update check failed: HTTP ${res.status}`);
  const feed = parseFeed(await res.text());
  if (!feed) throw new Error('The update file could not be read');
  if (!isNewer(feed.version, currentVersion)) return { state: 'none' };

  const dir = path.join(tempDir, 'stalow-music-update');
  fs.mkdirSync(dir, { recursive: true });
  const installer = path.join(dir, `Stalow-Music-Setup-${feed.version}.exe`);
  if (fs.existsSync(installer) && await sha256(installer) === feed.sha256.toLowerCase()) {
    return { state: 'ready', version: feed.version, notes: feed.notes || '', installer };
  }
  let got = 0;
  const partFiles = [];
  for (const p of feed.parts) {
    const f = path.join(dir, p);
    await download(partUrl(feedUrl, p), f, (n) => { got += n; onProgress(Math.min(99, Math.round((got / feed.size) * 100))); });
    partFiles.push(f);
  }
  const tmp = installer + '.part';
  const out = fs.createWriteStream(tmp);
  for (const f of partFiles) {
    await new Promise((r, j) => fs.createReadStream(f).on('error', j).on('end', r).pipe(out, { end: false }));
  }
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
  partFiles.forEach((f) => fs.rmSync(f, { force: true }));
  if (fs.statSync(tmp).size !== feed.size || await sha256(tmp) !== feed.sha256.toLowerCase()) {
    fs.rmSync(tmp, { force: true });
    throw new Error('The downloaded update was damaged; it will be downloaded again next time');
  }
  fs.renameSync(tmp, installer);
  onProgress(100);
  return { state: 'ready', version: feed.version, notes: feed.notes || '', installer };
}

function sha256(file) {
  return new Promise((r, j) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('error', j).on('data', (d) => h.update(d)).on('end', () => r(h.digest('hex')));
  });
}

module.exports = { FEED_URL, isNewer, parseFeed, partUrl, checkAndDownload, sha256 };
