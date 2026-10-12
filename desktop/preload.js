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
  send: (files, zip) => ipcRenderer.invoke('airdrop:send', files, zip),
  status: () => ipcRenderer.invoke('airdrop:status'),
  onStatus: callback => { ipcRenderer.on('airdrop:status', (event, value) => callback(value)); },
  folder: () => ipcRenderer.invoke('airdrop:folder'),
  pwa: () => ipcRenderer.invoke('airdrop:pwa'),
  saveUrl: url => ipcRenderer.invoke('airdrop:save-url', url)
});
