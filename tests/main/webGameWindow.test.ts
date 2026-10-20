import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebGameWindow } from '../../src/main/webGameWindow';
import { FOONY_PAINTJOB } from '../../src/shared/webGame';

const harness = vi.hoisted(() => ({ windows: [] as unknown[], options: [] as Record<string, unknown>[], fail: false,
  permission: null as null | ((contents: unknown, permission: string, callback: (on: boolean) => void) => void),
  check: null as null | (() => boolean), download: null as null | ((event: { preventDefault(): void }) => void) }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Contents extends EventEmitter {
    url = '';
    getURL(): string { return this.url; }
    popup: (() => { action: string }) | null = null;
    setWindowOpenHandler(handler: () => { action: string }): void { this.popup = handler; }
  }
  class Window extends EventEmitter {
    webContents = new Contents(); destroyed = false; visible = false; loads: string[] = [];
    constructor(options: Record<string, unknown>) { super(); harness.windows.push(this); harness.options.push(options); }
    isDestroyed(): boolean { return this.destroyed; }
    setMenuBarVisibility(): void {}
    show(): void { this.visible = true; }
    focus(): void { this.emit('focus'); }
    async loadURL(url: string): Promise<void> { if (harness.fail) throw new Error('Offline'); this.loads.push(url); this.webContents.url = url; }
    destroy(): void { if (!this.destroyed) { this.destroyed = true; this.emit('closed'); } }
  }
  return { BrowserWindow: Window, session: { fromPartition: () => ({
    setPermissionRequestHandler: (cb: typeof harness.permission) => { harness.permission = cb; },
    setPermissionCheckHandler: (cb: typeof harness.check) => { harness.check = cb; },
    on: (_event: string, cb: typeof harness.download) => { harness.download = cb; },
  }) } };
});
type Window = EventEmitter & { webContents: EventEmitter & { popup(): { action: string } }; loads: string[];
  destroyed: boolean; visible: boolean; destroy(): void };
beforeEach(() => { harness.windows.length = 0; harness.options.length = 0; harness.fail = false; });

describe('WebGameWindow', () => {
  function setup() {
    let focus = false; let errors = 0;
    const game = new WebGameWindow({ title: () => 'Chinese game', onFocus: on => { focus = on; }, onError: () => { errors++; } });
    const win = () => harness.windows.at(-1) as Window;
    return { game, win, focus: () => focus, errors: () => errors };
  }
  it('opens only after an explicit command in a sandbox with no application preload', async () => {
    const h = setup();
    try {
      expect(harness.windows).toHaveLength(0);
      expect(await h.game.open('https://evil.test')).toEqual({ ok: false, error: 'invalid' });
      expect(harness.windows).toHaveLength(0);
      expect(await h.game.open(FOONY_PAINTJOB + '#r=kessfvk5')).toEqual({ ok: true });
      const prefs = harness.options[0].webPreferences as Record<string, unknown>;
      expect(prefs).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true });
      expect(prefs.preload).toBeUndefined();
      expect(h.win().visible).toBe(true); expect(h.focus()).toBe(true);
      expect(h.win().loads).toEqual([FOONY_PAINTJOB + '#r=kessfvk5']);
      expect(h.game.roomUrl()).toBe(FOONY_PAINTJOB + '#r=kessfvk5');
      await h.game.open(FOONY_PAINTJOB + '#r=kessfvk5');
      expect(harness.windows).toHaveLength(1); expect(h.win().loads).toHaveLength(1);
    } finally { h.game.destroy(); }
  });
  it('blocks external navigation, popups, device permissions and downloads', async () => {
    const h = setup();
    try {
      await h.game.open(FOONY_PAINTJOB);
      expect(h.win().webContents.popup()).toEqual({ action: 'deny' });
      for (const type of ['will-navigate', 'will-redirect']) {
        const event = { url: 'https://evil.test', preventDefault: vi.fn() };
        h.win().webContents.emit(type, event); expect(event.preventDefault).toHaveBeenCalledOnce();
        const own = { url: FOONY_PAINTJOB + '#r=abc123', preventDefault: vi.fn() };
        h.win().webContents.emit(type, own); expect(own.preventDefault).not.toHaveBeenCalled();
      }
      let granted = true; harness.permission?.({}, 'media', on => { granted = on; }); expect(granted).toBe(false);
      expect(harness.check?.()).toBe(false);
      const download = { preventDefault: vi.fn() }; harness.download?.(download); expect(download.preventDefault).toHaveBeenCalledOnce();
    } finally { h.game.destroy(); }
  });
  it('releases native input focus on blur, close and failure and permits retry after network failure', async () => {
    const h = setup();
    try {
      await h.game.open(FOONY_PAINTJOB); h.win().emit('blur'); expect(h.focus()).toBe(false);
      h.win().emit('focus'); h.game.close(); expect(h.focus()).toBe(false);
      harness.fail = true;
      expect(await h.game.open(FOONY_PAINTJOB)).toEqual({ ok: false, error: 'network' });
      expect(h.errors()).toBe(1); expect(h.focus()).toBe(false);
      harness.fail = false; expect(await h.game.open(FOONY_PAINTJOB)).toEqual({ ok: true });
      h.win().webContents.emit('render-process-gone'); expect(h.focus()).toBe(false); expect(h.errors()).toBe(2);
    } finally { h.game.destroy(); }
  });
});
