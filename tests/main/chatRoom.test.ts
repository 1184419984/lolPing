import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_PACKET, open, seal, type RoomKeys } from '../../src/main/roomCrypto';
import { RoomManager, type RemotePing } from '../../src/main/roomManager';
import { CHAT_HISTORY_LIMIT, CHAT_MAX_LENGTH, type ChatEntry } from '../../src/shared/chat';
import { makeRoomCode } from '../../src/shared/roomCode';
import { decodeMessage, encodeMessage, type RoomMessage } from '../../src/shared/roomProtocol';
import { FakeTransport } from './fixtures/fakeTransport';

const KEYS: RoomKeys = { msgKey: Buffer.alloc(32, 1), relayTopic: 'room' };
const CODE = makeRoomCode(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]));
const OTHER_CODE = makeRoomCode(Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2, 1]));

class Remote {
  seq = 0;
  constructor(readonly peer: string, readonly key: string, readonly transport: FakeTransport) {}
  packet(body: Record<string, unknown>): Buffer {
    return seal(KEYS.msgKey, encodeMessage({ peer: this.peer, seq: ++this.seq, ts: Date.now(), ...body } as RoomMessage));
  }
  presence(extra: Record<string, unknown> = {}): void {
    this.deliver({ t: 'presence', proto: 1, app: '0.5.1', name: 'Alex', color: 4, status: 'on', em: [], ...extra });
  }
  chat(text = 'Hello', extra: Record<string, unknown> = {}): void {
    this.deliver({ t: 'chat', text, ...extra });
  }
  deliver(body: Record<string, unknown>): void {
    this.transport.deliver(this.key, this.packet(body));
  }
}

const rooms: RoomManager[] = [];
let lan: FakeTransport;
let room: RoomManager;
let profile: { name: string; color: number; limit: number };
let entries: ChatEntry[];

const messageText = (entry: ChatEntry): string => entry.kind === 'message' ? entry.text : entry.ping;

function makeRoom(transports: FakeTransport[], seed = 0xab, name = 'Me'): RoomManager {
  const r = new RoomManager({
    transports, now: () => Date.now(), randomBytes: (n) => new Uint8Array(n).fill(seed),
    deriveKeys: async () => KEYS, appVersion: '0.5.1',
    profile: () => seed === 0xab ? profile : { name, color: 2, limit: 5 },
    resolveTarget: () => ({ displayId: 100, width: 1920, height: 1080 }), announceEmotes: () => [],
  });
  rooms.push(r);
  return r;
}

function messages(transport = lan): RoomMessage[] {
  return transport.sent.flatMap(({ packet }) => {
    const plain = open(KEYS.msgKey, packet);
    const message = plain && decodeMessage(plain);
    return message ? [message] : [];
  });
}

function pump(from: FakeTransport, to: FakeTransport, source: string): void {
  for (const sent of from.sent.splice(0)) to.deliver(source, sent.packet);
}

beforeEach(() => {
  vi.useFakeTimers({ now: 1_780_000_000_000 });
  lan = new FakeTransport('lan');
  profile = { name: 'Me', color: 1, limit: 5 };
  entries = [];
  room = makeRoom([lan]);
  room.on('chat', (entry: ChatEntry) => entries.push(entry));
});

afterEach(() => {
  for (const r of rooms.splice(0)) r.quit();
  vi.useRealTimers();
});

