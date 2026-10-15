import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_PACKET, open, seal, type RoomKeys } from '../../src/main/roomCrypto';
import { RoomManager } from '../../src/main/roomManager';
import { pushRoomUpdate } from '../../src/main/roomUpdate';
import { Updater, type UpdateBackend, type UpdateInfo } from '../../src/main/updater';
import { UPDATE_REPOSITORY } from '../../src/shared/project';
import type { RoomUpdateNotice } from '../../src/shared/room';
import { makeRoomCode } from '../../src/shared/roomCode';
import { decodeMessage, encodeMessage, type RoomMessage } from '../../src/shared/roomProtocol';
import { FakeTransport } from './fixtures/fakeTransport';

const KEYS: RoomKeys = { msgKey: Buffer.alloc(32, 1), relayTopic: 'room' };
const CODE = makeRoomCode(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]));
const rooms: RoomManager[] = [];
let lan: FakeTransport;
let room: RoomManager;
let seq: number;

function create(transport: FakeTransport, version = '0.5.1', seed = 0xab): RoomManager {
  let nextSeed = seed;
  const r = new RoomManager({
    transports: [transport], now: Date.now, randomBytes: (n) => new Uint8Array(n).fill(nextSeed++),
    deriveKeys: async () => KEYS, appVersion: version,
    profile: () => ({ name: 'Me', color: 1, limit: 5 }),
    resolveTarget: () => ({ displayId: 1, width: 1920, height: 1080 }), announceEmotes: () => [],
  });
  rooms.push(r);
  return r;
}

function deliver(body: Record<string, unknown>, peer = '1111111111111111'): Uint8Array {
  const message = { peer, seq: ++seq, ts: Date.now(), ...body } as RoomMessage;
  const packet = seal(KEYS.msgKey, encodeMessage(message));
  lan.deliver(`lan:${peer}`, packet);
  return packet;
}

function presence(peer = '1111111111111111'): void {
  deliver({ t: 'presence', proto: 1, app: '0.5.1', name: 'Alex', color: 3, status: 'on', em: [] }, peer);
}

beforeEach(() => {
  vi.useFakeTimers({ now: 1_780_000_000_000 });
  lan = new FakeTransport();
  room = create(lan);
  seq = 0;
});

afterEach(() => {
  for (const r of rooms.splice(0)) r.quit();
  vi.useRealTimers();
});

