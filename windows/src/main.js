'use strict';
const { app, BrowserWindow, ipcMain, shell, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { api } = require('./ytm');
const { loadArtists, Catalog } = require('./catalog');
const { Player } = require('./player');
const { searchAll, keepFullPlaylists } = require('./search');
const updater = require('./updater');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let player = null;
let catalog = null;
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const readSettings = () => { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; } };
const writeSettings = (s) => { try { fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 1)); } catch { /* ignore */ } };

// The queue and song are kept in a file (not browser storage), written at once, so a restart or an
// update that closes the app straight away cannot lose them.
const sessionFile = () => path.join(app.getPath('userData'), 'session.json');
const readSession = () => { try { return JSON.parse(fs.readFileSync(sessionFile(), 'utf8')); } catch { return null; } };
const writeSession = (s) => { try { fs.writeFileSync(sessionFile(), JSON.stringify(s)); } catch { /* ignore */ } };

const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };

function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 820, minHeight: 560,
    backgroundColor: '#061a46', title: 'Stalow Music',
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
  'catalog:search': async (q) => searchAll(api, catalog, q),
  'catalog:artists': async (text) => catalog.findArtists(text),
  'catalog:home': async (recentArtistIds) => ({ artists: catalog.homeArtists(recentArtistIds, 18) }),
  'catalog:artist': async (id) => {
    if (!catalog.isApprovedArtist(id)) return { notApproved: true };
    const page = await api.artist(id);
    const known = catalog.artists.find((a) => a.id === id);
    page.artist.title = page.artist.title || (known && known.name) || '';
    page.artist.thumbnail = page.artist.thumbnail || (known && known.thumbnail) || '';
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
  'app:settings': async () => ({ ...readSettings(), version: app.getVersion(), listVersion: catalog.version, artistCount: catalog.allowed.size }),
  'app:signin': async () => player.showSignIn(),
  'app:togglePlayer': async () => player.toggleVisible(),
  'app:openExternal': async (url) => { if (/^https:\/\//.test(url)) await shell.openExternal(url); },
  'app:checkUpdates': async () => checkForUpdates(true),
  'app:installUpdate': async (resume) => {
    // carry on playing after the update, if music was playing
    const s = readSession(); if (s) writeSession({ ...s, resume: !!resume });
    installUpdate();
  },
  'app:saveSession': async (s) => { if (s && Array.isArray(s.queue)) { const old = readSession(); writeSession({ ...s, resume: !!(old && old.resume) }); } },
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

app.whenReady().then(async () => {
  catalog = new Catalog(loadArtists(), { allowFemale: !!readSettings().allowFemale });
  player = new Player((ev) => {
    if (ev.state === 'playing') updateThumbar(true);
    else if (ev.state === 'paused' || ev.state === 'ended') updateThumbar(false);
    send('player', ev);
  });
  await player.init();
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
app.on('before-quit', () => { if (player) player.destroy(); });
