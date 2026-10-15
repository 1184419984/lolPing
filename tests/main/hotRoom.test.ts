import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { RoomManager } from '../../src/main/roomManager';
import { seal, type RoomKeys } from '../../src/main/roomCrypto';
import { makeRoomCode } from '../../src/shared/roomCode';
import { encodeMessage, type RoomMessage } from '../../src/shared/roomProtocol';
import { UPDATE_REPOSITORY } from '../../src/shared/project';
import type { HotInvitation } from '../../src/shared/hotUpdate';
import { FakeTransport } from './fixtures/fakeTransport';

const keys: RoomKeys = { msgKey: Buffer.alloc(32, 1), relayTopic: 'hot-test' };
const commit = 'a'.repeat(40);
let room: RoomManager;
let lan: FakeTransport;
let seq = 0;
beforeEach(async () => {
  vi.useFakeTimers({ now: 1780000000000 }); seq = 0; lan = new FakeTransport();
  room = new RoomManager({ transports: [lan], now: Date.now, randomBytes: (n) => new Uint8Array(n).fill(2),
    deriveKeys: async () => keys, appVersion: '0.5.1', profile: () => ({ name: 'Self', color: 1, limit: 5 }),
    announceEmotes: () => [], featureCommit: () => commit, resolveTarget: () => ({ displayId: 1, width: 1920, height: 1080 }) });
  await room.join(makeRoomCode(new Uint8Array(9).fill(2)));
  deliver({ t: 'presence', proto: 1, app: '0.5.1', name: 'Friend', color: 2, status: 'on', em: [], commit: 'b'.repeat(40) });
  await vi.advanceTimersByTimeAsync(3000);
});
afterEach(() => { room.quit(); vi.useRealTimers(); });
function deliver(body: Record<string, unknown>): void {
  const message = { peer: '1'.repeat(16), seq: ++seq, ts: Date.now(), ...body } as RoomMessage;
  lan.deliver('peer', seal(keys.msgKey, encodeMessage(message)));
}
describe('hot room messages', () => {
  it('delivers only bounded Git identities from known unmuted room members', () => {
    const offers: HotInvitation[] = []; room.on('hot', (offer: HotInvitation) => offers.push(offer));
    deliver({ t: 'hot', repository: 'wrong/repo', commit: 'c'.repeat(40), digest: 'd'.repeat(64) });
    deliver({ t: 'hot', repository: UPDATE_REPOSITORY, commit, digest: 'd'.repeat(64) });
    expect(offers).toEqual([]);
    deliver({ t: 'hot', repository: UPDATE_REPOSITORY, commit: 'c'.repeat(40), digest: 'd'.repeat(64) });
    expect(offers).toEqual([{ peer: '1'.repeat(16), name: 'Friend', commit: 'c'.repeat(40), digest: 'd'.repeat(64) }]);
    deliver({ t: 'hot', repository: UPDATE_REPOSITORY, commit: 'e'.repeat(40), digest: 'd'.repeat(64) });
    expect(offers).toHaveLength(1);
  });
  it('keeps pause, member mute and room mute gates', () => {
    const offers: unknown[] = []; room.on('hot', (offer: unknown) => offers.push(offer));
    const body = { t: 'hot', repository: UPDATE_REPOSITORY, commit: 'c'.repeat(40), digest: 'd'.repeat(64) };
    room.setStatusFlags({ paused: true, roomMuted: false }); deliver(body);
    room.setStatusFlags({ paused: false, roomMuted: true }); deliver(body);
    room.setStatusFlags({ paused: false, roomMuted: false }); room.muteMember('1'.repeat(16), true); deliver(body);
    expect(offers).toEqual([]);
  });
  it('allows any room member to invite and rate limits repeated invitations', () => {
    expect(room.sendHot(commit, 'd'.repeat(64))).toEqual({ ok: true });
    expect(room.sendHot(commit, 'd'.repeat(64))).toEqual({ ok: false, error: 'rateLimited' });
    expect(room.state().members.find((m) => !m.self)?.commit).toBe('b'.repeat(40));
  });
  it('routes feature messages only at the same running Git commit and keeps the receive budget bounded', () => {
    const events: unknown[] = []; room.on('feature', (event: unknown) => events.push(event));
    const message = { t: 'feature', module: 'sample', commit, topic: 'water', data: { count: 1 } };
    deliver({ ...message, commit: 'b'.repeat(40) });
    deliver(message);
    expect(events).toEqual([{ module: 'sample', topic: 'water', data: { count: 1 }, peer: '1'.repeat(16) }]);
    room.setStatusFlags({ paused: true, roomMuted: false }); deliver(message);
    room.setStatusFlags({ paused: false, roomMuted: true }); deliver(message);
    room.setStatusFlags({ paused: false, roomMuted: false }); room.muteMember('1'.repeat(16), true); deliver(message);
    expect(events).toHaveLength(1);
    room.muteMember('1'.repeat(16), false);
    for (let i = 0; i < 20; i++) deliver(message);
    expect(events).toHaveLength(3);
  });
});
