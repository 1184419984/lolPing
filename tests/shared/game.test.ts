import { describe, expect, it } from 'vitest';
import {
  gameInvitation, gameTests, normalizeGameResult, rankGameParticipants, roomGamePeers, validateGamePacket,
} from '../../src/shared/game';
import { decodeMessage, encodeMessage, validateMessage, type GameMsg } from '../../src/shared/roomProtocol';
import type { RoomStateCore } from '../../src/shared/room';
const GAME_TESTS = ['reaction', 'aim', 'clicks', 'sequence'];

describe('game', () => {
  it('accepts bounded script stage identifiers and drops duplicates or unsafe identifiers', () => {
    expect(gameTests([...GAME_TESTS])).toEqual(GAME_TESTS);
    expect(gameTests(['newGame'])).toEqual(['newGame']);
    for (const raw of [[], null, {}, ['../unknown'], ['aim', 'aim'], Array(9).fill('aim')]) expect(gameTests(raw)).toBeNull();
  });
  it('validates every game packet and keeps encrypted packet sizes below the room cap', () => {
    const base = { peer: 'a'.repeat(16), seq: 1, ts: 1780000000000, t: 'game' as const, gameId: 'b'.repeat(16) };
    const message: GameMsg = { ...base, kind: 'begin', data: { tests: [...GAME_TESTS], seed: 0xffffffff,
      peers: Array.from({ length: 8 }, (_, i) => i.toString(16).repeat(16)) } };
    expect(decodeMessage(encodeMessage(message))).toEqual(message);
    expect(encodeMessage(message).length + 29).toBeLessThan(1200);
    for (const data of [{ tests: [] }, { tests: ['aim'], seed: -1, peers: ['a'.repeat(16)] },
      { tests: ['aim'], seed: 1, peers: ['a'.repeat(16), 'a'.repeat(16)] }, { tests: ['aim'], seed: 1, peers: [] }]) {
      expect(validateMessage({ ...message, data })).toBeNull();
    }
    expect(validateGamePacket({ gameId: '../bad', kind: 'join' })).toBeNull();
    expect(validateGamePacket({ gameId: base.gameId, kind: 'exec', data: 'code' })).toBeNull();
    expect(validateGamePacket({ gameId: base.gameId, kind: 'join', data: { secret: 'discard' } }))
      .toEqual({ gameId: base.gameId, kind: 'join', data: null });
  });
  it('bounds result fields and strips anything not part of a result', () => {
    const raw = { test: 'aim', metric: 400.1234, score: 87.124, accuracy: .9999, name: 'forged' };
    expect(normalizeGameResult(raw)).toEqual({ test: 'aim', metric: 400.12, score: 87.12, accuracy: 1 });
    for (const change of [{ score: NaN }, { score: 101 }, { metric: Infinity }, { accuracy: -1 }, { test: '../script' }]) {
      expect(normalizeGameResult({ ...raw, ...change })).toBeNull();
    }
  });
  it('ranks completed circuits ahead of partial results and breaks score ties deterministically', () => {
    const result = (score: number) => ({ test: 'aim' as const, score, metric: 300, accuracy: 1 });
    const ranked = rankGameParticipants([{ peer: 'c', name: 'C' }, { peer: 'b', name: 'B' }, { peer: 'a', name: 'A' }],
      { a: [result(60), { ...result(80), test: 'clicks' }], b: [result(70), { ...result(70), test: 'clicks' }], c: [result(100)] }, 2);
    expect(ranked.map((p) => p.peer)).toEqual(['a', 'b', 'c']); expect(ranked[0].score).toBe(70);
  });
  it('counts only reachable, enabled game-center peers', () => {
    const room: RoomStateCore = { phase: 'active', code: 'room', lan: 'ok', internet: 'off', lonely: false, clockSkew: false,
      members: [{ peer: 'a', name: 'A', self: false, muted: false, needsUpdate: false, noEmotes: false, path: 'lan', status: 'on', color: 0, game: 1 }] };
    expect(roomGamePeers(room)).toBe(1);
    expect(roomGamePeers({ ...room, members: [{ ...room.members[0], game: undefined }] })).toBe(0);
    expect(roomGamePeers({ ...room, members: [{ ...room.members[0], path: 'unreachable' }] })).toBe(0);
    expect(roomGamePeers({ ...room, members: [{ ...room.members[0], muted: true }] })).toBe(0);
  });
  it('allows room invitations before members are ready and reports each blocked member without hiding them', () => {
    const base = { peer: 'a'.repeat(16), name: 'A', self: false, muted: false, needsUpdate: false,
      noEmotes: false, path: 'lan' as const, status: 'on' as const, color: 0, game: 1 as const };
    const room: RoomStateCore = { phase: 'active', code: 'room', lan: 'ok', internet: 'off', lonely: false, clockSkew: false,
      members: [{ ...base, self: true }, { ...base, peer: 'b'.repeat(16) }] };
    expect(gameInvitation({ ...room, members: [] }, true)).toEqual({ error: null, members: [] });
    for (const [change, status] of [
      [{}, 'available'], [{ game: undefined }, 'needsUpdate'], [{ needsUpdate: true }, 'needsUpdate'],
      [{ muted: true }, 'muted'], [{ status: 'muted' }, 'muted'], [{ status: 'paused' }, 'paused'],
      [{ path: 'connecting' }, 'connecting'], [{ path: 'unreachable' }, 'unreachable'],
    ] as const) {
      expect(gameInvitation({ ...room, members: [{ ...base, ...change }] }, true).members[0].status).toBe(status);
    }
    expect(gameInvitation(room, true).members).toHaveLength(1);
    expect(gameInvitation(room, false).error).toBe('paused');
    expect(gameInvitation({ ...room, members: [{ ...base, self: true, status: 'muted' }] }, true).error).toBe('paused');
    expect(gameInvitation({ ...room, phase: 'joining' }, true).error).toBe('notInRoom');
    expect(gameInvitation({ ...room, phase: 'idle' }, true).error).toBe('notInRoom');
  });
  it('keeps reasoned invite replies backward compatible with ordinary declines', () => {
    const packet = { gameId: 'a'.repeat(16), kind: 'decline' };
    for (const reason of ['incompatible', 'busy']) {
      expect(validateGamePacket({ ...packet, data: { reason, script: 'discard' } })).toEqual({ ...packet, data: { reason } });
    }
    expect(validateGamePacket({ ...packet, data: { reason: 'invalid' } })).toEqual({ ...packet, data: null });
  });
});
