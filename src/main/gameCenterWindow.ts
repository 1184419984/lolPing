import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { GameActionResult, GameState } from '../shared/game';
import { GAME_CH } from '../shared/gameChannels';
import { IS_MAC, loadPage, pageUrl, preloadPath } from './paths';
import type { GameFrame } from '../shared/gameSurface';
import type { SessionFrame } from '../shared/gameSession';

export interface GameCenterDeps {
  state(): GameState;
  onState(cb: (state: GameState) => void): () => void;
  start(tests: unknown, multiplayer: boolean): GameActionResult;
  accept(): GameActionResult;
  decline(): void;
  begin(): GameActionResult;
  cancel(): void;
  title(): string;
  onFocus(on: boolean): void;
  openStage(now: unknown): Promise<GameFrame | null>;
  input(raw: unknown): Promise<GameFrame | null>;
  stopStage(): Promise<void>;
  openWeb(): Promise<GameActionResult>;
  inviteWeb(): GameActionResult;
  session?(): SessionFrame | null;
  sessionAction?(raw: unknown): boolean;
  onSession?(cb: (frame: SessionFrame | null) => void): () => void;
}

/** A separate game surface keeps focus and pointer handling out of the click-through overlay. */
export class GameCenterWindow {
  private win: BrowserWindow | null = null;
  private destroyed = false;
  private off: (() => void) | null = null;
  private offSession: (() => void) | null = null;

  constructor(private readonly deps: GameCenterDeps) {
    ipcMain.handle(GAME_CH.get, (event) => this.owns(event) ? this.deps.state() : null);
    ipcMain.handle(GAME_CH.start, (event, tests: unknown, multiplayer: unknown) => this.owns(event)
      ? this.deps.start(tests, multiplayer === true) : { ok: false, error: 'invalid' });
    ipcMain.handle(GAME_CH.accept, (event) => this.owns(event) ? this.deps.accept() : { ok: false, error: 'invalid' });
    ipcMain.handle(GAME_CH.decline, (event) => { if (this.owns(event)) this.deps.decline(); });
    ipcMain.handle(GAME_CH.begin, (event) => this.owns(event) ? this.deps.begin() : { ok: false, error: 'invalid' });
    ipcMain.handle(GAME_CH.cancel, (event) => { if (this.owns(event)) this.deps.cancel(); });
    ipcMain.handle(GAME_CH.openStage, (event, now: unknown) => this.owns(event) ? this.deps.openStage(now) : null);
    ipcMain.handle(GAME_CH.input, (event, raw: unknown) => this.owns(event) ? this.deps.input(raw) : null);
    ipcMain.handle(GAME_CH.stopStage, (event) => { if (this.owns(event)) return this.deps.stopStage(); });
    ipcMain.handle(GAME_CH.openWeb, (event) => this.owns(event) ? this.deps.openWeb() : { ok: false, error: 'invalid' });
    ipcMain.handle(GAME_CH.inviteWeb, (event) => this.owns(event) ? this.deps.inviteWeb() : { ok: false, error: 'invalid' });
    ipcMain.handle(GAME_CH.session, (event) => this.owns(event) ? this.deps.session?.() ?? null : null);
    ipcMain.handle(GAME_CH.sessionAction, (event, raw: unknown) => this.owns(event) && (this.deps.sessionAction?.(raw) ?? false));
    this.offSession = this.deps.onSession?.((frame) => {
      if (this.win && !this.win.isDestroyed()) this.win.webContents.send(GAME_CH.sessionChanged, frame);
    }) ?? null;
    this.off = this.deps.onState((state) => {
      if (this.win && !this.win.isDestroyed()) {
        this.win.setTitle(this.deps.title());
        this.win.webContents.send(GAME_CH.changed, state);
      }
    });
  }

  open(): void {
    if (this.destroyed) return;
    const win = this.ensureWindow();
    if (!win.webContents.isLoading()) { win.show(); win.focus(); }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.off?.(); this.off = null;
    this.offSession?.(); this.offSession = null;
    this.deps.onFocus(false);
    for (const channel of Object.values(GAME_CH)) ipcMain.removeHandler(channel);
    this.win?.destroy(); this.win = null;
  }

  private owns(event: IpcMainInvokeEvent): boolean {
    return this.win !== null && !this.win.isDestroyed() && event.sender === this.win.webContents;
  }

  private ensureWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const win = new BrowserWindow({ width: 980, height: 720, minWidth: 760, minHeight: 560, title: this.deps.title(),
      show: false, backgroundColor: '#111923', ...(IS_MAC ? { vibrancy: 'under-window' as const } : {}),
      webPreferences: { preload: preloadPath('game'), spellcheck: false } });
    this.win = win;
    win.setMenuBarVisibility(false);
    win.on('focus', () => this.deps.onFocus(true));
    win.on('blur', () => { this.deps.onFocus(false); void this.deps.stopStage(); });
    win.on('closed', () => { if (this.win === win) this.win = null; this.deps.onFocus(false); this.deps.cancel(); });
    win.webContents.on('render-process-gone', () => { this.deps.onFocus(false); this.deps.cancel(); win.destroy(); });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => {
      try {
        const next = new URL(event.url); const own = new URL(pageUrl('game'));
        if (next.protocol === own.protocol && next.host === own.host && next.pathname === own.pathname) return;
      } catch { /* invalid URLs are blocked */ }
      event.preventDefault();
    });
    win.once('ready-to-show', () => {
      if (this.destroyed || win.isDestroyed()) return;
      win.show(); win.focus();
    });
    void loadPage(win, 'game').catch(() => { if (!win.isDestroyed()) win.destroy(); });
    return win;
  }
}
