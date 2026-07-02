'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shell', {
  isShell: true,
  minimize: () => ipcRenderer.send('shell', 'minimize'),
  hideToTray: () => ipcRenderer.send('shell', 'hideToTray'),
  quit: () => ipcRenderer.send('shell', 'quit'),
  showMain: () => ipcRenderer.send('shell', 'showMain'),
  openExternal: url => ipcRenderer.send('shell', 'openExternal', url),
  installUpdate: () => ipcRenderer.send('shell', 'installUpdate'),
});
