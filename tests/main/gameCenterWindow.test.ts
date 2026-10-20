import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GameCenterWindow } from '../../src/main/gameCenterWindow';
import { GAME_CH } from '../../src/shared/gameChannels';
import { GameManager } from '../../src/main/gameManager';
import type { GameState } from '../../src/shared/game';
import { gameCatalog, gameSelection } from './fixtures/gameCatalog';

const harness = vi.hoisted(() => ({
  windows: [] as unknown[],
  handlers: new Map<string, (event: { sender: unknown }, ...args: unknown[]) => unknown>(),
}));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Contents extends EventEmitter {
    loading = true;
    sent: unknown[] = [];
    isLoading(): boolean { return this.loading; }
    send(channel: string, state: unknown): void { this.sent.push({ channel, state }); }
    setWindowOpenHandler(): void {}
  }
  class Window extends EventEmitter {
    webContents = new Contents();
    destroyed = false;
    visible = false;
    focused = false;
    constructor() { super(); harness.windows.push(this); }
    isDestroyed(): boolean { return this.destroyed; }
    setMenuBarVisibility(): void {}
    setTitle(): void {}
    show(): void { this.visible = true; }
    showInactive(): void { this.visible = true; }
    focus(): void { this.focused = true; this.emit('focus'); }
    destroy(): void { if (this.destroyed) return; this.destroyed = true; this.emit('closed'); }
  }
  return { BrowserWindow: Window, ipcMain: {
    handle: (channel: string, handler: (event: { sender: unknown }, ...args: unknown[]) => unknown) => harness.handlers.set(channel, handler),
    removeHandler: (channel: string) => harness.handlers.delete(channel),
  } };
});
vi.mock('../../src/main/paths', () => ({ IS_MAC: false, preloadPath: () => 'game.js',
  loadPage: async () => undefined, pageUrl: () => 'lolping://app/game/index.html' }));

type Window = EventEmitter & { webContents: EventEmitter & { loading: boolean; sent: unknown[] };
  visible: boolean; focused: boolean; destroyed: boolean; destroy(): void };

beforeEach(() => { harness.windows.length = 0; harness.handlers.clear(); });

describe('GameCenterWindow', () => {
  function setup() {
    const game = new GameManager({ catalog: () => gameCatalog, room: () => ({ phase: 'idle', code: null, members: [], lan: 'off', internet: 'off', lonely: false, clockSkew: false }),
      self: () => 'a'.repeat(16), name: () => 'Player', lang: () => 'en', platform: 'win',
      enabled: () => true, id: () => 'd'.repeat(16), now: () => 1000, send: () => ({ ok: true }) });
    let suspended = false;
    const center = new GameCenterWindow({ state: () => game.state(),
      onState: (callback) => { game.on('state', callback); return () => { game.off('state', callback); }; },
      start: (tests, multi) => game.start(tests, multi), accept: () => game.accept(), decline: () => game.decline(),
      begin: () => game.begin(), cancel: () => game.cancel(),
      openStage: async () => null, input: async () => null, stopStage: async () => undefined,
      openWeb: async () => ({ ok: true }),
      inviteWeb: () => ({ ok: true }),
      title: () => 'Game center', onFocus: (value) => { suspended = value; } });
    const window = (): Window => harness.windows[0] as Window;
    const ready = () => { window().webContents.loading = false; window().emit('ready-to-show'); };
    const call = (channel: string, sender: unknown, ...args: unknown[]) => harness.handlers.get(channel)?.({ sender }, ...args);
    return { center, game, window, ready, call, suspended: () => suspended };
  }
  it('creates no window until opened and releases input suspension on blur', () => {
    const h = setup();
    try {
      expect(harness.windows).toHaveLength(0); expect(h.suspended()).toBe(false);
      h.center.open(); h.ready();
      expect(h.window().visible).toBe(true); expect(h.window().focused).toBe(true); expect(h.suspended()).toBe(true);
      h.window().emit('blur'); expect(h.suspended()).toBe(false);
    } finally { h.center.destroy(); }
  });
  it('restricts game IPC to its own window and drives real game state instead of accepting foreign actions', () => {
    const h = setup();
    try {
      h.center.open(); h.ready();
      expect(h.call(GAME_CH.get, {})).toBeNull();
      expect(h.call(GAME_CH.session, {})).toBeNull();
      expect(h.call(GAME_CH.sessionAction, {}, { type: 'move', round: 0 })).toBe(false);
      expect(h.call(GAME_CH.openWeb, {})).toEqual({ ok: false, error: 'invalid' });
      expect(h.call(GAME_CH.start, {}, ['aim'], false)).toEqual({ ok: false, error: 'invalid' });
      expect(h.game.state().phase).toBe('idle');
      expect(h.call(GAME_CH.start, h.window().webContents, gameSelection(['aim']), false)).toEqual({ ok: true });
      expect(h.game.state().phase).toBe('playing');
      h.game.submit({ test: 'aim', score: 85, metric: 300, accuracy: 1 });
      const state = h.call(GAME_CH.get, h.window().webContents) as GameState;
      expect(state.phase).toBe('results'); expect(state.results[state.self]).toHaveLength(1);
      expect(h.window().webContents.sent.length).toBeGreaterThan(0);
    } finally { h.center.destroy(); }
  });
  it('releases helper suspension and stops participation when the window closes or its renderer crashes', () => {
    for (const crash of [false, true]) {
      const h = setup();
      try {
        h.center.open(); h.ready(); h.game.start(gameSelection(['aim']), false);
        expect(h.suspended()).toBe(true);
        if (crash) h.window().webContents.emit('render-process-gone'); else h.window().destroy();
        expect(h.suspended()).toBe(false); expect(h.game.state().phase).toBe('idle');
        expect(h.window().destroyed).toBe(true);
      } finally { h.center.destroy(); harness.windows.length = 0; }
    }
  });
  it('blocks foreign navigation and removes IPC and subscriptions on shutdown', () => {
    const h = setup(); h.center.open(); h.ready();
    const foreign = { url: 'https://example.invalid/', preventDefault: vi.fn() };
    h.window().webContents.emit('will-navigate', foreign); expect(foreign.preventDefault).toHaveBeenCalledOnce();
    const own = { url: 'lolping://app/game/index.html', preventDefault: vi.fn() };
    h.window().webContents.emit('will-navigate', own); expect(own.preventDefault).not.toHaveBeenCalled();
    h.center.destroy(); expect(h.suspended()).toBe(false); expect(harness.handlers.size).toBe(0);
    expect(h.game.listenerCount('state')).toBe(0); h.center.open(); expect(harness.windows).toHaveLength(1);
  });
});
