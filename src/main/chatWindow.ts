import { BrowserWindow, globalShortcut, ipcMain, screen, type IpcMainInvokeEvent } from 'electron';
import type { ChatSendResult } from '../shared/chat';
import { CHAT_CH } from '../shared/chatChannels';
import { strings } from '../shared/i18n';
import type { ChatState } from '../shared/ipc';
import { IS_MAC, loadPage, pageUrl, preloadPath } from './paths';

export const CHAT_SHORTCUT = 'Control+Alt+Enter';
const VISIBLE_MS = 10_000;

export interface ChatWindowDeps {
  state(): Omit<ChatState, 'composing' | 'shortcutAvailable'>;
  send(text: string): ChatSendResult;
  onComposing(on: boolean): void;
  shortcutAllowed(): boolean;
}

/** A click-through message pane that takes focus only when the user opens its input. */
export class ChatWindow {
  private win: BrowserWindow | null = null;
  private composing = false;
  private shortcut = false;
  private recent = false;
  private timer: NodeJS.Timeout | null = null;
  private destroyed = false;
  private height = 320;
  private readonly reposition = (): void => this.position();

  constructor(private readonly deps: ChatWindowDeps) {
    ipcMain.handle(CHAT_CH.get, (event) => this.owns(event) ? this.state() : null);
    ipcMain.handle(CHAT_CH.send, (event, raw: unknown): ChatSendResult => {
      if (!this.owns(event) || !this.composing) return { ok: false, error: 'notInRoom' };
      return typeof raw === 'string' ? this.deps.send(raw) : { ok: false, error: 'empty' };
    });
    ipcMain.handle(CHAT_CH.close, (event) => { if (this.owns(event)) this.closeInput(); });
    ipcMain.handle(CHAT_CH.resize, (event, raw: unknown) => {
      if (!this.owns(event) || typeof raw !== 'number' || !Number.isFinite(raw)) return;
      const height = Math.max(34, Math.min(320, Math.ceil(raw)));
      if (height === this.height) return;
      this.height = height;
      this.position();
    });
    screen.on('display-added', this.reposition);
    screen.on('display-removed', this.reposition);
    screen.on('display-metrics-changed', this.reposition);
  }

  state(): ChatState {
    return { ...this.deps.state(), composing: this.composing, shortcutAvailable: this.shortcut };
  }

  /** Room, pause and language changes never create a window or steal focus. */
  refresh(): void {
    if (this.destroyed) return;
    const state = this.deps.state();
    const active = state.roomCode !== null && state.enabled;
    const wantsShortcut = active && this.deps.shortcutAllowed();
    if (!wantsShortcut && this.shortcut) {
      globalShortcut.unregister(CHAT_SHORTCUT);
      this.shortcut = false;
    } else if (wantsShortcut && !this.shortcut) {
      try {
        this.shortcut = globalShortcut.register(CHAT_SHORTCUT, () => {
          if (this.composing) this.closeInput();
          else this.open();
        });
      } catch {
        this.shortcut = false;
      }
    }
    if (!active) {
      this.clearRecent();
      this.closeInput();
      this.win?.hide();
    }
    this.push();
  }

  open(): void {
    if (this.destroyed) return;
    const state = this.deps.state();
    if (!state.roomCode || !state.enabled) return;
    const win = this.ensureWindow();
    this.setComposing(true);
    win.setFocusable(true);
    win.setIgnoreMouseEvents(false);
    this.push();
    if (!win.webContents.isLoading()) {
      win.show();
      win.focus();
    }
  }

  closeInput(): void {
    if (!this.composing) return;
    this.setComposing(false);
    // Hiding releases keyboard focus before showing the passive pane again.
    this.win?.hide();
    this.win?.setIgnoreMouseEvents(true);
    this.win?.setFocusable(false);
    this.push();
    if (this.recent && this.deps.state().enabled) this.win?.showInactive();
  }

