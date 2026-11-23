'use strict';
const { app, BrowserWindow, ipcMain, shell, Menu, nativeImage, dialog, session, net, protocol } = require('electron');
const { createDriveHandler, driveErrorText } = require('./drive-stream');
// Google Drive songs play through stalow-drive://file/<id> (see drive-stream.js); streamed, with seeking
protocol.registerSchemesAsPrivileged([{ scheme: 'stalow-drive', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);
let lastDriveError = null;
const path = require('path');
const fs = require('fs');
const { api } = require('./ytm');
const { loadArtists, loadChannels, applyOverrides, catalogRows, Catalog } = require('./catalog');
const { Accounts } = require('./accounts');
const { Player, PAGE_SCRIPT, STATUS_PREFIX } = require('./player');
const { DownloadManager } = require('./download-manager');
const { Sync, SHARED_SETTINGS } = require('./sync');
const os = require('os');
const { searchAll, keepFullPlaylists } = require('./search');
const updater = require('./updater');
const settingsSchema = require('./settings');
const { getLyrics } = require('./lyrics');
const { Downloads, MAX_BYTES } = require('./downloads');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let player = null;
let catalog = null;
let accounts = null;
let baseList = null;
let baseChannels = null;
/** The approved lists: built in, with the admins' changes on top (Settings > Channels & artists). */
function buildCatalog() {
  const s = readSettings();
  const { list, channels } = applyOverrides(baseList, baseChannels, accounts.catalog.entries);
  catalog = new Catalog(list, { allowFemale: s.allowFemale, blockPodcasts: s.blockPodcasts, channels });
}
const accountState = () => ({ ...accounts.state, isAdmin: accounts.isAdmin });
/** The Google Drive folders and files the admins added, kept on the PC so they show offline too. */
let driveCache = [];
async function refreshDrive() {
  if (accounts.state.status !== 'approved') return;
  const items = (await accounts.call('drive.list')).items || [];
  if (JSON.stringify(items) !== JSON.stringify(driveCache)) { driveCache = items; writeRaw(dataFile('stalow-drive'), items); send('drive-changed', true); }
}
/** Looks again at this PC's approval and the admins' changes; tells the window when either changed. */
async function checkAccount() {
  const before = JSON.stringify(accounts.state);
  await accounts.refresh();
  if (JSON.stringify(accounts.state) !== before) send('account', accountState());
  if (await accounts.refreshCatalog()) { buildCatalog(); send('catalog-changed', true); }
}
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const readRaw = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeRaw = (file, data) => { try { fs.writeFileSync(file, JSON.stringify(data)); return true; } catch { return false; } };
/** All settings, checked and completed with the defaults (see settings.js). */
const readSettings = () => settingsSchema.normalize(readRaw(settingsFile(), {}));
const writeSettings = (s) => writeRaw(settingsFile(), settingsSchema.normalize(s));

// Listen history and search history, each in its own file (Settings > Privacy, and backups).
const dataFile = (name) => path.join(app.getPath('userData'), `${name}.json`);
const RELEASES_URL = 'https://dzrnortzhpnoussbeedv.supabase.co/functions/v1/stalow-releases';
let releasesCache = null;
const DATA = { history: 'history', searchHistory: 'search-history', likes: 'likes', plays: 'plays' };
const cleanSong = (x) => (x && typeof x.id === 'string' && /^(?:[\w-]{6,20}|drive:[\w-]{10,100})$/.test(x.id) ? {
  type: 'song', id: x.id, title: String(x.title || '').slice(0, 300),
  artists: (Array.isArray(x.artists) ? x.artists : []).filter((a) => a && typeof a.name === 'string').slice(0, 10).map((a) => ({ id: typeof a.id === 'string' ? a.id : null, name: a.name.slice(0, 200) })),
  album: x.album && typeof x.album.title === 'string' ? { id: typeof x.album.id === 'string' ? x.album.id : '', title: x.album.title.slice(0, 300) } : null,
  thumbnail: typeof x.thumbnail === 'string' && /^https:\/\//.test(x.thumbnail) ? x.thumbnail : '',
  duration: typeof x.duration === 'number' ? x.duration : null,
  ...(typeof x.playedAt === 'number' ? { playedAt: x.playedAt } : {}),
  ...(typeof x.likedAt === 'number' ? { likedAt: x.likedAt } : {}),
  ...(x.unliked === true ? { unliked: true } : {}),
  // Home > Most played: when the song was played (the last 50 times)
  ...(Array.isArray(x.playTimes) ? { playTimes: x.playTimes.filter((n) => typeof n === 'number').slice(-50) } : {}),
} : null);
const cleanHistory = (list, max = 500) => (Array.isArray(list) ? list.map(cleanSong).filter(Boolean).slice(0, max) : []);
const cleanSearches = (list) => (Array.isArray(list) ? list.filter((q) => q && typeof q.q === 'string' && q.q.trim()).map((q) => ({ q: q.q.trim().slice(0, 200), at: typeof q.at === 'number' ? q.at : Date.now() })).slice(0, 200) : []);
const cleanSession = (s) => {
  if (!s || !Array.isArray(s.queue)) return null;
  const queue = s.queue.map(cleanSong).filter(Boolean).slice(0, 300);
  if (!queue.length) return null;
  const r = s.radio && typeof s.radio.videoId === 'string' ? { videoId: s.radio.videoId, continuation: typeof s.radio.continuation === 'string' ? s.radio.continuation : null, started: !!s.radio.started } : null;
  return { queue, index: Math.min(Math.max(0, s.index | 0), queue.length - 1), time: Math.max(0, Number(s.time) || 0), radio: r };
};

// Downloads: each song is saved in the background by its own silent player (see download-manager.js) to
// Music\Stalow Music; up to three at once, whatever is playing in the app.
let downloads = null;
let manager = null;
let sync = null;
ipcMain.on('rec:chunk', (e, id, data) => { if (manager && manager.owns(e.sender)) manager.onChunk(e.sender, id, data); });
ipcMain.on('rec:done', (e, id, ok) => { if (manager && manager.owns(e.sender)) manager.onDone(e.sender, id, ok); });

// Settings > Storage: the cache limit is set when the app starts.
try { app.commandLine.appendSwitch('disk-cache-size', String(readSettings().maxCacheMB * 1024 * 1024)); } catch { /* defaults */ }

// The queue and song are kept in a file (not browser storage), written at once, so a restart or an
// update that closes the app straight away cannot lose them.
const sessionFile = () => path.join(app.getPath('userData'), 'session.json');
const readSession = () => { try { return JSON.parse(fs.readFileSync(sessionFile(), 'utf8')); } catch { return null; } };
const writeSession = (s) => { try { fs.writeFileSync(sessionFile(), JSON.stringify(s)); } catch { /* ignore */ } };

const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };

function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 820, minHeight: 560,
    backgroundColor: readSettings().theme === 'light' ? '#f4f5f7' : '#0f1117', title: 'Stalow Music',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('closed', () => { win = null; app.quit(); });
}

