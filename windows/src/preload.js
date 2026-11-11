'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = async (channel, arg) => {
  const r = await ipcRenderer.invoke(channel, arg);
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

contextBridge.exposeInMainWorld('stalow', {
  search: (q) => call('catalog:search', q),
  artists: (text) => call('catalog:artists', text),
  channels: (category, text) => call('catalog:channels', { category, text }),
  home: (recentArtistIds) => call('catalog:home', recentArtistIds),
  artist: (id) => call('catalog:artist', id),
  album: (id) => call('catalog:album', id),
  playlist: (id) => call('catalog:playlist', id),
  radio: (videoId, continuation) => call('catalog:radio', { videoId, continuation }),
  play: (id) => call('player:play', id),
  resume: () => call('player:resume'),
  pause: () => call('player:pause'),
  seek: (s) => call('player:seek', s),
  volume: (v) => call('player:volume', v),
  settings: () => call('app:settings'),
  signIn: () => call('app:signin'),
  togglePlayer: () => call('app:togglePlayer'),
  openExternal: (url) => call('app:openExternal', url),
  checkUpdates: () => call('app:checkUpdates'),
  installUpdate: (resume) => call('app:installUpdate', resume),
  saveSession: (session) => call('app:saveSession', session),
  loadSession: () => call('app:loadSession'),
  onPlayer: (fn) => ipcRenderer.on('player', (_e, ev) => fn(ev)),
  onUpdate: (fn) => ipcRenderer.on('update', (_e, ev) => fn(ev)),
});
