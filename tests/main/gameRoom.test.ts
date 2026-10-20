import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameManager } from '../../src/main/gameManager';
import { RoomManager } from '../../src/main/roomManager';
import { open, type RoomKeys } from '../../src/main/roomCrypto';
import { makeRoomCode } from '../../src/shared/roomCode';
import { decodeMessage } from '../../src/shared/roomProtocol';
import type { GamePacket } from '../../src/shared/game';
import { FakeTransport } from './fixtures/fakeTransport';
import { gameCatalog, gameSelection } from './fixtures/gameCatalog';
import { GameSession } from '../../src/main/gameSession';
import { ModuleVm } from '../../src/main/moduleVm';
import { tabletopContext, tabletopPayload } from './fixtures/tabletop';

afterEach(() => vi.useRealTimers());

describe('game room integration', () => {
  it('plays local board moves through encrypted LAN packets after explicit consent and repairs a missing event', async () => {
    vi.useFakeTimers({ now: 1780000000000 });
    const keys: RoomKeys = { msgKey: Buffer.alloc(32, 8), relayTopic: 'tabletop' };
    const code = makeRoomCode(new Uint8Array(9).fill(6));
    const transports = [new FakeTransport(), new FakeTransport()];
    const roomDeps = transports.map((transport, i) => ({ transports: [transport], now: Date.now,
      randomBytes: (n: number) => new Uint8Array(n).fill(i + 4), deriveKeys: async () => keys, appVersion: '0.5.1',
      profile: () => ({ name: `Player ${i}`, color: i, limit: 5 }), announceEmotes: () => [], gameCenter: i === 0,
      resolveTarget: () => ({ displayId: 1, width: 1000, height: 700 }) }));
    const rooms = roomDeps.map((deps) => new RoomManager(deps));
    const games = rooms.map((room, i) => new GameManager({ catalog: () => gameCatalog, room: () => room.state(),
      self: () => room.self, name: () => `Player ${i}`, lang: () => 'zh-CN', platform: 'win', enabled: () => true,
      id: () => 'f'.repeat(16), now: Date.now, send: (packet) => room.sendGame(packet) }));
    const sessions = games.map((game) => new GameSession({ payload: () => tabletopPayload,
      context: () => tabletopContext, send: (data) => game.sendSession(data), now: Date.now,
      failed: () => { throw new Error('Session failed'); }, runner: () => {
        let vm: ModuleVm | null = null;
        return { load: async () => { vm = await ModuleVm.create(tabletopPayload); },
          session: async (event, data, context, state) => {
            if (!vm) throw new Error('Unloaded'); return vm.session(event, data, context, state);
          }, stop: async () => { vm?.dispose(); vm = null; } };
      } }));
    for (let i = 0; i < rooms.length; i++) {
      rooms[i].on('game', (event: unknown) => { if (roomDeps[i].gameCenter) games[i].receive(event); });
      games[i].on('state', (state) => sessions[i].sync(state));
      games[i].on('sync', (peer, data) => sessions[i].receive(peer, data));
    }
    const cursor = [0, 0];
    const pump = async (dropEvents = false) => {
      for (let step = 0; step < 30; step++) {
        await Promise.all(sessions.map((s) => s.whenIdle()));
        const before = cursor[0] + cursor[1];
        for (let i = 0; i < 2; i++) while (cursor[i] < transports[i].sent.length) {
          const packet = transports[i].sent[cursor[i]++].packet;
          const plain = open(keys.msgKey, packet); const message = plain ? decodeMessage(plain) : null;
          if (dropEvents && message?.t === 'game' && message.kind === 'sync') continue;
          transports[1 - i].deliver(`peer${i}`, packet);
        }
        if (before === cursor[0] + cursor[1]) return;
      }
      throw new Error('Traffic did not settle');
    };
    try {
      await rooms[0].join(code); await rooms[1].join(code); await pump();
      await vi.advanceTimersByTimeAsync(3000); await pump();
      const entry = gameCatalog.find((g) => g.game === 'tictactoe');
      expect(games[0].state().roomPeers).toBe(0);
      expect(games[0].start(entry, true)).toEqual({ ok: true }); await pump();
      expect(games[0].state().invitation.members[0].status).toBe('needsUpdate');
      expect(games[1].state().phase).toBe('idle');
      expect(sessions[1].frame()).toBeNull();
      roomDeps[1].gameCenter = true; rooms[1].profileChanged(); await pump();
      await vi.advanceTimersByTimeAsync(3000); games[0].tick(); await pump();
      expect(games[1].state().phase).toBe('invited');
      expect(games[1].accept()).toEqual({ ok: true }); await pump();
      expect(games[0].state().invitation.members[0].status).toBe('joined');
      expect(games[0].begin()).toEqual({ ok: true }); await pump();
      expect(sessions[0].action({ type: 'move', round: 0, ply: 0, from: 0, to: 0, promotion: 'q' })).toBe(true);
      await pump(true);
      expect(sessions[1].frame()?.view.ply).toBe(0);
      for (let i = 0; i < 16; i++) {
        await vi.advanceTimersByTimeAsync(150); sessions.forEach((s) => s.tick()); await pump();
      }
      expect(sessions[1].frame()?.view.ply).toBe(1);
      sessions[1].action({ type: 'move', round: 0, ply: 1, from: 0, to: 4, promotion: 'q' }); await pump();
      expect(sessions[0].frame()?.view.cells[4]).toBe('O');
      const pings: unknown[] = []; rooms[1].on('remotePing', (event) => pings.push(event));
      rooms[0].sendPing('danger', { d: 1, x: .5, y: .5 }); await pump(); expect(pings).toHaveLength(1);
      games[0].cancel(); await pump(); expect(sessions[1].frame()).toBeNull();
    } finally { await Promise.all(sessions.map((s) => s.stop())); rooms.forEach((r) => r.quit()); }
  });
  it('carries consent, roster, results and cancellation through sealed LAN messages without changing legacy pings', async () => {
    vi.useFakeTimers({ now: 1780000000000 });
    const keys: RoomKeys = { msgKey: Buffer.alloc(32, 7), relayTopic: 'games' };
    const code = makeRoomCode(new Uint8Array(9).fill(5));
    const transports = [new FakeTransport(), new FakeTransport()];
    const rooms = transports.map((transport, index) => new RoomManager({ transports: [transport], now: Date.now,
      randomBytes: (n) => new Uint8Array(n).fill(index + 1), deriveKeys: async () => keys, appVersion: '0.5.1',
      profile: () => ({ name: `Player ${index}`, color: index, limit: 5 }), announceEmotes: () => [], gameCenter: true,
      resolveTarget: () => ({ displayId: 1, width: 1000, height: 700 }) }));
    let gameId = 0;
    const games = rooms.map((room, index) => new GameManager({ catalog: () => gameCatalog, room: () => room.state(), self: () => room.self,
      name: () => `Player ${index}`, lang: () => 'en', platform: 'win', enabled: () => true,
      id: () => (++gameId).toString(16).padStart(16, '0'), now: Date.now, send: (packet) => room.sendGame(packet) }));
    for (let i = 0; i < rooms.length; i++) rooms[i].on('game', (event: unknown) => games[i].receive(event));
    const cursor = [0, 0];
    const pump = (dropKind?: GamePacket['kind']) => {
      for (let round = 0; round < 20; round++) {
        const before = cursor[0] + cursor[1];
        for (let i = 0; i < transports.length; i++) while (cursor[i] < transports[i].sent.length) {
          const packet = transports[i].sent[cursor[i]++].packet;
          const plain = open(keys.msgKey, packet); const msg = plain ? decodeMessage(plain) : null;
          if (msg?.t === 'game' && msg.kind === dropKind) continue;
          transports[1 - i].deliver(`peer${i}`, packet);
        }
        if (before === cursor[0] + cursor[1]) return;
      }
      throw new Error('traffic did not settle');
    };
    try {
      await rooms[0].join(code); await rooms[1].join(code); pump(); await vi.advanceTimersByTimeAsync(3000); pump();
      expect(rooms[0].state().members.find((m) => !m.self)?.game).toBe(1);
      expect(games[0].start(gameSelection(['aim', 'clicks']), true)).toEqual({ ok: true }); pump();
      expect(games[1].state().phase).toBe('invited'); expect(games[1].state().results).toEqual({});
      expect(games[1].accept()).toEqual({ ok: true }); pump();
      expect(games[0].begin()).toEqual({ ok: true }); pump('begin');
      expect(games[1].state().phase).toBe('lobby');
      await vi.advanceTimersByTimeAsync(3000); games[0].tick(); games[1].tick(); pump();
      expect(games[1].state().phase).toBe('playing');
      for (const test of ['aim', 'clicks'] as const) {
        games[0].submit({ test, score: 90, metric: 200, accuracy: 1 });
        games[1].submit({ test, score: 70, metric: 400, accuracy: .9 }); pump();
      }
      expect(games[0].state().results[rooms[1].self]).toHaveLength(2);
      expect(games[1].state().results[rooms[0].self]).toHaveLength(2);
      const pings: unknown[] = []; rooms[1].on('remotePing', (event: unknown) => pings.push(event));
      rooms[0].sendPing('danger', { d: 1, x: .5, y: .5 }); pump(); expect(pings).toHaveLength(1);
      rooms[1].setStatusFlags({ paused: true, roomMuted: false });
      expect(rooms[1].sendGame({ gameId: 'e'.repeat(16), kind: 'join', data: null })).toEqual({ ok: false, error: 'paused' });
      rooms[1].setStatusFlags({ paused: false, roomMuted: false });
      games[0].cancel(); pump(); expect(games[1].state().phase).toBe('idle');
      await vi.advanceTimersByTimeAsync(16_000); pump();
      const webUrl = 'https://foony.com/zh/games/paintjob#r=kessfvk5';
      expect(games[0].start({ ...gameSelection([]), webUrl }, true)).toEqual({ ok: true }); pump();
      expect(games[1].state()).toMatchObject({ phase: 'invited', webUrl });
      expect(games[1].accept()).toEqual({ ok: true }); pump();
      expect(games[1].state()).toMatchObject({ phase: 'playing', webUrl, tests: [], results: {} });
      expect(games[0].state().participants).toHaveLength(2);
      games[0].cancel(); pump(); expect(games[1].state().phase).toBe('idle');
      expect(transports.map((transport) => transport.stops)).toEqual([0, 0]);
    } finally { for (const room of rooms) room.quit(); }
  });
});