// ---------- taskbar buttons (Windows): Previous, Play/Pause, Next under the hover preview ----------
let thumbarPlaying = null;
const thumbIcon = (name) => nativeImage.createFromPath(path.join(__dirname, '..', 'assets', `${name}.png`));
function updateThumbar(playing) {
  if (process.platform !== 'win32' || !win || win.isDestroyed() || thumbarPlaying === playing) return;
  thumbarPlaying = playing;
  win.setThumbarButtons([
    { tooltip: 'Previous', icon: thumbIcon('previous'), click: () => send('player', { action: 'previous' }) },
    playing
      ? { tooltip: 'Pause', icon: thumbIcon('pause'), click: () => send('player', { action: 'pause' }) }
      : { tooltip: 'Play', icon: thumbIcon('play'), click: () => send('player', { action: 'play' }) },
    { tooltip: 'Next', icon: thumbIcon('next'), click: () => send('player', { action: 'next' }) },
  ]);
}

// ---------- catalog calls (all results filtered by the approved list) ----------
const handlers = {
  // ---- accounts (approval) and, for admins, users and the channel / artist list ----
  'account:state': async () => accountState(),
  'account:register': async (name) => { await accounts.register(String(name || '').slice(0, 60)); checkAccount().catch(() => {}); return accountState(); },
  'account:claim': async ({ name, code } = {}) => { await accounts.claimOwner(String(name || '').slice(0, 60), String(code || '').slice(0, 40)); checkAccount().catch(() => {}); return accountState(); },
  'account:refresh': async () => { await checkAccount(); return accountState(); },
  'admin:accounts': async () => accounts.accounts(),
  'admin:decide': async ({ id, status, role } = {}) => accounts.decide(String(id || ''), { status, role }),
  'admin:search': async (q) => accounts.search(String(q || '').slice(0, 100)),
  'admin:pictures': async ({ id, q } = {}) => accounts.pictures(String(id || ''), String(q || '').slice(0, 100)),
  'admin:rows': async () => catalogRows(baseList, baseChannels, accounts.catalog.entries),
  // Google Drive (Settings > Google Drive): the shared list for everyone; admins add and change it
  'drive:list': async () => { refreshDrive().catch(() => {}); return driveCache; },
  'drive:lastError': async () => (lastDriveError ? driveErrorText(lastDriveError) : ''),
  'admin:driveAll': async () => (await accounts.call('drive.all')).items || [],
  'admin:driveAdd': async (a = {}) => {
    const r = await accounts.call('drive.add', { link: String(a.link || '').slice(0, 500), category: String(a.category || ''), title: String(a.title || '').slice(0, 200), artistId: a.artistId || undefined, year: a.year || undefined });
    await refreshDrive(); return r.item;
  },
  'admin:driveSet': async (a = {}) => {
    const r = await accounts.call('drive.set', { id: String(a.id || ''), title: a.title, category: a.category, removed: a.removed, refresh: a.refresh === true || undefined, deleteCopy: a.deleteCopy === true || undefined });
    await refreshDrive(); return r.item;
  },
  'admin:albums': async (id) => accounts.call('catalog.albums', { id: String(id || '') }),
  'admin:compare': async (id) => accounts.call('catalog.compare', { id: String(id || '') }),
  // Copy to my Google Drive (the owner's own script copies everything added into their Drive)
  'admin:copierGet': async () => accounts.call('drive.copier.get'),
  'admin:copierSet': async (url) => accounts.call('drive.copier.set', { url: String(url || '').slice(0, 300) }),
  'admin:copierClear': async () => accounts.call('drive.copier.clear'),
  'app:copyText': async (text) => { require('electron').clipboard.writeText(String(text || '').slice(0, 100000)); return true; },
  'admin:set': async (entry) => {
    const e = entry || {};
    await accounts.setEntry({ id: String(e.id || ''), name: String(e.name || '').slice(0, 200), thumbnail: String(e.thumbnail || ''), category: String(e.category || ''), removed: e.removed === true });
    buildCatalog();
    send('catalog-changed', true);
    return true;
  },
  'catalog:search': async (q) => searchAll(api, catalog, q),
  'catalog:artists': async (text) => catalog.findArtists(text),
  // the approved Podcasts, Shiurim and Videos channels: their uploads start as video (music stays audio)
  'catalog:channelIds': async () => [...catalog.channels.keys()],
  'catalog:channels': async ({ category, text } = {}) => catalog.channelList(category, text),
  'catalog:home': async (recentArtistIds) => ({ artists: catalog.homeArtists(recentArtistIds, 18) }),
  // Home > New releases: the approved artists' new albums and singles (the same list as the phone app)
  'catalog:releases': async () => {
    if (!releasesCache || Date.now() - releasesCache.at > 15 * 60000) {
      try {
        const res = await net.fetch(RELEASES_URL);
        if (res.ok) {
          const feed = await res.json();
          const items = (Array.isArray(feed.releases) ? feed.releases : []).filter((r) => r && /^MPRE[\w-]+$/.test(r.browseId) && /^UC[\w-]+$/.test(r.artistId)).map((r) => ({
            type: 'album', id: r.browseId, title: String(r.title || '').slice(0, 300), artists: [{ id: r.artistId, name: String(r.artistName || '') }],
            thumbnail: /^https:\/\//.test(r.thumbnail || '') ? r.thumbnail : '', year: r.year || null,
          }));
          releasesCache = { at: Date.now(), items };
        }
      } catch (e) { /* keep the last list */ }
    }
    return releasesCache ? catalog.filterItems(releasesCache.items) : [];
  },
  // the full list behind a shelf's "See all" on an artist or channel page
  'catalog:shelf': async ({ id, name, more } = {}) => {
    if (typeof id !== 'string' || !catalog.canOpen(id)) return { notApproved: true };
    if (!more || typeof more.browseId !== 'string' || !/^[\w-]{2,80}$/.test(more.browseId) || (more.params !== undefined && (typeof more.params !== 'string' || more.params.length > 2000))) throw new Error('Bad link');
    const items = catalog.filterItems(await api.shelf({ browseId: more.browseId, params: more.params }, { artists: [{ id, name: String(name || '') }] }), id);
    const full = new Set((await keepFullPlaylists(api, catalog, items.filter((x) => x.type === 'playlist'), true)).map((p) => p.id));
    return { items: items.filter((x) => x.type !== 'playlist' || full.has(x.id)) };
  },
  'catalog:artist': async (id) => {
    if (!catalog.canOpen(id)) return { notApproved: true };
    const page = await api.artist(id);
    const known = catalog.artists.find((a) => a.id === id) || catalog.channels.get(id);
    page.isChannel = !catalog.isApprovedArtist(id);
    page.artist.title = page.artist.title || (known && known.name) || '';
    page.artist.thumbnail = page.artist.thumbnail || (known && (known.thumbnail || known.thumbnailUrl)) || '';
    page.sections = await Promise.all(page.sections.map(async (s) => {
      const items = catalog.filterItems(s.items, id);
      const full = new Set((await keepFullPlaylists(api, catalog, items.filter((x) => x.type === 'playlist'), true)).map((p) => p.id));
      return { ...s, items: items.filter((x) => x.type !== 'playlist' || full.has(x.id)) };
    }));
    page.sections = page.sections.filter((s) => s.items.length);
    return page;
  },
  'catalog:album': async (id) => {
    const page = await api.album(id);
    const fallback = page.album.artists[0] && page.album.artists[0].id;
    page.songs = page.songs.filter((s) => catalog.songAllowed(s, fallback));
    return page.songs.length ? page : { notApproved: true };
  },
  'catalog:playlist': async (id) => {
    const page = await api.playlist(id);
    page.songs = page.songs.filter((s) => catalog.songAllowed(s));
    if (!catalog.isApprovedArtist(page.playlist.author && page.playlist.author.id)) page.playlist.thumbnail = '';
    return page;
  },
  'catalog:radio': async ({ videoId, continuation }) => {
    let res = await api.radio(videoId, continuation);
    let items = res.items.filter((s) => catalog.songAllowed(s));
    // a radio page that filters down to almost nothing reads a few more pages
    for (let i = 0; i < 3 && items.length < 8 && res.continuation; i++) {
      res = await api.radio(null, res.continuation);
      items = items.concat(res.items.filter((s) => catalog.songAllowed(s)));
    }
    return { items, continuation: res.continuation || null };
  },
  'player:play': async (id) => player.play(id),
  'player:resume': async () => player.resume(),
  'player:pause': async () => player.pause(),
  'player:seek': async (s) => player.seek(s),
  'player:volume': async (v) => { player.volume(v); writeSettings({ ...readSettings(), volume: v }); },
  'app:settings': async () => ({ ...readSettings(), version: app.getVersion(), listVersion: catalog.version, artistCount: catalog.allowed.size, systemLocale: app.getLocale() }),
  'settings:set': async ({ key, value } = {}) => {
    const v = settingsSchema.clean(key, value);
    if (v === undefined) throw new Error(`Setting not allowed: ${key}`);
    const all = { ...readSettings(), [key]: v };
    writeSettings(all);
    applySettings(all, key);
    if (sync && SHARED_SETTINGS.includes(key)) sync.soon();
    return v;
  },
  'data:get': async (name) => { if (!DATA[name]) throw new Error('Unknown data'); return readRaw(dataFile(DATA[name]), []); },
  'data:set': async ({ name, value } = {}) => {
    if (!DATA[name]) throw new Error('Unknown data');
    writeRaw(dataFile(DATA[name]), name === 'searchHistory' ? cleanSearches(value) : cleanHistory(value, name === 'plays' ? 1000 : 500));
    if (sync && name !== 'searchHistory' && name !== 'plays') sync.soon();
  },
  // Settings > Sync (phone <-> PC)
  'sync:info': async () => sync.info(),
  'sync:create': async () => sync.create(),
  'sync:join': async (code) => sync.join(code),
  'sync:leave': async (erase) => sync.leave(!!erase),
  'sync:now': async () => sync.syncNow(),
  'lyrics:get': async (want) => {
    if (!want || typeof want.videoId !== 'string') return null;
    return getLyrics(want, readSettings().lyricsProviders, { api, fetchImpl: (url, init) => net.fetch(url, init) });
  },
  'download:add': async (songs) => {
    const list = (Array.isArray(songs) ? songs : [songs]).map(cleanSong).filter(Boolean).slice(0, 500);
    return { added: manager.add(list) };
  },
  'download:cancel': async (id) => manager.cancel(typeof id === 'string' ? id : null),
  'download:retry': async () => manager.retry(),
  'download:jobs': async () => manager.list(),
  'download:list': async () => downloads.list(),
  'download:remove': async (id) => { if (typeof id === 'string') downloads.remove(id); },
  'download:openFolder': async () => { fs.mkdirSync(downloads.folder, { recursive: true }); await shell.openPath(downloads.folder); },
  'app:playing': async (playing) => updateThumbar(!!playing),
  'storage:cacheSize': async () => {
    const sizes = await Promise.all([session.defaultSession, session.fromPartition('persist:ytmusic')].map((s) => s.getCacheSize().catch(() => 0)));
    return sizes.reduce((a, b) => a + b, 0);
  },
  'storage:clearCache': async () => {
    await Promise.all([session.defaultSession, session.fromPartition('persist:ytmusic')].map((s) => s.clearCache().catch(() => {})));
  },
  'backup:export': async (extra = {}) => {
    const stamp = new Date().toISOString().slice(0, 10);
    const r = await dialog.showSaveDialog(win, { title: 'Back up Stalow Music', defaultPath: `Stalow-Music-backup-${stamp}.json`, filters: [{ name: 'Stalow Music backup', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return { canceled: true };
    const backup = {
      app: 'Stalow Music', format: 1, created: new Date().toISOString(), version: app.getVersion(),
      settings: readSettings(),
      session: cleanSession(extra.session) || readSession(),
      history: cleanHistory(readRaw(dataFile(DATA.history), [])),
      searchHistory: cleanSearches(readRaw(dataFile(DATA.searchHistory), [])),
    };
    fs.writeFileSync(r.filePath, JSON.stringify(backup, null, 1));
    return { file: r.filePath };
  },
  'backup:import': async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Restore Stalow Music', properties: ['openFile'], filters: [{ name: 'Stalow Music backup', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };
    const stat = fs.statSync(r.filePaths[0]);
    if (stat.size > 20 * 1024 * 1024) throw new Error('This file is too large to be a Stalow Music backup');
    const b = readRaw(r.filePaths[0], null);
    if (!b || b.app !== 'Stalow Music' || typeof b.settings !== 'object') throw new Error('This file is not a Stalow Music backup');
    const settings = settingsSchema.normalize({ ...readSettings(), ...b.settings });
    writeSettings(settings);
    applySettings(settings);
    if (Array.isArray(b.history)) writeRaw(dataFile(DATA.history), cleanHistory(b.history));
    if (Array.isArray(b.searchHistory)) writeRaw(dataFile(DATA.searchHistory), cleanSearches(b.searchHistory));
    const sess = cleanSession(b.session);
    if (sess) writeSession(sess);
    return { restored: true };
  },
  'app:signin': async () => player.showSignIn(),
  'app:togglePlayer': async () => player.toggleVisible(),
  // Videos and podcasts as video: 'full', 'window' or 'off' (audio only), with the bar's texts in the app language
  'player:video': async ({ mode, labels } = {}) => {
    const clean = {};
    for (const [k, v] of Object.entries(labels && typeof labels === 'object' ? labels : {})) if (/^\w{1,20}$/.test(k) && typeof v === 'string') clean[k] = v.slice(0, 60);
    return player.showVideo(['full', 'window'].includes(mode) ? mode : 'off', clean);
  },
  'app:openExternal': async (url) => { if (/^https:\/\//.test(url)) await shell.openExternal(url); },
  'app:checkUpdates': async () => checkForUpdates(true),
  'app:installUpdate': async (resume) => {
    // carry on playing after the update, if music was playing
    const s = readSession(); if (s) writeSession({ ...s, resume: !!resume });
    installUpdate();
  },
  'app:saveSession': async (s) => {
    const clean = cleanSession(s);
    if (!clean) return;
    const old = readSession();
    // [at] changes when the song changes (not every few seconds), so other devices see a fresh "continue" offer
    const sameSong = old && old.queue && old.queue[old.index] && old.queue[old.index].id === clean.queue[clean.index].id;
    writeSession({ ...clean, resume: !!(old && old.resume), at: sameSong && old.at ? old.at : Date.now() });
  },
  'app:loadSession': async () => {
    const s = readSession();
    if (s && s.resume) writeSession({ ...s, resume: false }); // only the first start after an update resumes
    return s;
  },
};

for (const [channel, fn] of Object.entries(handlers)) {
  ipcMain.handle(channel, async (_e, arg) => {
    try { return { ok: true, data: await fn(arg) }; } catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
}

// ---------- updates: same website as the Android app (see package.json "publish") ----------
let pendingInstaller = null;
let checking = false;

/** Updates from the Stalow website (see updater.js): downloaded and checked in the background, installed on restart. */
async function checkForUpdates(manual) {
  if (!app.isPackaged) { if (manual) send('update', { state: 'dev' }); return; }
  if (pendingInstaller) { send('update', { state: 'ready', version: pendingInstaller.version }); return; }
  if (checking) return;
  checking = true;
  try {
    const r = await updater.checkAndDownload(app.getVersion(), app.getPath('temp'), (percent) => send('update', { state: 'downloading', percent }));
    if (r.state === 'ready') { pendingInstaller = r; send('update', { state: 'ready', version: r.version, notes: r.notes }); }
    else if (manual) send('update', { state: 'none' });
  } catch (e) {
    if (manual) send('update', { state: 'error', message: e.message });
  } finally { checking = false; }
}

/** Runs the downloaded installer silently and quits; the installer starts the new version when it is done. */
function installUpdate() {
  if (!pendingInstaller) return;
  const { spawn } = require('child_process');
  spawn(pendingInstaller.installer, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
  app.quit();
}

/** Applies stored settings that the main process and the hidden player use (all of them, or just [changed]). */
function applySettings(s, changed = null) {
  const is = (...keys) => !changed || keys.includes(changed);
  if (catalog && is('allowFemale', 'blockPodcasts')) { catalog.setAllowFemale(s.allowFemale); catalog.setFilters({ blockPodcasts: s.blockPodcasts }); }
  if (is('language')) api.setLanguage(settingsSchema.contentLanguage(s.language, app.getLocale()));
  if (player && is('audioQuality', 'audioNormalization', 'skipSilence', 'blockVideos')) {
    player.setAudio({ quality: s.audioQuality, normalize: s.audioNormalization, skipSilence: s.skipSilence, blockVideo: s.blockVideos });
  }
}

app.whenReady().then(async () => {
  // a separate connection with no Google sign-in, so Drive treats every play the same
  const driveSession = session.fromPartition('stalow-drive');
  protocol.handle('stalow-drive', createDriveHandler({
    fetchImpl: (url, init) => driveSession.fetch(url, init),
    onError: (e) => { lastDriveError = e; },
  }));
  const startSettings = readSettings();
  downloads = new Downloads(path.join(app.getPath('userData'), 'downloads.json'), path.join(app.getPath('music'), 'Stalow Music'));
  manager = new DownloadManager({
    downloads, pageScript: PAGE_SCRIPT, statusPrefix: STATUS_PREFIX, maxBytes: MAX_BYTES,
    queueFile: path.join(app.getPath('userData'), 'download-queue.json'),
    createWindow: () => new BrowserWindow({
      show: false, width: 800, height: 600, title: 'Stalow Music - download',
      webPreferences: { partition: 'persist:ytmusic', backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'player-preload.js') },
    }),
    onChange: (jobs) => send('download-jobs', jobs),
    onSaved: (song) => { send('download', { id: song.id, state: 'done' }); if (sync) sync.soon(); },
  });
  sync = new Sync({
    file: path.join(app.getPath('userData'), 'sync.json'),
    deviceName: `PC (${os.hostname()})`.slice(0, 60),
    fetchImpl: (url, init) => net.fetch(url, init), // Chromium's network: the system proxy and certificates, like the rest of the app
    local: {
      history: () => cleanHistory(readRaw(dataFile(DATA.history), [])),
      setHistory: (list) => { writeRaw(dataFile(DATA.history), cleanHistory(list)); send('synced', { history: true }); },
      likes: () => cleanHistory(readRaw(dataFile(DATA.likes), [])),
      setLikes: (list) => { writeRaw(dataFile(DATA.likes), cleanHistory(list)); send('synced', { likes: true }); },
      downloads: () => downloads.list(),
      queueDownloads: (songs) => manager.add(songs.map(cleanSong).filter(Boolean)),
      settings: () => readSettings(),
      applySettings: (changes) => {
        const all = { ...readSettings() };
        for (const [k, v] of Object.entries(changes)) { const c = settingsSchema.clean(k, v); if (c !== undefined) all[k] = c; }
        writeSettings(all);
        for (const k of Object.keys(changes)) applySettings(all, k);
        send('synced', { settings: true });
      },
      session: () => {
        const sess = readSession();
        if (!sess || !sess.queue || !sess.queue.length) return null;
        const from = Math.max(0, sess.index - 20);
        return { queue: sess.queue.slice(from, from + 100), index: sess.index - from, time: Math.floor(sess.time || 0), at: sess.at || 0 };
      },
    },
    onChange: (info) => send('sync', info),
  });
  sync.start();
  setTimeout(() => sync.syncNow().catch(() => {}), 8000);
  accounts = new Accounts({
    file: path.join(app.getPath('userData'), 'account.json'),
    catalogFile: path.join(app.getPath('userData'), 'stalow-catalog.json'),
    fetchImpl: (url, init) => net.fetch(url, init),
    deviceName: `Windows: ${os.hostname()}`.slice(0, 80),
  });
  baseList = loadArtists();
  baseChannels = loadChannels();
  buildCatalog();
  driveCache = readRaw(dataFile('stalow-drive'), []);
  setTimeout(() => checkAccount().then(() => refreshDrive()).catch(() => {}), 1500);
  setInterval(() => checkAccount().then(() => refreshDrive()).catch(() => {}), 10 * 60 * 1000);
  player = new Player((ev) => {
    if (ev.state === 'playing') updateThumbar(true);
    else if (ev.state === 'paused' || ev.state === 'ended') updateThumbar(false);
    send('player', ev);
  });
  await player.init(); // also sets up the YouTube Music session (consent, ad blocking) the download players share
  applySettings(startSettings);
  setTimeout(() => manager.pump(), 3000); // carry on with songs left waiting when the app was closed
  player.win.webContents.on('did-navigate', (_e, url) => {
    // after signing in, hide the window again as soon as YouTube Music opens
    if (/^https:\/\/music\.youtube\.com\//.test(url) && player.win.isVisible() && player.signingIn) { player.signingIn = false; player.hide(); }
  });
  const vol = readSettings().volume;
  createWindow();
  win.webContents.once('did-finish-load', () => { if (typeof vol === 'number') player.volume(vol); updateThumbar(false); });
  setTimeout(() => checkForUpdates(false), 5000);
  setInterval(() => checkForUpdates(false), 6 * 3600 * 1000);
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('before-quit', () => { if (sync) sync.stop(); if (manager) manager.destroy(); if (player) player.destroy(); });
