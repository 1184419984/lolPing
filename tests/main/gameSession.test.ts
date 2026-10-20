import { describe, expect, it } from 'vitest';
import { GameSession } from '../../src/main/gameSession';
import { ModuleVm } from '../../src/main/moduleVm';
import { validateGamePacket, type GameState } from '../../src/shared/game';
import { sessionWire, type SessionWire } from '../../src/shared/gameSession';
import { tabletopContext, tabletopPayload } from './fixtures/tabletop';

describe('GameSession', () => {
  const peers = ['a'.repeat(16), 'b'.repeat(16), 'c'.repeat(16)];
  const id = 'e'.repeat(16);
  function game(self: string, name = 'tictactoe'): GameState {
    const definition = tabletopPayload.manifest.games?.find((g) => g.id === name);
    if (!definition) throw new Error('Missing definition');
    return { webUrl: null, catalog: [], selection: { module: 'tabletop', game: name, digest: 'f'.repeat(64), definition, assets: {} },
      notice: null, lang: 'zh-CN', platform: 'win', roomActive: true, roomPeers: 2,
      invitation: { error: null, members: [] }, self, phase: 'playing',
      gameId: id, organizer: peers[0], organizerName: 'Host', tests: ['match'], currentTest: 'match', seed: 42,
      participants: peers.map((peer) => ({ peer, name: peer, ready: true })), results: {} };
  }
  async function setup(name = 'tictactoe') {
    let now = 1000000;
    const sent: { from: string; data: SessionWire }[] = [];
    const failed: unknown[] = [];
    const sessions = peers.map((peer) => new GameSession({ payload: () => tabletopPayload, context: () => tabletopContext,
      now: () => now, failed: (ref) => failed.push(ref), send: (data) => { sent.push({ from: peer, data }); return true; },
      runner: () => {
        let vm: ModuleVm | null = null;
        return { load: async () => { vm = await ModuleVm.create(tabletopPayload); },
          session: async (event, data, context, state) => {
            if (!vm) throw new Error('Unloaded'); return vm.session(event, data, context, state);
          }, stop: async () => { vm?.dispose(); vm = null; } };
      } }));
    sessions.forEach((session, i) => session.sync(game(peers[i], name)));
    const idle = () => Promise.all(sessions.map((s) => s.whenIdle()));
    await idle();
    const pump = async (drop?: (from: string, data: SessionWire, receiver: number) => boolean) => {
      for (let step = 0; step < 100; step++) {
        await idle();
        if (!sent.length) return;
        const pending = sent.splice(0);
        for (const message of pending) for (let i = 0; i < sessions.length; i++) {
          if (peers[i] === message.from || drop?.(message.from, message.data, i)) continue;
          const packet = validateGamePacket({ gameId: id, kind: 'sync', data: message.data });
          expect(packet).not.toBeNull();
          expect(new TextEncoder().encode(JSON.stringify({ t: 'game', peer: message.from,
            seq: 1000, at: now, v: 1, ...packet })).length + 29).toBeLessThan(1200);
          sessions[i].receive(message.from, message.data);
        }
      }
      throw new Error('Traffic did not settle');
    };
    const tick = async () => { now += 150; sessions.forEach((s) => s.tick()); await pump(); };
    return { sessions, sent, failed, idle, pump, tick, setNow: (value: number) => { now = value; },
      stop: () => Promise.all(sessions.map((s) => s.stop())) };
  }
  it('orders moves, ignores duplicate delivery and repairs a lost event by polling', async () => {
    const h = await setup();
    try {
      expect(h.sessions[0].action({ type: 'move', round: 0, ply: 0, from: 0, to: 0, promotion: 'q' })).toBe(true);
      await h.pump((_from, data, receiver) => data.op === 'event' && receiver === 1);
      expect(h.sessions[0].frame()?.view.ply).toBe(1);
      expect(h.sessions[1].frame()?.view.ply).toBe(0);
      for (let i = 0; i < 20; i++) await h.tick();
      expect(h.sessions[1].frame()?.view.ply).toBe(1);
      h.sessions[1].action({ type: 'move', round: 0, ply: 1, from: 0, to: 4, promotion: 'q' });
      const request = h.sent[0]; await h.pump();
      h.sessions[0].receive(peers[1], request.data); await h.pump();
      expect(h.sessions.map((s) => s.frame()?.view.cells)).toEqual(Array(3).fill(['X', '', '', '', 'O', '', '', '', '']));
      expect(h.sessions[1].frame()?.pending).toBe(false);
      expect(h.failed).toEqual([]);
    } finally { await h.stop(); }
  });
  it('replays out-of-order frames in sequence and refuses non-organizer events', async () => {
    const h = await setup();
    try {
      const first: SessionWire = { op: 'event', event: { seq: 1, id: 1, actor: peers[0], now: 1000000,
        action: { type: 'move', round: 0, ply: 0, from: 0, to: 0, promotion: 'q' } } };
      const second: SessionWire = { op: 'event', event: { seq: 2, id: 1, actor: peers[1], now: 1000010,
        action: { type: 'move', round: 0, ply: 1, from: 0, to: 4, promotion: 'q' } } };
      h.sessions[2].receive(peers[1], first); await h.idle(); expect(h.sessions[2].frame()?.revision).toBe(0);
      h.sessions[2].receive(peers[0], second); await h.idle(); expect(h.sessions[2].frame()?.revision).toBe(0);
      h.sessions[2].receive(peers[0], first); await h.idle(); expect(h.sessions[2].frame()?.view.ply).toBe(2);
      expect(h.failed).toEqual([]);
    } finally { await h.stop(); }
  });
  it('restricts drawing to the artist, serializes queued strokes and does not give guessers a word in their view', async () => {
    const h = await setup('paintjob');
    try {
      await h.pump();
      h.sessions[0].action({ type: 'choose', round: 0, index: 1 }); await h.pump();
      const word = h.sessions[0].frame()?.view.word;
      expect(word).toBeTruthy(); expect(h.sessions[1].frame()?.view.word).toBe('');
      h.sessions[1].action({ type: 'stroke', round: 0, color: 1, width: 4, points: [0, 0, 100, 100] }); await h.pump();
      expect(h.sessions[0].frame()?.view.strokes).toHaveLength(0);
      h.sessions[0].action({ type: 'stroke', round: 0, color: 1, width: 4, points: [0, 0, 100, 100] }); await h.pump();
      expect(h.sessions[1].frame()?.view.strokes).toHaveLength(1);
      h.sessions[1].action({ type: 'guess', round: 0, text: word }); await h.pump();
      expect(h.sessions[0].frame()?.view.scores[1].score).toBeGreaterThan(0);
      expect(h.failed).toEqual([]);
    } finally { await h.stop(); }
  });
  it('drops pending generations on cancellation and ends a board when a player leaves', async () => {
    const h = await setup();
    try {
      const updated = game(peers[0]); updated.participants[1].ready = false;
      h.sessions[0].sync(updated); await h.pump();
      expect(h.sessions[1].frame()?.view).toMatchObject({ status: 'won', winner: peers[0] });
      h.sessions[0].sync({ ...updated, phase: 'idle' }); await h.idle();
      expect(h.sessions[0].frame()).toBeNull();
      expect(h.sessions[0].action({ type: 'rematch', round: 0 })).toBe(false);
    } finally { await h.stop(); }
  });
  it('rejects malformed, privileged and unbounded wire actions before they enter the worker', () => {
    expect(sessionWire({ op: 'request', id: 1, action: { type: 'clock', round: 0 } })).toBeNull();
    expect(sessionWire({ op: 'request', id: 1, action: { type: 'depart', round: 0, peer: peers[0] } })).toBeNull();
    expect(sessionWire({ op: 'request', id: 1, action: { type: 'stroke', round: 0, color: 0, width: 4, points: Array(26).fill(1) } })).toBeNull();
    expect(sessionWire({ op: 'request', id: 1, action: { type: 'guess', round: 0, text: '\u202ehello' } })).toBeNull();
  });
});
