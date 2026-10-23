import { contextBridge, ipcRenderer } from 'electron';
import type { BridgeApi } from '../shared/types';

const api: BridgeApi = {
  getState: () => ipcRenderer.invoke('getState'),
  loadShowTitle: () => ipcRenderer.invoke('loadShowTitle'),
  acknowledgeRisk: () => ipcRenderer.invoke('acknowledgeRisk'),
  loginWithBrowser: () => ipcRenderer.invoke('loginWithBrowser'),
  cancelLogin: () => ipcRenderer.invoke('cancelLogin'),
  loginWithDesktopApp: () => ipcRenderer.invoke('loginWithDesktopApp'),
  getAccount: () => ipcRenderer.invoke('getAccount'),
  signOut: () => ipcRenderer.invoke('signOut'),
  searchCategories: (query) => ipcRenderer.invoke('searchCategories', query),
  saveSettings: (settings) => ipcRenderer.invoke('saveSettings', settings),
  goLive: (settings) => ipcRenderer.invoke('goLive', settings),
  endLive: () => ipcRenderer.invoke('endLive'),
  forgetLiveStream: () => ipcRenderer.invoke('forgetLiveStream'),
  copy: (text) => ipcRenderer.invoke('copy', text),
  open: (link) => ipcRenderer.invoke('open', link),
};

contextBridge.exposeInMainWorld('api', api);
