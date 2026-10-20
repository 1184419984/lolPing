import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { GameActionResult, GameState } from '../shared/game';
import { GAME_CH } from '../shared/gameChannels';
import type { GameFrame, GameInput } from '../shared/gameSurface';
import type { SessionAction, SessionFrame } from '../shared/gameSession';

const on = (channel: string, cb: (state: GameState) => void): (() => void) => {
  const handler = (_event: IpcRendererEvent, state: GameState) => cb(state);
  ipcRenderer.on(channel, handler); return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('gameApi', {
  get: (): Promise<GameState | null> => ipcRenderer.invoke(GAME_CH.get),
  onState: (cb: (state: GameState) => void): (() => void) => on(GAME_CH.changed, cb),
  start: (tests: unknown, multiplayer: boolean): Promise<GameActionResult> => ipcRenderer.invoke(GAME_CH.start, tests, multiplayer),
  accept: (): Promise<GameActionResult> => ipcRenderer.invoke(GAME_CH.accept),
  decline: (): Promise<void> => ipcRenderer.invoke(GAME_CH.decline),
  begin: (): Promise<GameActionResult> => ipcRenderer.invoke(GAME_CH.begin),
  cancel: (): Promise<void> => ipcRenderer.invoke(GAME_CH.cancel),
  openStage: (now: number): Promise<GameFrame | null> => ipcRenderer.invoke(GAME_CH.openStage, now),
  input: (input: GameInput): Promise<GameFrame | null> => ipcRenderer.invoke(GAME_CH.input, input),
  stopStage: (): Promise<void> => ipcRenderer.invoke(GAME_CH.stopStage),
  openWeb: (): Promise<GameActionResult> => ipcRenderer.invoke(GAME_CH.openWeb),
  inviteWeb: (): Promise<GameActionResult> => ipcRenderer.invoke(GAME_CH.inviteWeb),
  session: (): Promise<SessionFrame | null> => ipcRenderer.invoke(GAME_CH.session),
  sessionAction: (action: SessionAction): Promise<boolean> => ipcRenderer.invoke(GAME_CH.sessionAction, action),
  onSession: (cb: (frame: SessionFrame | null) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, frame: SessionFrame | null) => cb(frame);
    ipcRenderer.on(GAME_CH.sessionChanged, handler);
    return () => ipcRenderer.removeListener(GAME_CH.sessionChanged, handler);
  },
});
