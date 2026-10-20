import { BrowserWindow, session, type Session } from 'electron';
import { foonyGameUrl, foonyNavigation, foonyRoomUrl } from '../shared/webGame';
import type { GameActionResult } from '../shared/game';

interface WebGameDeps {
  title(): string;
  onFocus(on: boolean): void;
  onError(): void;
}

/** Remote gameplay never receives the app preload, settings, room key or local protocol handlers. */
export class WebGameWindow {
  private win: BrowserWindow | null = null;
  private url: string | null = null;
  private destroyed = false;
  private loading: Promise<GameActionResult> | null = null;
  private partition: Session | null = null;

  constructor(private readonly deps: WebGameDeps) {}

  roomUrl(): string | null {
    return this.win && !this.win.isDestroyed() ? foonyRoomUrl(this.win.webContents.getURL()) : null;
  }

  async open(raw: unknown): Promise<GameActionResult> {
    const url = foonyGameUrl(raw);
    if (!url || this.destroyed) return { ok: false, error: 'invalid' };
    if (this.loading) return this.url === url ? this.loading : { ok: false, error: 'busy' };
    if (this.win && !this.win.isDestroyed() && this.url === url) {
      this.win.show(); this.win.focus(); return { ok: true };
    }
    const win = this.ensureWindow();
    this.url = url;
    this.loading = (async (): Promise<GameActionResult> => {
      try {
        await win.loadURL(url);
        if (this.destroyed || win.isDestroyed()) return { ok: false, error: 'invalid' };
        win.show(); win.focus(); return { ok: true };
      } catch {
        const active = this.win === win && !win.isDestroyed();
        if (!win.isDestroyed()) win.destroy();
        if (!this.destroyed && active) this.deps.onError();
        return { ok: false, error: 'network' };
      } finally { this.loading = null; }
    })();
    return this.loading;
  }

  destroy(): void {
    this.destroyed = true; this.close();
  }

  close(): void {
    this.win?.destroy(); this.win = null;
    this.deps.onFocus(false);
  }

  private ensureWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;
    if (!this.partition) {
      this.partition = session.fromPartition('persist:lolping-foony');
      this.partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      this.partition.setPermissionCheckHandler(() => false);
      this.partition.on('will-download', (event) => event.preventDefault());
    }
    const isolated = this.partition;
    const win = new BrowserWindow({ width: 1160, height: 820, minWidth: 760, minHeight: 560,
      title: this.deps.title(), show: false, backgroundColor: '#14191b',
      webPreferences: { session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false,
        webSecurity: true, allowRunningInsecureContent: false, spellcheck: false } });
    this.win = win;
    win.setMenuBarVisibility(false);
    win.on('focus', () => this.deps.onFocus(true));
    win.on('blur', () => this.deps.onFocus(false));
    win.on('closed', () => { if (this.win === win) { this.win = null; this.url = null; } this.deps.onFocus(false); });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-attach-webview', (event) => event.preventDefault());
    win.webContents.on('will-navigate', (event) => { if (!foonyNavigation(event.url)) event.preventDefault(); });
    win.webContents.on('will-redirect', (event) => { if (!foonyNavigation(event.url)) event.preventDefault(); });
    win.webContents.on('render-process-gone', () => {
      this.deps.onFocus(false); if (!this.destroyed) this.deps.onError(); win.destroy();
    });
    return win;
  }
}