describe('room chat', () => {
  it('exchanges sealed messages between two RoomManagers with a matching self echo and remote identity', async () => {
    const otherLan = new FakeTransport('lan');
    const other = makeRoom([otherLan], 0x22, 'Friend');
    await room.join(CODE);
    await other.join(CODE);
    pump(lan, otherLan, 'lan:me');
    pump(otherLan, lan, 'lan:friend');
    pump(lan, otherLan, 'lan:me');
    await vi.advanceTimersByTimeAsync(3000);
    lan.sent = [];
    otherLan.sent = [];
    expect(room.state().members).toHaveLength(2);
    expect(other.state().members).toHaveLength(2);
    const ts = Date.now();
    expect(room.sendChat('  一起玩吧 🎮  ')).toEqual({ ok: true });
    expect(messages()).toHaveLength(1);
    const sent = messages()[0];
    expect(sent).toMatchObject({ t: 'chat', text: '一起玩吧 🎮', peer: room.self, ts });
    expect(lan.sent[0].packet.length).toBeLessThanOrEqual(MAX_PACKET);
    pump(lan, otherLan, 'lan:me');
    expect(room.chatHistory()).toEqual([expect.objectContaining({ text: '一起玩吧 🎮', name: 'Me', self: true, ts })]);
    expect(other.chatHistory()).toEqual([{ ...room.chatHistory()[0], self: false }]);
    expect(other.sendChat('Ready!')).toEqual({ ok: true });
    pump(otherLan, lan, 'lan:friend');
    expect(room.chatHistory().at(-1)).toMatchObject({ text: 'Ready!', name: 'Friend', color: 2, self: false });
  });

  it('returns actionable errors without recording or sending rejected text', async () => {
    expect(room.sendChat('Hello')).toEqual({ ok: false, error: 'notInRoom' });
    await room.join(CODE);
    lan.sent = [];
    expect(room.sendChat(' \n\u202e ')).toEqual({ ok: false, error: 'empty' });
    expect(room.sendChat('x'.repeat(CHAT_MAX_LENGTH + 1))).toEqual({ ok: false, error: 'tooLong' });
    expect(room.sendChat('🎮'.repeat(200))).toEqual({ ok: false, error: 'tooLong' });
    room.setStatusFlags({ paused: true, roomMuted: false });
    lan.sent = [];
    expect(room.sendChat('Hello')).toEqual({ ok: false, error: 'paused' });
    expect(lan.sent).toEqual([]);
    expect(room.chatHistory()).toEqual([]);
    expect(entries).toEqual([]);
  });

  it('stores safe text using the established member profile rather than packet-supplied identity fields', async () => {
    await room.join(CODE);
    const alex = new Remote('1111111111111111', 'lan:alex', lan);
    alex.presence({ name: '\u202eAlex', color: 4 });
    alex.chat('  <script>alert(1)</script>\nnext\u202e  ', { name: 'Impostor', color: 7, self: true, id: 'forged' });
    expect(entries).toEqual([{
      kind: 'message', id: `${alex.peer}:${alex.seq}`, peer: alex.peer, name: 'Alex', color: 4,
      text: '<script>alert(1)</script> next', ts: Date.now(), self: false,
    }]);
  });

  it('reports an unexpected send failure without echoing an unsent message or rejecting the IPC call', async () => {
    await room.join(CODE);
    new Remote('1111111111111111', 'lan:alex', lan).presence();
    lan.sent = [];
    vi.spyOn(lan, 'sendTo').mockImplementationOnce(() => { throw new Error('socket closed'); });
    expect(room.sendChat('Could not send')).toEqual({ ok: false, error: 'failed' });
    expect(room.chatHistory()).toEqual([]);
    expect(entries).toEqual([]);
    expect(lan.sent).toEqual([]);
    expect(room.sendChat('Try again')).toEqual({ ok: true });
    expect(messages()[0]).toMatchObject({ t: 'chat', text: 'Try again' });
    expect(entries).toHaveLength(1);
  });

  it('ignores strangers, duplicate routes, local network echoes, stale packets and peers that left', async () => {
    const net = new FakeTransport('internet');
    const r = makeRoom([lan, net], 0x33);
    await r.join(CODE);
    const alex = new Remote('1111111111111111', 'lan:alex', lan);
    alex.chat('Unknown');
    expect(r.state().members).toHaveLength(1);
    expect(r.chatHistory()).toEqual([]);
    alex.presence();
    const packet = alex.packet({ t: 'chat', text: 'One copy' });
    lan.deliver(alex.key, packet);
    net.deliver('net:alex', packet);
    lan.deliver(alex.key, packet);
    alex.chat('Stale', { ts: Date.now() - 3_600_000 });
    expect(r.sendChat('Mine')).toEqual({ ok: true });
    const echo = lan.sent.find(({ packet: p }) => {
      const plain = open(KEYS.msgKey, p);
      return plain && decodeMessage(plain)?.t === 'chat';
    });
    expect(echo).toBeDefined();
    if (echo) net.deliver('net:self', echo.packet);
    alex.deliver({ t: 'bye' });
    alex.chat('Gone');
    expect(r.chatHistory().map(messageText)).toEqual(['One copy', 'Mine']);
  });

  it('honors pause, room mute, member mute and protocol compatibility without using the ping display mapping', async () => {
    await room.join(CODE);
    const alex = new Remote('1111111111111111', 'lan:alex', lan);
    alex.presence();
    room.setStatusFlags({ paused: true, roomMuted: false });
    alex.chat();
    room.setStatusFlags({ paused: false, roomMuted: true });
    alex.chat();
    expect(room.sendChat('Room mute only silences incoming messages')).toEqual({ ok: true });
    room.setStatusFlags({ paused: false, roomMuted: false });
    room.muteMember(alex.peer, true);
    alex.chat();
    room.muteMember(alex.peer, false);
    alex.presence({ proto: 2 });
    alex.chat();
    alex.presence({ proto: 1 });
    alex.chat('Allowed', { d: 99 });
    expect(room.chatHistory().map(messageText)).toEqual(['Room mute only silences incoming messages', 'Allowed']);
  });

  it('records actual local and remote signals once with sender, time and type without extra packets', async () => {
    await room.join(CODE);
    const alex = new Remote('1111111111111111', 'lan:alex', lan);
    alex.presence({ name: 'Alex', color: 4 });
    lan.sent = [];
    const ts = Date.now();
    room.sendPing('omw', { d: 1, x: 0.5, y: 0.5 });
    const sent = messages();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ t: 'ping', peer: room.self, ts });
    expect(room.chatHistory()[0]).toEqual({
      kind: 'ping', id: `${room.self}:${sent[0].seq}`, peer: room.self,
      name: 'Me', color: 1, ping: 'omw', ts, self: true,
    });

    const remoteTs = ts - 250;
    const packet = alex.packet({ t: 'ping', ping: 'danger', d: 1, x: 0.25, y: 0.5, ts: remoteTs });
    lan.deliver(alex.key, packet);
    lan.deliver(alex.key, packet);
    expect(room.chatHistory()[1]).toEqual({
      kind: 'ping', id: `${alex.peer}:${alex.seq}`, peer: alex.peer,
      name: 'Alex', color: 4, ping: 'danger', ts: remoteTs, self: false,
    });
    expect(entries).toHaveLength(2);
    expect(messages()).toHaveLength(1);
    expect(entries[1]).not.toHaveProperty('text');
  });

  it('adds no signal history for idle, paused, muted, incompatible, unmapped or rate-limited signals', async () => {
    room.sendPing('danger', { d: 1, x: 0.5, y: 0.5 });
    expect(room.chatHistory()).toEqual([]);
    await room.join(CODE);
    const alex = new Remote('1111111111111111', 'lan:alex', lan);
    alex.presence();
    const ping = (extra: Record<string, unknown> = {}) =>
      alex.deliver({ t: 'ping', ping: 'danger', d: 1, x: 0.5, y: 0.5, ...extra });
    room.setStatusFlags({ paused: true, roomMuted: false });
    room.sendPing('danger', { d: 1, x: 0.5, y: 0.5 });
    ping();
    room.setStatusFlags({ paused: false, roomMuted: true });
    ping();
    room.setStatusFlags({ paused: false, roomMuted: false });
    room.muteMember(alex.peer, true);
    ping();
    room.muteMember(alex.peer, false);
    alex.presence({ proto: 2 });
    ping();
    alex.presence({ proto: 1 });
    ping({ x: 2 });
    expect(room.chatHistory()).toEqual([]);
    profile.limit = 1;
    ping();
    ping();
    expect(room.chatHistory()).toHaveLength(1);
    expect(room.chatHistory()[0]).toMatchObject({ kind: 'ping', ping: 'danger', self: false });

    const noDisplayLan = new FakeTransport('lan');
    const noDisplay = new RoomManager({
      transports: [noDisplayLan], now: () => Date.now(), randomBytes: (n) => new Uint8Array(n).fill(0x44),
      deriveKeys: async () => KEYS, appVersion: '0.5.1', profile: () => profile,
      resolveTarget: () => null, announceEmotes: () => [],
    });
    rooms.push(noDisplay);
    await noDisplay.join(CODE);
    const other = new Remote('2222222222222222', 'lan:other', noDisplayLan);
    other.presence();
    other.deliver({ t: 'ping', ping: 'danger', d: 1, x: 0.5, y: 0.5 });
    expect(noDisplay.chatHistory()).toEqual([]);
  });

  it('rate limits each sender independently of pings and refills without queuing', async () => {
    await room.join(CODE);
    const alex = new Remote('1111111111111111', 'lan:alex', lan);
    const bob = new Remote('2222222222222222', 'lan:bob', lan);
    alex.presence();
    bob.presence({ name: 'Bob' });
    const pings: RemotePing[] = [];
    room.on('remotePing', (ping: RemotePing) => pings.push(ping));
    profile.limit = 2;
    for (let n = 0; n < 8; n++) alex.chat(`Alex ${n}`);
    for (let n = 0; n < 3; n++) bob.chat(`Bob ${n}`);
    for (let n = 0; n < 3; n++) alex.deliver({ t: 'ping', ping: 'danger', d: 1, x: 0.5, y: 0.5 });
    expect(entries.filter((entry) => entry.kind === 'message')).toHaveLength(6);
    expect(entries.filter((entry) => entry.kind === 'ping')).toHaveLength(2);
    expect(pings).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    alex.chat('Refilled');
    expect(entries.filter((entry) => entry.kind === 'message')).toHaveLength(7);
    expect(entries.at(-1)).toMatchObject({ kind: 'message', text: 'Refilled' });
  });

  it('paces outgoing chat separately from relay pings and broadcasts once for multiple relay members', async () => {
    const net = new FakeTransport('internet');
    const r = makeRoom([lan, net], 0x33);
    await r.join(CODE);
    new Remote('1111111111111111', 'lan:alex', lan).presence();
    new Remote('2222222222222222', 'net:bob', net).presence();
    new Remote('4444444444444444', 'net:charlie', net).presence();
    lan.sent = [];
    net.sent = [];
    for (let n = 0; n < 15; n++) r.sendPing('danger', { d: 1, x: 0.5, y: 0.5 });
    expect(messages(net).filter((message) => message.t === 'ping')).toHaveLength(10);
    for (let n = 0; n < 3; n++) expect(r.sendChat(`Message ${n}`)).toEqual({ ok: true });
    expect(r.sendChat('Flood')).toEqual({ ok: false, error: 'rateLimited' });
    expect(messages(net).filter((message) => message.t === 'chat')).toHaveLength(3);
    expect(messages(lan).filter((message) => message.t === 'chat')).toHaveLength(3);
    expect(r.chatHistory().filter((entry) => entry.kind === 'message')).toHaveLength(3);
    expect(r.chatHistory().filter((entry) => entry.kind === 'ping')).toHaveLength(15);
    await vi.advanceTimersByTimeAsync(1000);
    expect(r.sendChat('Refilled')).toEqual({ ok: true });
    expect(r.sendChat('Still capped')).toEqual({ ok: false, error: 'rateLimited' });
  });

  it('prefers LAN for chat and falls back to a live relay path, then honors internet being disabled', async () => {
    const net = new FakeTransport('internet');
    const r = makeRoom([lan, net], 0x33);
    await r.join(CODE);
    const alex = new Remote('1111111111111111', 'lan:alex', lan);
    alex.presence();
    new Remote(alex.peer, 'net:alex', net).presence({ seq: 20 });
    lan.sent = [];
    net.sent = [];
    expect(r.sendChat('LAN')).toEqual({ ok: true });
    expect(messages(lan).map((message) => message.t)).toEqual(['chat']);
    expect(messages(net)).toEqual([]);
    vi.setSystemTime(Date.now() + 7000);
    lan.sent = [];
    expect(r.sendChat('Relay')).toEqual({ ok: true });
    expect(messages(lan)).toEqual([]);
    expect(messages(net).filter((message) => message.t === 'chat')).toHaveLength(1);
    r.setInternetAllowed(false);
    net.sent = [];
    expect(r.sendChat('Local echo while alone')).toEqual({ ok: true });
    expect(net.sent).toEqual([]);
  });

  it('keeps only the last 100 session messages and protects history from event and caller mutations', async () => {
    await room.join(CODE);
    room.on('chat', (entry: ChatEntry) => { if (entry.kind === 'message') entry.text = 'Changed by listener'; });
    for (let n = 0; n < CHAT_HISTORY_LIMIT + 5; n++) {
      expect(room.sendChat(`Message ${n}`)).toEqual({ ok: true });
      await vi.advanceTimersByTimeAsync(1000);
    }
    const history = room.chatHistory();
    expect(history).toHaveLength(CHAT_HISTORY_LIMIT);
    expect(history[0]).toMatchObject({ kind: 'message', text: 'Message 5' });
    expect(history.at(-1)).toMatchObject({ kind: 'message', text: 'Message 104' });
    if (history[0].kind === 'message') history[0].text = 'Changed by caller';
    history.pop();
    expect(room.chatHistory()).toHaveLength(CHAT_HISTORY_LIMIT);
    expect(room.chatHistory()[0]).toMatchObject({ kind: 'message', text: 'Message 5' });
    profile.name = 'Renamed';
    expect(room.sendChat('New name')).toEqual({ ok: true });
    expect(room.chatHistory().at(-1)?.name).toBe('Renamed');
    expect(room.chatHistory()[0].name).toBe('Me');
  });

  it('clears history and rate buckets on leave, changing rooms and quit, while a rejected join keeps the room', async () => {
    const resets: number[] = [];
    room.on('chatReset', () => resets.push(room.chatHistory().length));
    await room.join(CODE);
    for (let n = 0; n < 3; n++) expect(room.sendChat(`Before ${n}`)).toEqual({ ok: true });
    expect(await room.join('not a room code')).toEqual({ ok: false, error: 'invalid' });
    expect(room.chatHistory()).toHaveLength(3);
    await room.join(OTHER_CODE);
    expect(room.chatHistory()).toEqual([]);
    for (let n = 0; n < 3; n++) expect(room.sendChat(`After ${n}`)).toEqual({ ok: true });
    room.leave();
    expect(room.chatHistory()).toEqual([]);
    expect(room.sendChat('After leave')).toEqual({ ok: false, error: 'notInRoom' });
    await room.join(CODE);
    expect(room.sendChat('After rejoin')).toEqual({ ok: true });
    room.quit();
    expect(room.chatHistory()).toEqual([]);
    expect(resets).toEqual([0, 0, 0]);
  });

  it('fits worst-case message metadata and escaped text under the encrypted packet limit', async () => {
    await room.join(CODE);
    new Remote('1111111111111111', 'lan:alex', lan).presence();
    for (const text of ['🎮'.repeat(199) + 'ab', '"'.repeat(256), '\\'.repeat(256)]) {
      lan.sent = [];
      expect(room.sendChat(text)).toEqual({ ok: true });
      expect(lan.sent[0].packet.length).toBeLessThanOrEqual(MAX_PACKET);
      expect(messages()[0]).toMatchObject({ t: 'chat', text });
      const packet = seal(KEYS.msgKey, encodeMessage({
        t: 'chat', peer: room.self, seq: Number.MAX_SAFE_INTEGER, ts: Number.MAX_SAFE_INTEGER, text,
      }));
      expect(packet.length).toBeLessThanOrEqual(MAX_PACKET);
    }
  });
});
