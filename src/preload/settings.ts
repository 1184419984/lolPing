import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { SettingsApi } from '../shared/ipc';
import { SETTINGS_CH } from '../shared/settingsChannels';

function subscribe<T>(channel: string, cb: (v: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, v: T) => cb(v);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: SettingsApi = {
  getHot: () => ipcRenderer.invoke(SETTINGS_CH.hotGet),
  onHot: (cb) => subscribe(SETTINGS_CH.hotState, cb),
  pushHot: () => ipcRenderer.invoke(SETTINGS_CH.hotPush),
  acceptHot: () => ipcRenderer.invoke(SETTINGS_CH.hotAccept),
  dismissHot: () => ipcRenderer.invoke(SETTINGS_CH.hotDismiss),
  rollbackHot: () => ipcRenderer.invoke(SETTINGS_CH.hotRollback),
  configureModule: (id, values) => ipcRenderer.invoke(SETTINGS_CH.moduleConfigure, id, values),
  moduleAction: (id, action) => ipcRenderer.invoke(SETTINGS_CH.moduleAction, id, action),
  // Inlined rather than imported: a sandboxed preload can't require a shared chunk.
  platform: process.platform === 'darwin' ? 'mac' : 'win',
  getSettings: () => ipcRenderer.invoke(SETTINGS_CH.get),
  setSettings: (patch) => ipcRenderer.invoke(SETTINGS_CH.set, patch),
  onSettings: (cb) => subscribe(SETTINGS_CH.changed, cb),
  getStatus: () => ipcRenderer.invoke(SETTINGS_CH.status),
  onStatus: (cb) => subscribe(SETTINGS_CH.statusChanged, cb),
  setEnabled: (on) => ipcRenderer.invoke(SETTINGS_CH.setEnabled, on),
  previewPing: (id) => ipcRenderer.invoke(SETTINGS_CH.preview, id),
  previewHydration: () => ipcRenderer.invoke(SETTINGS_CH.previewHydration),
  previewEmote: (ref) => ipcRenderer.invoke(SETTINGS_CH.previewEmote, ref),
  importEmote: (file) => ipcRenderer.invoke(SETTINGS_CH.emoteImport, file),
  removeEmote: (id) => ipcRenderer.invoke(SETTINGS_CH.emoteRemove, id),
  getAbout: () => ipcRenderer.invoke(SETTINGS_CH.about),
  openSettingsFolder: () => ipcRenderer.invoke(SETTINGS_CH.openFolder),
  openProjectPage: () => ipcRenderer.invoke(SETTINGS_CH.openProject),
  retryHelper: () => ipcRenderer.invoke(SETTINGS_CH.retryHelper),
  setCapturing: (on) => ipcRenderer.invoke(SETTINGS_CH.capture, on),
  openAccessibility: () => ipcRenderer.invoke(SETTINGS_CH.openAccessibility),
  getRoom: () => ipcRenderer.invoke(SETTINGS_CH.roomGet),
  onRoom: (cb) => subscribe(SETTINGS_CH.roomChanged, cb),
  createRoom: () => ipcRenderer.invoke(SETTINGS_CH.roomCreate),
  joinRoom: (text) => ipcRenderer.invoke(SETTINGS_CH.roomJoin, text),
  leaveRoom: () => ipcRenderer.invoke(SETTINGS_CH.roomLeave),
  muteMember: (peer, on) => ipcRenderer.invoke(SETTINGS_CH.roomMute, peer, on),
  clipboardRoomCode: () => ipcRenderer.invoke(SETTINGS_CH.roomClipboard),
  copyRoomCode: () => ipcRenderer.invoke(SETTINGS_CH.roomCopy),
  retryInternet: () => ipcRenderer.invoke(SETTINGS_CH.roomRetryInternet),
  openChat: () => ipcRenderer.invoke(SETTINGS_CH.roomOpenChat),
  openGameCenter: () => ipcRenderer.invoke(SETTINGS_CH.roomOpenGame),
  pushRoomUpdate: () => ipcRenderer.invoke(SETTINGS_CH.roomPushUpdate),
  checkRoomUpdate: () => ipcRenderer.invoke(SETTINGS_CH.roomCheckUpdate),
  onShowSection: (cb) => subscribe(SETTINGS_CH.showSection, cb),
  getUpdate: () => ipcRenderer.invoke(SETTINGS_CH.updateGet),
  onUpdate: (cb) => subscribe(SETTINGS_CH.updateState, cb),
  checkForUpdates: () => ipcRenderer.invoke(SETTINGS_CH.updateCheck),
  startUpdate: () => ipcRenderer.invoke(SETTINGS_CH.updateStart),
  openReleasePage: () => ipcRenderer.invoke(SETTINGS_CH.updateOpenRelease),
};

contextBridge.exposeInMainWorld('settingsApi', api);
