'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('airdrop', {
  readClipboard: () => ipcRenderer.invoke('airdrop:clipboard-read'),
  copyClipboard: text => ipcRenderer.invoke('airdrop:clipboard-copy', text),
  loadClipboard: () => ipcRenderer.invoke('airdrop:clipboard-load'),
  shareClipboard: text => ipcRenderer.invoke('airdrop:clipboard-share', text),
  choose: () => ipcRenderer.invoke('airdrop:choose'),
  drop: files => ipcRenderer.invoke('airdrop:drop', Array.from(files).map(file => webUtils.getPathForFile(file))),
  describe: files => ipcRenderer.invoke('airdrop:describe', files),
  recent: () => ipcRenderer.invoke('airdrop:recent'),
  settings: () => ipcRenderer.invoke('airdrop:settings'),
  send: (files, zip, directory) => ipcRenderer.invoke('airdrop:send', files, zip, directory),
  explore: (action, payload) => ipcRenderer.invoke('airdrop:explorer', action, payload),
  onShowFiles: callback => ipcRenderer.on('airdrop:show-files', callback),
  setup: action => ipcRenderer.invoke('airdrop:setup', action),
  onSetup: callback => ipcRenderer.on('airdrop:setup-state', (event, value) => callback(value)),
  update: action => ipcRenderer.invoke('airdrop:update', action),
  onUpdate: callback => ipcRenderer.on('airdrop:update-state', (event, value) => callback(value)),
  status: () => ipcRenderer.invoke('airdrop:status'),
  onStatus: callback => { ipcRenderer.on('airdrop:status', (event, value) => callback(value)); },
  folder: () => ipcRenderer.invoke('airdrop:folder'),
  pwa: () => ipcRenderer.invoke('airdrop:pwa'),
  saveUrl: url => ipcRenderer.invoke('airdrop:save-url', url)
});
