import { app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage, shell } from 'electron';
import { join } from 'node:path';
import type { ExternalLink, StreamSettings } from '../shared/types';
import { findDesktopToken, loginWithBrowser } from './auth';
import { Controller } from './controller';
import { fetchCurrentShow } from './portal';
import { Store } from './store';

const LINKS: Record<ExternalLink, string> = {
  liveCenter: 'https://livecenter.tiktok.com/live_monitor?lang=en-US',
  liveAccess:
    'https://tiktok.com/falcon/live_g/live_access_pc_apply/result/index.html?id=GL6399433079641606942&lang=en-US',
  source: 'https://github.com/CBP-IT/smoke-pit-tiktok-live',
  upstream: 'https://github.com/Loukious/StreamLabsTikTokStreamKeyGenerator',
};

let window: BrowserWindow | null = null;
let controller: Controller;

function createWindow(): void {
  window = new BrowserWindow({
    width: 560,
    height: 780,
    minWidth: 480,
    minHeight: 600,
    title: 'Smoke Pit TikTok LIVE',
    backgroundColor: '#0a1628',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.once('ready-to-show', () => window?.show());
  window.on('close', confirmCloseWhileLive);
  window.on('closed', () => (window = null));
  void window.loadFile(join(__dirname, '../renderer/index.html'));
}

// Closing the app doesn't stop a TikTok stream, so say so before it disappears.
function confirmCloseWhileLive(event: Electron.Event): void {
  if (!window || !controller.getState().liveStream) return;
  const choice = dialog.showMessageBoxSync(window, {
    type: 'warning',
    buttons: ['Keep app open', 'Quit anyway'],
    defaultId: 0,
    cancelId: 0,
    message: 'You’re still live on TikTok.',
    detail:
      'Quitting won’t end the stream. Click “End LIVE” first, or reopen the app later to end it.',
  });
  if (choice === 0) event.preventDefault();
}

function registerIpc(): void {
  ipcMain.handle('getState', () => controller.getState());
  ipcMain.handle('loadShowTitle', () => controller.loadShowTitle());
  ipcMain.handle('acknowledgeRisk', () => controller.acknowledgeRisk());
  ipcMain.handle('loginWithBrowser', () => controller.loginWithBrowser());
  ipcMain.handle('cancelLogin', () => controller.cancelLogin());
  ipcMain.handle('loginWithDesktopApp', () => controller.loginWithDesktopApp());
  ipcMain.handle('getAccount', () => controller.getAccount());
  ipcMain.handle('signOut', () => controller.signOut());
  ipcMain.handle('searchCategories', (_e, query: string) => controller.searchCategories(String(query ?? '')));
  ipcMain.handle('saveSettings', (_e, settings: StreamSettings) => controller.saveSettings(settings));
  ipcMain.handle('goLive', (_e, settings: StreamSettings) => controller.goLive(settings));
  ipcMain.handle('endLive', () => controller.endLive());
  ipcMain.handle('forgetLiveStream', () => controller.forgetLiveStream());
  ipcMain.handle('copy', (_e, text: string) => clipboard.writeText(String(text ?? '')));
  ipcMain.handle('open', (_e, link: ExternalLink) => {
    if (Object.hasOwn(LINKS, link)) return shell.openExternal(LINKS[link]);
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });

  app.whenReady().then(() => {
    const store = new Store(join(app.getPath('userData'), 'settings.json'), {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (plain) => safeStorage.encryptString(plain),
      decrypt: (encrypted) => safeStorage.decryptString(encrypted),
    });
    controller = new Controller({
      store,
      version: app.getVersion(),
      loginWithBrowser: (signal) =>
        loginWithBrowser({
          signal,
          openUrl: (url) => shell.openExternal(url),
        }),
      findDesktopToken: () => findDesktopToken(),
      fetchCurrentShow: () => fetchCurrentShow(),
    });
    registerIpc();
    createWindow();
  });

  app.on('activate', () => {
    if (!window) createWindow();
  });

  // A Mac app normally stays running with no windows, but this one has nothing to do without one.
  app.on('window-all-closed', () => app.quit());
}
