'use strict';
// Google Drive songs play through the app's own address, stalow-drive://file/<id>: the main process fetches the
// file from Drive with a clean connection (no Google sign-in from this PC is sent along), passes the player's
// range requests on (so seeking works), and when Drive refuses or sends a web page instead of the song (it does
// that now and then, e.g. "too many requests"), it waits a moment and asks again before giving up.

// (STALOW_DRIVE_BASE lets the app's own tests use a stand-in for Drive)
const DRIVE_URL = (id) => `${process.env.STALOW_DRIVE_BASE || 'https://drive.usercontent.google.com'}/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
const ID = /^[A-Za-z0-9_-]{10,100}$/;
const RETRY_STATUS = new Set([403, 408, 429, 500, 502, 503, 504]);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

/** The id in stalow-drive://file/<id>, or null. */
function driveIdOf(url) {
  const m = String(url).match(/^stalow-drive:\/\/file\/([^/?#]+)/);
  return m && ID.test(m[1]) ? m[1] : null;
}

/**
 * The protocol handler. [fetchImpl] fetches from Drive (a session without Google cookies); [sleep] waits between
 * tries; [onError] hears about a song Drive would not send ({id, status, type}).
 */
function createDriveHandler({ fetchImpl, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), tries = 4, onError = () => {} }) {
  return async (request) => {
    const id = driveIdOf(request.url);
    if (!id) return new Response('not a Google Drive song', { status: 400 });
    const headers = { 'User-Agent': UA };
    const range = request.headers && request.headers.get && request.headers.get('Range');
    if (range) headers.Range = range;
    let last = { id, status: 0, type: '' };
    for (let attempt = 1; attempt <= tries; attempt++) {
      let res;
      try {
        res = await fetchImpl(DRIVE_URL(id), { headers, redirect: 'follow' });
      } catch (e) {
        last = { id, status: 0, type: '', message: String(e && e.message || e) };
        if (attempt < tries) { await sleep(700 * attempt); continue; }
        break;
      }
      const type = (res.headers.get('content-type') || '').toLowerCase();
      if ((res.status === 200 || res.status === 206) && !type.includes('text/html')) {
        const out = new Headers({ 'Accept-Ranges': 'bytes', 'Content-Type': type && type !== 'application/octet-stream' ? type : 'audio/mpeg' });
        for (const h of ['content-length', 'content-range']) { const v = res.headers.get(h); if (v) out.set(h, v); }
        return new Response(res.body, { status: res.status, headers: out });
      }
      last = { id, status: res.status, type };
      try { await res.arrayBuffer(); } catch { /* drop the page */ }
      // a refusal, or a page instead of the song (an answer of 200), is worth another try; a missing file is not
      const again = RETRY_STATUS.has(res.status) || ((res.status === 200 || res.status === 206) && type.includes('text/html'));
      if (!again || attempt === tries) break;
      await sleep(700 * attempt);
    }
    onError(last);
    return new Response('Google Drive did not send this song', { status: 502 });
  };
}

/** What to tell the listener when Drive would not send a song. */
function driveErrorText(e) {
  if (!e) return '';
  if (e.status === 404) return 'Google Drive: the file is gone or no longer shared';
  if (e.status === 401 || e.status === 403) return 'Google Drive refused the file (is it shared as "Anyone with the link"?)';
  if (e.status === 429) return 'Google Drive: too many plays of this file right now, try again later';
  if (String(e.type).includes('text/html')) return 'Google Drive sent a page instead of the song';
  if (!e.status) return 'Google Drive could not be reached' + (e.message ? ` (${e.message})` : '');
  return `Google Drive answered ${e.status}`;
}

module.exports = { createDriveHandler, driveIdOf, driveErrorText, DRIVE_URL };
