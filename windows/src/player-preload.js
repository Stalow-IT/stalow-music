'use strict';
// Preload of the hidden YouTube Music window. It gives the page one narrow bridge: passing the audio of the song
// being saved (Download) to the app. The app accepts data only for the one song it asked to record, up to a size
// limit, so nothing else on the page can use this to write files.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__stalowRecorder', {
  chunk: (id, data) => { if (typeof id === 'string' && data instanceof ArrayBuffer) ipcRenderer.send('rec:chunk', id, data); },
  done: (id, ok) => { if (typeof id === 'string') ipcRenderer.send('rec:done', id, !!ok); },
});