  /** A message appears briefly without activating its window. */
  notify(): void {
    if (this.destroyed) return;
    const state = this.deps.state();
    if (!state.roomCode || !state.enabled) return;
    const win = this.ensureWindow();
    this.clearRecent();
    this.recent = true;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.recent = false;
      if (!this.composing) this.win?.hide();
    }, VISIBLE_MS);
    this.push();
    if (!this.composing && !win.webContents.isLoading()) win.showInactive();
  }

  reset(): void {
    this.clearRecent();
    this.closeInput();
    this.win?.hide();
    this.refresh();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearRecent();
    this.setComposing(false);
    if (this.shortcut) globalShortcut.unregister(CHAT_SHORTCUT);
    this.shortcut = false;
    for (const channel of [CHAT_CH.get, CHAT_CH.send, CHAT_CH.close, CHAT_CH.resize]) ipcMain.removeHandler(channel);
    screen.removeListener('display-added', this.reposition);
    screen.removeListener('display-removed', this.reposition);
    screen.removeListener('display-metrics-changed', this.reposition);
    this.win?.destroy();
    this.win = null;
  }

  private owns(event: IpcMainInvokeEvent): boolean {
    return this.win !== null && !this.win.isDestroyed() && event.sender === this.win.webContents;
  }

  private setComposing(on: boolean): void {
    if (on === this.composing) return;
    this.composing = on;
    this.deps.onComposing(on);
  }

  private clearRecent(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.recent = false;
  }

  private push(): void {
    if (!this.win || this.win.webContents.isDestroyed()) return;
    const state = this.state();
    this.win.setTitle(`lolPing · ${strings(state.lang, state.platform).chatTitle}`);
    this.win.webContents.send(CHAT_CH.changed, state);
  }

  private position(): void {
    if (!this.win || this.win.isDestroyed()) return;
    const area = screen.getPrimaryDisplay().workArea;
    const inset = Math.min(12, Math.max(0, Math.floor((Math.min(area.width, area.height) - 1) / 2)));
    const width = Math.max(1, Math.min(440, area.width - inset * 2));
    const height = Math.max(1, Math.min(this.height, area.height - inset * 2));
    this.win.setBounds({ x: area.x + inset, y: area.y + area.height - height - inset, width, height });
  }

  private ensureWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const win = new BrowserWindow({
      width: 440, height: 320, title: 'lolPing', frame: false, transparent: true, backgroundColor: '#00000000',
      show: false, focusable: false, skipTaskbar: true, resizable: false, hasShadow: false,
      webPreferences: { preload: preloadPath('chat'), spellcheck: false },
    });
    this.win = win;
    this.position();
    win.setAlwaysOnTop(true, 'screen-saver');
    if (IS_MAC) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setIgnoreMouseEvents(true);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => {
      try {
        const next = new URL(event.url);
        const own = new URL(pageUrl('chat'));
        if (next.protocol === own.protocol && next.host === own.host && next.pathname === own.pathname) return;
      } catch {
        // Invalid URLs are blocked along with every page except our own.
      }
      event.preventDefault();
    });
    win.on('blur', () => this.closeInput());
    win.on('closed', () => {
      if (this.win !== win) return;
      this.win = null;
      this.clearRecent();
      this.setComposing(false);
    });
    win.webContents.on('render-process-gone', () => {
      this.closeInput();
      win.destroy();
    });
    win.once('ready-to-show', () => {
      if (this.destroyed || win.isDestroyed()) return;
      this.push();
      if (this.composing) {
        win.setFocusable(true);
        win.setIgnoreMouseEvents(false);
        win.show();
        win.focus();
      } else if (this.recent) win.showInactive();
    });
    void loadPage(win, 'chat').catch((error: unknown) => {
      console.warn('[chat]', error);
      if (!win.isDestroyed()) win.destroy();
    });
    return win;
  }
}
