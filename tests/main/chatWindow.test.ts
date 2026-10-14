import type { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_CH } from '../../src/shared/chatChannels';
import type { ChatSendResult } from '../../src/shared/chat';
import type { ChatState } from '../../src/shared/ipc';

type Rect = { x: number; y: number; width: number; height: number };
type OpenHandler = (details: { url: string }) => { action: string };
type FakeContents = EventEmitter & {
  loading: boolean;
  destroyed: boolean;
  openHandler: OpenHandler | null;
  sent: Array<[string, unknown]>;
};
type FakeWindow = EventEmitter & {
  webContents: FakeContents;
  bounds: Rect;
  visible: boolean;
  focused: boolean;
  focusable: boolean;
  clickThrough: boolean;
  destroyed: boolean;
  title: string;
  workspaces: { on: boolean; options: unknown } | null;
  actions: string[];
  destroy(): void;
};

const h = vi.hoisted(() => ({
  windows: [] as unknown[],
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  shortcuts: new Map<string, () => void>(),
  registered: [] as string[],
  unregistered: [] as string[],
  area: { x: 0, y: 0, width: 1920, height: 1040 } as Rect,
  registrationWorks: true,
  registrationThrows: false,
  isMac: false,
  loadError: null as Error | null,
}));

vi.mock('electron', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  class FakeContents extends Emitter {
    loading = true;
    destroyed = false;
    openHandler: OpenHandler | null = null;
    sent: Array<[string, unknown]> = [];
    isLoading(): boolean { return this.loading; }
    isDestroyed(): boolean { return this.destroyed; }
    setWindowOpenHandler(handler: OpenHandler): void { this.openHandler = handler; }
    send(channel: string, payload: unknown): void { this.sent.push([channel, payload]); }
  }
  class FakeWindow extends Emitter {
    webContents = new FakeContents();
    bounds: Rect;
    visible = false;
    focused = false;
    focusable: boolean;
    clickThrough = false;
    destroyed = false;
    title: string;
    workspaces: { on: boolean; options: unknown } | null = null;
    actions: string[] = [];
    constructor(options: Rect & { focusable: boolean; title: string }) {
      super();
      this.bounds = options;
      this.focusable = options.focusable;
      this.title = options.title;
      h.windows.push(this);
    }
    isDestroyed(): boolean { return this.destroyed; }
    setBounds(bounds: Rect): void { this.bounds = bounds; }
    setTitle(title: string): void { this.title = title; }
    setAlwaysOnTop(): void {}
    setVisibleOnAllWorkspaces(on: boolean, options: unknown): void { this.workspaces = { on, options }; }
    setIgnoreMouseEvents(on: boolean): void {
      this.clickThrough = on;
      this.actions.push(`mouse:${on}`);
    }
    setFocusable(on: boolean): void {
      this.focusable = on;
      this.actions.push(`focusable:${on}`);
    }
    show(): void {
      this.visible = true;
      this.actions.push('show');
    }
    showInactive(): void {
      this.visible = true;
      this.actions.push('showInactive');
    }
    focus(): void {
      this.focused = true;
      this.actions.push('focus');
    }
    hide(): void {
      this.visible = false;
      this.focused = false;
      this.actions.push('hide');
    }
    destroy(): void {
      if (this.destroyed) return;
      this.destroyed = this.webContents.destroyed = true;
      this.visible = this.focused = false;
      this.emit('closed');
    }
  }
  const screen = Object.assign(new Emitter(), { getPrimaryDisplay: () => ({ workArea: h.area }) });
  return {
    BrowserWindow: FakeWindow,
    screen,
    ipcMain: {
      handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) =>
        h.handlers.set(channel, handler),
      removeHandler: (channel: string) => h.handlers.delete(channel),
    },
    globalShortcut: {
      register: (shortcut: string, callback: () => void): boolean => {
        h.registered.push(shortcut);
        if (h.registrationThrows) throw new Error('shortcut unavailable');
        if (!h.registrationWorks) return false;
        h.shortcuts.set(shortcut, callback);
        return true;
      },
      unregister: (shortcut: string): void => {
        h.unregistered.push(shortcut);
        h.shortcuts.delete(shortcut);
      },
    },
  };
});

vi.mock('../../src/main/paths', () => ({
  get IS_MAC() { return h.isMac; },
  loadPage: () => h.loadError ? Promise.reject(h.loadError) : Promise.resolve(),
  pageUrl: () => 'lolping://app/chat/index.html',
  preloadPath: () => 'chat-preload.js',
}));