describe('room updates', () => {
  function updater(check: UpdateBackend['check']): Updater {
    return new Updater({
      backend: { check, download: async () => { throw new Error('must not download'); }, install: async () => { throw new Error('must not install'); } },
      now: Date.now, autoCheck: () => false, notifiedVersion: () => null,
      setNotifiedVersion: () => undefined, errorText: (_kind, reason) => reason,
    });
  }

  function updateMessages(): RoomMessage[] {
    return lan.sent.flatMap(({ packet }) => {
      const plain = open(KEYS.msgKey, packet);
      const message = plain && decodeMessage(plain);
      return message?.t === 'update' ? [message] : [];
    });
  }

  it('checks the release feed before pushing without downloading even when automatic checks are off', async () => {
    await room.join(CODE);
    presence();
    await vi.advanceTimersByTimeAsync(3000);
    let checked = false;
    const u = updater(async () => { checked = true; return { version: '0.7.0', notesUrl: 'https://github.com/releases' }; });
    expect(await pushRoomUpdate({ room, updater: u, currentVersion: '0.5.1', isQuitting: () => false })).toEqual({ ok: true, version: '0.7.0' });
    expect(checked).toBe(true);
    expect(u.state.phase).toBe('available');
    expect(updateMessages()).toHaveLength(1);
    expect(updateMessages()[0]).toMatchObject({ version: '0.7.0', repository: UPDATE_REPOSITORY });
  });

  it('announces the installed version after a successful check finds no newer release', async () => {
    await room.join(CODE);
    presence();
    await vi.advanceTimersByTimeAsync(3000);
    const u = updater(async () => null);
    expect(await pushRoomUpdate({ room, updater: u, currentVersion: '0.5.1', isQuitting: () => false })).toEqual({ ok: true, version: '0.5.1' });
    expect(updateMessages()[0]).toMatchObject({ version: '0.5.1' });
  });

  it('does not push a guessed version after a failed check or from a development build', async () => {
    await room.join(CODE);
    presence();
    await vi.advanceTimersByTimeAsync(3000);
    const u = updater(async () => { throw new Error('offline'); });
    for (const candidate of [u, null]) {
      expect(await pushRoomUpdate({ room, updater: candidate, currentVersion: '0.5.1', isQuitting: () => false }))
        .toEqual({ ok: false, error: 'unavailable' });
    }
    expect(updateMessages()).toEqual([]);
  });

  it('drops a push if the user leaves and rejoins the same room while checking', async () => {
    await room.join(CODE);
    presence();
    await vi.advanceTimersByTimeAsync(3000);
    let finish: (info: UpdateInfo | null) => void = () => { throw new Error('check has not started'); };
    const u = updater(() => new Promise((resolve) => { finish = resolve; }));
    const pending = pushRoomUpdate({ room, updater: u, currentVersion: '0.5.1', isQuitting: () => false });
    room.leave();
    await room.join(CODE);
    finish({ version: '0.7.0', notesUrl: 'https://github.com/releases' });
    expect(await pending).toEqual({ ok: false, error: 'notInRoom' });
    expect(updateMessages()).toEqual([]);
  });

  it('drops a checked push while the application is quitting', async () => {
    await room.join(CODE);
    presence();
    await vi.advanceTimersByTimeAsync(3000);
    const u = updater(async () => ({ version: '0.7.0', notesUrl: 'https://github.com/releases' }));
    expect(await pushRoomUpdate({ room, updater: u, currentVersion: '0.5.1', isQuitting: () => true }))
      .toEqual({ ok: false, error: 'notInRoom' });
    expect(updateMessages()).toEqual([]);
  });

  it('exchanges only an encrypted version notice between two rooms', async () => {
    const otherLan = new FakeTransport();
    const other = create(otherLan, '0.6.0', 0x22);
    await room.join(CODE);
    await other.join(CODE);
    for (const sent of lan.sent.splice(0)) otherLan.deliver('lan:me', sent.packet);
    for (const sent of otherLan.sent.splice(0)) lan.deliver('lan:friend', sent.packet);
    await vi.advanceTimersByTimeAsync(3000);
    otherLan.sent = [];
    expect(other.sendUpdate('0.6.0')).toEqual({ ok: true, version: '0.6.0' });
    expect(otherLan.sent).toHaveLength(1);
    const packet = otherLan.sent[0].packet;
    expect(packet.length).toBeLessThanOrEqual(MAX_PACKET);
    const plain = open(KEYS.msgKey, packet);
    expect(plain).not.toBeNull();
    expect(plain && decodeMessage(plain)).toMatchObject({ t: 'update', version: '0.6.0', repository: UPDATE_REPOSITORY });
    lan.deliver('lan:friend', packet);
    expect(room.state().updateNotice).toEqual({ peer: other.self, name: 'Me', version: '0.6.0' });
  });

  it('rejects a sender that is not a known member and ignores other update sources', async () => {
    await room.join(CODE);
    deliver({ t: 'update', version: '0.6.0', repository: UPDATE_REPOSITORY });
    expect(room.state().updateNotice).toBeUndefined();
    presence();
    deliver({ t: 'update', version: '0.6.0', repository: 'attacker/lolPing' });
    expect(room.state().updateNotice).toBeUndefined();
    deliver({ t: 'update', version: '0.5.1', repository: UPDATE_REPOSITORY });
    expect(room.state().updateNotice).toBeUndefined();
  });

  it('uses the known member name and does not retain code or download URLs', async () => {
    await room.join(CODE);
    presence();
    deliver({ t: 'update', version: '0.6.0', repository: UPDATE_REPOSITORY,
      name: 'Impostor', url: 'https://attacker.invalid/update.exe', code: 'process.exit()' });
    expect(room.state().updateNotice).toEqual({ peer: '1111111111111111', name: 'Alex', version: '0.6.0' });
  });

  it('drops replayed packets and caps all members together to one notice per minute', async () => {
    await room.join(CODE);
    presence();
    const notices: RoomUpdateNotice[] = [];
    room.on('updateNotice', (n: RoomUpdateNotice) => notices.push(n));
    const packet = deliver({ t: 'update', version: '0.6.0', repository: UPDATE_REPOSITORY });
    lan.deliver('lan:1111111111111111', packet);
    presence('2222222222222222');
    deliver({ t: 'update', version: '0.7.0', repository: UPDATE_REPOSITORY }, '2222222222222222');
    expect(notices).toHaveLength(1);
    expect(room.state().updateNotice?.version).toBe('0.6.0');
    await vi.advanceTimersByTimeAsync(60_000);
    presence();
    deliver({ t: 'update', version: '0.7.0', repository: UPDATE_REPOSITORY });
    expect(notices).toHaveLength(2);
  });

  it('honors pause, room mute and individual mute', async () => {
    await room.join(CODE);
    presence();
    for (const flags of [{ paused: true, roomMuted: false }, { paused: false, roomMuted: true }]) {
      room.setStatusFlags(flags);
      deliver({ t: 'update', version: '0.6.0', repository: UPDATE_REPOSITORY });
      expect(room.state().updateNotice).toBeUndefined();
    }
    room.setStatusFlags({ paused: false, roomMuted: false });
    room.muteMember('1111111111111111', true);
    deliver({ t: 'update', version: '0.6.0', repository: UPDATE_REPOSITORY });
    expect(room.state().updateNotice).toBeUndefined();
  });

  it('broadcasts once over relays and leaves the full ping burst available', async () => {
    const relay = new FakeTransport('internet');
    lan = relay;
    room = create(relay);
    await room.join(CODE);
    presence();
    presence('2222222222222222');
    await vi.advanceTimersByTimeAsync(3000);
    relay.sent = [];
    expect(room.sendUpdate('0.6.0')).toEqual({ ok: true, version: '0.6.0' });
    for (let i = 0; i < 10; i++) room.sendPing('danger', { d: 1, x: 0.5, y: 0.5 });
    const messages = relay.sent.flatMap(({ packet }) => {
      const plain = open(KEYS.msgKey, packet);
      const message = plain && decodeMessage(plain);
      return message ? [message] : [];
    });
    expect(messages.filter((m) => m.t === 'update')).toHaveLength(1);
    expect(messages.filter((m) => m.t === 'ping')).toHaveLength(10);
    expect(relay.sent.every((p) => p.to === '*')).toBe(true);
  });

  it('clears a notice on leaving and gives callers an independent copy', async () => {
    await room.join(CODE);
    presence();
    deliver({ t: 'update', version: '0.6.0', repository: UPDATE_REPOSITORY });
    const notice = room.state().updateNotice;
    if (notice) notice.name = 'Changed';
    expect(room.state().updateNotice?.name).toBe('Alex');
    room.leave();
    expect(room.state().updateNotice).toBeUndefined();
  });

  it('returns errors for unavailable rooms and limits sending without consuming ping tokens', async () => {
    expect(room.sendUpdate('0.6.0')).toEqual({ ok: false, error: 'notInRoom' });
    await room.join(CODE);
    await vi.advanceTimersByTimeAsync(3000);
    expect(room.sendUpdate('0.6.0')).toEqual({ ok: false, error: 'noPeers' });
    presence();
    room.setStatusFlags({ paused: true, roomMuted: false });
    expect(room.sendUpdate('0.6.0')).toEqual({ ok: false, error: 'paused' });
    room.setStatusFlags({ paused: false, roomMuted: false });
    expect(room.sendUpdate('0.6.0')).toEqual({ ok: true, version: '0.6.0' });
    expect(room.sendUpdate('0.7.0')).toEqual({ ok: false, error: 'rateLimited' });
    room.sendPing('danger', { d: 1, x: 0.5, y: 0.5 });
    const last = lan.sent.at(-1);
    const plain = last && open(KEYS.msgKey, last.packet);
    expect(plain && decodeMessage(plain)).toMatchObject({ t: 'ping', ping: 'danger' });
  });
});
