import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { CHAT_CH } from '../shared/chatChannels';
import type { ChatApi, ChatState } from '../shared/ipc';

const api: ChatApi = {
  getState: () => ipcRenderer.invoke(CHAT_CH.get),
  onState: (cb) => {
    const handler = (_event: IpcRendererEvent, state: ChatState): void => cb(state);
    ipcRenderer.on(CHAT_CH.changed, handler);
    return () => ipcRenderer.removeListener(CHAT_CH.changed, handler);
  },
  send: (text) => ipcRenderer.invoke(CHAT_CH.send, text),
  close: () => ipcRenderer.invoke(CHAT_CH.close),
  resize: (height) => ipcRenderer.invoke(CHAT_CH.resize, height),
};

contextBridge.exposeInMainWorld('chatApi', api);