type Manager = InstanceType<typeof import('../../src/main/chatWindow').ChatWindow>;
let chat: Manager;
let state: Omit<ChatState, 'composing' | 'shortcutAvailable'>;
let shortcutAllowed: boolean;
let send: ReturnType<typeof vi.fn<(text: string) => ChatSendResult>>;
let onComposing: ReturnType<typeof vi.fn<(on: boolean) => void>>;
let fakeScreen: EventEmitter;

function windowAt(index = 0): FakeWindow {
  const win = h.windows[index];
  if (!win) throw new Error(`window ${index} was not created`);
  return win as FakeWindow;
}

function ready(win = windowAt()): void {
  win.webContents.loading = false;
  win.emit('ready-to-show');
}

function invoke(channel: string, sender: unknown, ...args: unknown[]): unknown {
  const handler = h.handlers.get(channel);
  if (!handler) throw new Error(`IPC handler ${channel} was not registered`);
  return handler({ sender }, ...args);
}

function triggerShortcut(): void {
  const callback = h.shortcuts.get('Control+Alt+Enter');
  if (!callback) throw new Error('chat shortcut was not registered');
  callback();
}

beforeEach(async () => {
  vi.useFakeTimers();
  h.windows.length = h.registered.length = h.unregistered.length = 0;
  h.handlers.clear();
  h.shortcuts.clear();
  h.area = { x: 0, y: 0, width: 1920, height: 1040 };
  h.registrationWorks = true;
  h.registrationThrows = h.isMac = false;
  h.loadError = null;
  shortcutAllowed = true;
  state = { messages: [], roomCode: 'PING-7KQ4M-2HXTR', lang: 'en', platform: 'win', enabled: true };
  send = vi.fn((): ChatSendResult => ({ ok: true }));
  onComposing = vi.fn();
  vi.resetModules();
  const { screen } = await import('electron');
  fakeScreen = screen as unknown as EventEmitter;
  fakeScreen.removeAllListeners();
  const { ChatWindow } = await import('../../src/main/chatWindow');
  chat = new ChatWindow({ state: () => state, send, onComposing, shortcutAllowed: () => shortcutAllowed });
});

