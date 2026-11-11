'use strict';
// Downloaded songs (Download on the Now playing page): saved as audio files in Music\Stalow Music, listed in
// downloads.json in the app's data folder, and played from the file - also without internet.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const MAX_BYTES = 80 * 1024 * 1024; // a song recording is a few MB; anything this large is not a song
const safe = (s) => String(s || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Unknown';

class Downloads {
  constructor(indexFile, folder) {
    this.indexFile = indexFile;
    this.folder = folder;
  }

  read() {
    let list = [];
    try { list = JSON.parse(fs.readFileSync(this.indexFile, 'utf8')); } catch { list = []; }
    return Array.isArray(list) ? list.filter((d) => d && typeof d.id === 'string' && typeof d.file === 'string') : [];
  }

  write(list) { fs.writeFileSync(this.indexFile, JSON.stringify(list)); }

  /** The downloads whose files still exist (a file deleted in Explorer drops out), newest first. */
  list() {
    const all = this.read();
    const present = all.filter((d) => fs.existsSync(d.file));
    if (present.length !== all.length) this.write(present);
    return present.map((d) => ({ ...d, url: pathToFileURL(d.file).href }));
  }

  get(id) { return this.list().find((d) => d.id === id) || null; }

  /** Saves one recorded song. [song] is the queue item (id, title, artists, album, thumbnail, duration). */
  save(song, data) {
    if (!song || typeof song.id !== 'string' || !/^[\w-]{6,20}$/.test(song.id)) throw new Error('Not a song');
    if (!Buffer.isBuffer(data) || data.length < 10 * 1024 || data.length > MAX_BYTES) throw new Error('The recording is not a song');
    fs.mkdirSync(this.folder, { recursive: true });
    const artist = (song.artists || []).map((a) => a && a.name).filter(Boolean).join(', ');
    const file = path.join(this.folder, `${safe(artist)} - ${safe(song.title)} [${song.id}].webm`);
    fs.writeFileSync(file, data);
    const entry = {
      id: song.id, title: String(song.title || '').slice(0, 300),
      artists: (song.artists || []).filter((a) => a && typeof a.name === 'string').map((a) => ({ id: typeof a.id === 'string' ? a.id : null, name: a.name })),
      album: song.album && typeof song.album.title === 'string' ? { id: '', title: song.album.title } : null,
      thumbnail: typeof song.thumbnail === 'string' && /^https:\/\//.test(song.thumbnail) ? song.thumbnail : '',
      duration: typeof song.duration === 'number' ? song.duration : null,
      file, size: data.length, savedAt: Date.now(),
    };
    this.write([entry, ...this.read().filter((d) => d.id !== song.id)]);
    return entry;
  }

  /** Deletes the file and the entry. */
  remove(id) {
    const all = this.read();
    const d = all.find((x) => x.id === id);
    if (d) { try { fs.rmSync(d.file, { force: true }); } catch { /* already gone */ } }
    this.write(all.filter((x) => x.id !== id));
  }
}

module.exports = { Downloads, MAX_BYTES, safe };