afterEach(() => {
  chat.destroy();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ChatWindow', () => {
  it('shows a received message passively without focus or mouse capture, then hides it', () => {
    chat.notify();
    const win = windowAt();
    expect(win.visible).toBe(false);
    ready(win);
    expect(win.visible).toBe(true);
    expect(win.focused).toBe(false);
    expect(win.focusable).toBe(false);
    expect(win.clickThrough).toBe(true);
    expect(win.actions).not.toContain('focus');
    expect(onComposing).not.toHaveBeenCalled();
    vi.advanceTimersByTime(9999);
    expect(win.visible).toBe(true);
    vi.advanceTimersByTime(1);
    expect(win.visible).toBe(false);
  });

  it('extends the passive display when another message arrives without adding timers', () => {
    chat.notify();
    ready();
    vi.advanceTimersByTime(9000);
    chat.notify();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(9000);
    expect(windowAt().visible).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(windowAt().visible).toBe(false);
    expect(windowAt().focused).toBe(false);
  });

  it('takes focus only for input, then hides before restoring click-through mode', () => {
    chat.open();
    const win = windowAt();
    expect(onComposing.mock.calls).toEqual([[true]]);
    expect(win.visible).toBe(false);
    ready(win);
    expect(win.visible && win.focused && win.focusable).toBe(true);
    expect(win.clickThrough).toBe(false);
    const beforeClose = win.actions.length;
    chat.closeInput();
    expect(onComposing.mock.calls).toEqual([[true], [false]]);
    expect(win.actions.slice(beforeClose)).toEqual(['hide', 'mouse:true', 'focusable:false']);
    expect(win.visible || win.focused || win.focusable).toBe(false);
    expect(win.clickThrough).toBe(true);
    chat.closeInput();
    expect(onComposing).toHaveBeenCalledTimes(2);
  });

  it('keeps recent messages passive after input closes without stealing focus again', () => {
    chat.notify();
    ready();
    chat.open();
    chat.closeInput();
    const win = windowAt();
    expect(win.visible).toBe(true);
    expect(win.focused || win.focusable).toBe(false);
    expect(win.clickThrough).toBe(true);
    expect(win.actions.slice(-4)).toEqual(['hide', 'mouse:true', 'focusable:false', 'showInactive']);
    vi.advanceTimersByTime(10_000);
    expect(win.visible).toBe(false);
  });

  it('does not hide an active composer when the passive display expires', () => {
    chat.notify();
    ready();
    chat.open();
    vi.advanceTimersByTime(10_000);
    expect(windowAt().visible && windowAt().focused).toBe(true);
    expect(chat.state().composing).toBe(true);
    chat.closeInput();
    expect(windowAt().visible).toBe(false);
  });

  it('releases input suspension on blur and renderer crash and can open a replacement window', () => {
    chat.open();
    ready();
    const first = windowAt();
    first.emit('blur');
    expect(chat.state().composing).toBe(false);
    expect(first.clickThrough).toBe(true);
    chat.open();
    first.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    expect(first.destroyed).toBe(true);
    expect(chat.state().composing).toBe(false);
    expect(onComposing.mock.calls).toEqual([[true], [false], [true], [false]]);
    chat.open();
    expect(h.windows).toHaveLength(2);
    ready(windowAt(1));
    expect(windowAt(1).focused).toBe(true);
  });

  it('releases input suspension when the native window disappears while composing', () => {
    chat.open();
    ready();
    windowAt().destroy();
    expect(onComposing.mock.calls).toEqual([[true], [false]]);
    expect(chat.state().composing).toBe(false);
  });

  it('unregisters the shortcut and hides input on pause or leave', () => {
    for (const change of [{ enabled: false }, { roomCode: null }]) {
      state = { ...state, enabled: true, roomCode: 'PING-7KQ4M-2HXTR' };
      chat.refresh();
      chat.open();
      if (windowAt().webContents.loading) ready();
      chat.notify();
      state = { ...state, ...change };
      chat.refresh();
      expect(chat.state().composing).toBe(false);
      expect(windowAt().visible).toBe(false);
      expect(windowAt().clickThrough).toBe(true);
      expect(h.shortcuts.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(h.unregistered.at(-1)).toBe('Control+Alt+Enter');
    }
    expect(onComposing.mock.calls).toEqual([[true], [false], [true], [false]]);
  });

  it('creates no window or shortcut when disabled or outside a room', () => {
    for (const inactive of [{ ...state, enabled: false }, { ...state, roomCode: null }]) {
      state = inactive;
      chat.refresh();
      chat.open();
      chat.notify();
    }
    expect(h.windows).toHaveLength(0);
    expect(h.registered).toEqual([]);
    expect(onComposing).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('registers once and toggles input with the room chat shortcut', () => {
    chat.refresh();
    chat.refresh();
    expect(h.registered).toEqual(['Control+Alt+Enter']);
    expect(h.windows).toHaveLength(0);
    triggerShortcut();
    ready();
    expect(chat.state().composing).toBe(true);
    triggerShortcut();
    expect(chat.state().composing).toBe(false);
    expect(windowAt().visible).toBe(false);
  });

  it('keeps the settings and tray action available when the shortcut is taken or reserved', () => {
    for (const failure of ['taken', 'throws', 'reserved']) {
      h.registrationWorks = failure !== 'taken';
      h.registrationThrows = failure === 'throws';
      shortcutAllowed = failure !== 'reserved';
      chat.refresh();
      expect(chat.state().shortcutAvailable).toBe(false);
      chat.open();
      if (windowAt().webContents.loading) ready();
      expect(windowAt().focused).toBe(true);
      chat.closeInput();
    }
  });

  it('rejects IPC from other windows and sends only strings from its active composer', () => {
    chat.open();
    ready();
    const win = windowAt();
    expect(invoke(CHAT_CH.get, {})).toBeNull();
    expect(invoke(CHAT_CH.send, {}, 'forged')).toEqual({ ok: false, error: 'notInRoom' });
    invoke(CHAT_CH.close, {});
    expect(chat.state().composing).toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect(invoke(CHAT_CH.get, win.webContents)).toMatchObject({ composing: true, roomCode: state.roomCode });
    expect(invoke(CHAT_CH.send, win.webContents, { text: 'wrong type' })).toEqual({ ok: false, error: 'empty' });
    expect(send).not.toHaveBeenCalled();
    send.mockReturnValueOnce({ ok: false, error: 'rateLimited' });
    expect(invoke(CHAT_CH.send, win.webContents, 'hello')).toEqual({ ok: false, error: 'rateLimited' });
    expect(send.mock.calls).toEqual([['hello']]);
    invoke(CHAT_CH.close, win.webContents);
    expect(chat.state().composing).toBe(false);
    expect(invoke(CHAT_CH.send, win.webContents, 'hidden')).toEqual({ ok: false, error: 'notInRoom' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('places the pane inside the primary work area and resizes it on display changes', () => {
    chat.notify();
    ready();
    const win = windowAt();
    expect(win.bounds).toEqual({ x: 12, y: 708, width: 440, height: 320 });
    h.area = { x: -1280, y: 40, width: 320, height: 200 };
    fakeScreen.emit('display-metrics-changed');
    expect(win.bounds).toEqual({ x: -1268, y: 52, width: 296, height: 176 });
    h.area = { x: 1920, y: -900, width: 1600, height: 900 };
    fakeScreen.emit('display-removed');
    expect(win.bounds).toEqual({ x: 1932, y: -332, width: 440, height: 320 });
    expect(h.windows).toHaveLength(1);
    expect(win.focused).toBe(false);
  });

  it('fits its native bounds to the visible HUD while retaining the bottom anchor', () => {
    chat.open();
    ready();
    const win = windowAt();
    for (const raw of [null, '60', NaN, Infinity, -Infinity]) invoke(CHAT_CH.resize, win.webContents, raw);
    invoke(CHAT_CH.resize, {}, 60);
    expect(win.bounds.height).toBe(320);
    invoke(CHAT_CH.resize, win.webContents, 65.4);
    expect(win.bounds).toEqual({ x: 12, y: 962, width: 440, height: 66 });
    invoke(CHAT_CH.resize, win.webContents, -100);
    expect(win.bounds).toEqual({ x: 12, y: 994, width: 440, height: 34 });
    invoke(CHAT_CH.resize, win.webContents, 99999);
    expect(win.bounds).toEqual({ x: 12, y: 708, width: 440, height: 320 });
    expect(chat.state().composing).toBe(true);
  });

  it('keeps macOS chat visible on all workspaces and fullscreen spaces', () => {
    h.isMac = true;
    state.platform = 'mac';
    chat.notify();
    expect(windowAt().workspaces).toEqual({ on: true, options: { visibleOnFullScreen: true } });
  });

  it('blocks foreign pages, schemes and windows while allowing its own page to reload', () => {
    chat.open();
    const contents = windowAt().webContents;
    for (const url of [
      'https://example.com/', 'file:///C:/x.html', 'lolping://app/settings/index.html',
      'lolping://other/chat/index.html', 'lolping://app/chat/other.html', 'javascript:alert(1)', 'not a url',
    ]) {
      const event = { url, preventDefault: vi.fn() };
      contents.emit('will-navigate', event);
      expect(event.preventDefault, url).toHaveBeenCalledOnce();
    }
    for (const url of ['lolping://app/chat/index.html', 'lolping://app/chat/index.html?x=1#history']) {
      const event = { url, preventDefault: vi.fn() };
      contents.emit('will-navigate', event);
      expect(event.preventDefault, url).not.toHaveBeenCalled();
    }
    expect(contents.openHandler?.({ url: 'lolping://app/chat/index.html' })).toEqual({ action: 'deny' });
  });

  it('clears recent display and closes input when a room session resets', () => {
    chat.refresh();
    chat.notify();
    ready();
    chat.open();
    chat.reset();
    expect(chat.state().composing).toBe(false);
    expect(windowAt().visible).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(onComposing.mock.calls).toEqual([[true], [false]]);
    expect(chat.state().shortcutAvailable).toBe(true);
  });

  it('releases input and destroys the window when its page fails to load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    h.loadError = new Error('load failed');
    chat.open();
    await Promise.resolve();
    expect(windowAt().destroyed).toBe(true);
    expect(chat.state().composing).toBe(false);
    expect(onComposing.mock.calls).toEqual([[true], [false]]);
    expect(warn).toHaveBeenCalledWith('[chat]', h.loadError);
  });

  it('cleans up timers, shortcut, IPC and display listeners on shutdown and stays destroyed', () => {
    chat.refresh();
    chat.notify();
    ready();
    chat.open();
    const win = windowAt();
    chat.destroy();
    expect(win.destroyed).toBe(true);
    expect(chat.state().composing).toBe(false);
    expect(onComposing.mock.calls).toEqual([[true], [false]]);
    expect(h.shortcuts.size).toBe(0);
    expect(h.handlers.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
      expect(fakeScreen.listenerCount(event)).toBe(0);
    }
    const actions = [...win.actions];
    chat.destroy();
    chat.refresh();
    chat.notify();
    chat.open();
    win.emit('ready-to-show');
    vi.advanceTimersByTime(10_000);
    expect(win.actions).toEqual(actions);
    expect(h.windows).toHaveLength(1);
    expect(h.unregistered).toEqual(['Control+Alt+Enter']);
  });
});
