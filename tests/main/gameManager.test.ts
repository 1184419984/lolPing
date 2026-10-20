import { describe, expect, it } from 'vitest';
import { GameManager } from '../../src/main/gameManager';
import { type GamePacket, type GameResult } from '../../src/shared/game';
import type { RoomMember, RoomStateCore } from '../../src/shared/room';
import { gameCatalog, gameSelection } from './fixtures/gameCatalog';
const GAME_TESTS = ['reaction', 'aim', 'clicks', 'sequence'];

describe('GameManager', () => {
  const ids = ['a'.repeat(16), 'b'.repeat(16), 'c'.repeat(16)];
  const member = (i: number, self = false): RoomMember => ({ peer: ids[i], name: `Player ${i}`, self,
    color: i, path: 'lan', status: 'on', needsUpdate: false, noEmotes: false, muted: false, game: 1 });
  function setup(index = 0) {
    let now = 1000; let enabled = true; let works = true;
    let room: RoomStateCore = { phase: 'active', code: 'room', lan: 'ok', internet: 'off', lonely: false, clockSkew: false,
      members: ids.map((_, i) => member(i, i === index)) };
    const sent: GamePacket[] = [];
    let catalog = structuredClone(gameCatalog);
    const manager = new GameManager({ catalog: () => catalog, room: () => room, self: () => ids[index], name: () => `Player ${index}`,
      lang: () => 'en', platform: 'win', enabled: () => enabled, id: () => (13 + index).toString(16).repeat(16), now: () => now,
      send: (packet) => { if (!works) return { ok: false }; sent.push(packet); return { ok: true }; } });
    const deliver = (packet: GamePacket, peerIndex = 1) => {
      const data = packet.data as { tests?: string[]; selection?: unknown } | null;
      manager.receive({ ...packet, ...(data?.tests && !data.selection ? { data: { ...data, selection: gameSelection(data.tests) } } : {}),
        ...(packet.kind === 'join' && packet.data === null ? { data: { selection: manager.state().selection } } : {}),
        peer: ids[peerIndex], name: `Player ${peerIndex}` });
    };
    return { manager, sent, deliver, setTime: (value: number) => { now = value; },
      setEnabled: (value: boolean) => { enabled = value; }, setWorks: (value: boolean) => { works = value; },
      setCatalog: (value: typeof catalog) => { catalog = value; manager.catalogChanged(); },
      setRoom: (patch: Partial<RoomStateCore>) => { room = { ...room, ...patch }; manager.refresh(); } };
  }
  const result = (test: GameResult['test']): GameResult => ({ test, score: 80, metric: 200, accuracy: 1 });
  it('runs solo without a room and submits each test once in order', () => {
    const { manager, sent, setRoom } = setup(); setRoom({ phase: 'idle', code: null, members: [] });
    expect(manager.start(gameSelection(GAME_TESTS), false)).toEqual({ ok: true });
    expect(manager.submit(result('aim'))).toEqual({ ok: false, error: 'invalid' });
    for (const test of GAME_TESTS) expect(manager.submit(result(test))).toEqual({ ok: true });
    expect(manager.state()).toMatchObject({ phase: 'results', currentTest: null });
    expect(manager.state().results[ids[0]]).toHaveLength(4); expect(sent).toEqual([]);
    expect(manager.submit(result('sequence'))).toEqual({ ok: false, error: 'invalid' });
  });
  it('keeps invitations passive and refuses repeated offers after an explicit decline', () => {
    const { manager, deliver, sent } = setup();
    const packet: GamePacket = { gameId: 'e'.repeat(16), kind: 'invite', data: { tests: ['aim'] } };
    deliver(packet); expect(manager.state().phase).toBe('invited'); expect(sent).toEqual([]);
    manager.decline(); deliver(packet); expect(manager.state().phase).toBe('idle');
    expect(sent.map((p) => p.kind)).toEqual(['decline']);
  });
  it('requires consent, accepts only the organizer start and shares the same seed and roster', () => {
    const host = setup(0); const guest = setup(1);
    expect(host.manager.start(gameSelection(['aim', 'clicks']), true)).toEqual({ ok: true });
    guest.deliver(host.sent[0], 0); expect(guest.manager.state().phase).toBe('invited');
    expect(guest.manager.begin()).toEqual({ ok: false, error: 'notOrganizer' });
    expect(guest.manager.accept()).toEqual({ ok: true }); host.deliver(guest.sent[0], 1);
    expect(host.manager.state().participants).toHaveLength(2);
    expect(host.manager.begin()).toEqual({ ok: true });
    const begin = host.sent.at(-1); if (!begin) throw new Error('missing begin');
    guest.deliver(begin, 2); expect(guest.manager.state().phase).toBe('lobby');
    guest.deliver(begin, 0); expect(guest.manager.state().phase).toBe('playing');
    expect(guest.manager.state().seed).toBe(host.manager.state().seed);
    host.manager.submit(result('aim')); guest.manager.submit(result('aim'));
    guest.deliver(host.sent.at(-1) as GamePacket, 0); host.deliver(guest.sent.at(-1) as GamePacket, 1);
    expect(host.manager.state().results[ids[1]]).toHaveLength(1);
    host.deliver(guest.sent.at(-1) as GamePacket, 1); expect(host.manager.state().results[ids[1]]).toHaveLength(1);
  });
  it('does not accept results from uninvited peers or another circuit', () => {
    const { manager, sent, deliver } = setup(); manager.start(gameSelection(['aim']), true);
    const gameId = sent[0].gameId;
    deliver({ gameId, kind: 'join', data: null }, 1); manager.begin();
    deliver({ gameId, kind: 'result', data: result('aim') }, 2);
    deliver({ gameId: 'e'.repeat(16), kind: 'result', data: result('aim') }, 1);
    expect(manager.state().results).toEqual({});
  });
  it('refuses invalid starts and preserves the state when sending fails', () => {
    const a = setup(); a.setEnabled(false); expect(a.manager.start(gameSelection(['aim']), true)).toEqual({ ok: false, error: 'paused' });
    a.setEnabled(true); a.setWorks(false); expect(a.manager.start(gameSelection(['aim']), true)).toEqual({ ok: false, error: 'network' });
    expect(a.manager.state().phase).toBe('idle');
    expect(a.manager.start(['bad'], false)).toEqual({ ok: false, error: 'invalid' });
    a.setRoom({ members: [member(0, true)] }); a.setWorks(true);
    expect(a.manager.start(gameSelection(['aim']), true)).toEqual({ ok: true });
    expect(a.manager.state().phase).toBe('lobby');
  });
  it('repairs lost control messages on ticks without sending before their deadline', () => {
    const { manager, sent, setTime } = setup(); manager.start(gameSelection(['aim']), true);
    manager.tick(); expect(sent).toHaveLength(1);
    setTime(4000); manager.tick(); expect(sent).toHaveLength(2); expect(sent[1].kind).toBe('invite');
    manager.tick(); expect(sent).toHaveLength(2);
  });
  it('drops room sessions on leave and expires abandoned invitations', () => {
    const a = setup(); a.manager.start(gameSelection(['aim']), true); a.setRoom({ code: 'new' }); expect(a.manager.state().phase).toBe('idle');
    const b = setup(); b.deliver({ gameId: 'e'.repeat(16), kind: 'invite', data: { tests: ['aim'] } });
    b.setTime(92_000); b.manager.tick(); expect(b.manager.state().phase).toBe('idle');
  });
  it('returns detached snapshots so renderer data cannot mutate the running game', () => {
    const { manager } = setup(); manager.start(gameSelection(['aim']), false); manager.submit(result('aim'));
    const snapshot = manager.state(); snapshot.tests.length = 0; snapshot.participants[0].name = 'bad'; snapshot.results[ids[0]][0].score = 0;
    expect(manager.state().tests).toEqual(['aim']); expect(manager.state().results[ids[0]][0].score).toBe(80);
  });
  it('ends a late acceptance when the organizer starts without that player', () => {
    const { manager, deliver } = setup(); const gameId = 'e'.repeat(16);
    deliver({ gameId, kind: 'invite', data: { tests: ['aim'] } }, 1); manager.accept();
    deliver({ gameId, kind: 'begin', data: { tests: ['aim'], seed: 42, peers: [ids[1], ids[2]] } }, 1);
    expect(manager.state().phase).toBe('idle');
    deliver({ gameId, kind: 'invite', data: { tests: ['aim'] } }, 1);
    expect(manager.state().phase).toBe('idle');
  });
  it('repeats bounded cancellation packets for loss recovery but never forwards them into a new room', () => {
    const { manager, sent, setTime, setRoom } = setup(); manager.start(gameSelection(['aim']), true); manager.cancel();
    expect(sent.at(-1)?.kind).toBe('cancel'); const before = sent.length;
    setTime(4000); manager.tick(); expect(sent.length).toBe(before + 1); expect(sent.at(-1)?.kind).toBe('cancel');
    setRoom({ code: 'different' }); setTime(7000); manager.tick(); expect(sent.length).toBe(before + 1);
  });
  it('keeps resending begin after the organizer finishes so a slow guest can recover its lost start', () => {
    const { manager, sent, deliver, setTime } = setup(); manager.start(gameSelection(['aim']), true);
    deliver({ gameId: sent[0].gameId, kind: 'join', data: null }, 1); manager.begin(); manager.submit(result('aim'));
    expect(manager.state().phase).toBe('results');
    const start = sent.length;
    for (const now of [4000, 7000, 10000, 13000]) { setTime(now); manager.tick(); }
    expect(sent.slice(start).map((packet) => packet.kind)).toEqual(['begin', 'result', 'begin', 'result']);
  });
  it('rejects mismatched scripts and cancels an active match when its game pack changes', () => {
    const h = setup(); const ref = gameSelection(['aim']);
    h.deliver({ gameId: 'e'.repeat(16), kind: 'invite', data: { tests: ['aim'], selection: { ...ref, digest: '0'.repeat(64) } } });
    expect(h.manager.state().phase).toBe('idle');
    h.manager.start(ref, true);
    h.setCatalog(gameCatalog.map((g) => ({ ...g, digest: '0'.repeat(64) })));
    expect(h.manager.state()).toMatchObject({ phase: 'idle', notice: 'updated' });
    expect(h.sent.at(-1)?.kind).toBe('cancel');
    expect(h.manager.start(ref, false)).toEqual({ ok: false, error: 'invalid' });
    expect(h.manager.start({ ...ref, digest: '0'.repeat(64) }, false)).toEqual({ ok: true });
  });
  it('does not add a peer that joins without matching the current game pack', () => {
    const h = setup(); h.manager.start(gameSelection(['aim']), true);
    const gameId = h.manager.state().gameId;
    h.manager.receive({ gameId, kind: 'join', peer: ids[1], name: 'Other', data: null });
    h.manager.receive({ gameId, kind: 'join', peer: ids[1], name: 'Other', data: {
      selection: { ...gameSelection(['aim']), digest: '0'.repeat(64) } } });
    expect(h.manager.state().participants).toHaveLength(1);
  });
  it('shares the exact Chinese web room only after consent without starting a local score test', () => {
    const host = setup(0); const guest = setup(1);
    const ref = gameSelection([]); const webUrl = 'https://foony.com/zh/games/paintjob#r=kessfvk5';
    expect(host.manager.start({ ...ref, webUrl }, true)).toEqual({ ok: true });
    expect(host.manager.state()).toMatchObject({ phase: 'playing', webUrl, currentTest: null });
    guest.deliver(host.sent[0], 0);
    expect(guest.manager.state().phase).toBe('invited'); expect(guest.sent).toEqual([]);
    expect(guest.manager.accept()).toEqual({ ok: true }); host.deliver(guest.sent[0], 1);
    expect(guest.manager.state()).toMatchObject({ phase: 'playing', webUrl, currentTest: null, results: {} });
    expect(host.manager.state().participants).toHaveLength(2);
    expect(guest.manager.submit(result('aim'))).toEqual({ ok: false, error: 'invalid' });
    host.manager.cancel(); guest.deliver(host.sent.at(-1) as GamePacket, 0);
    expect(guest.manager.state()).toMatchObject({ phase: 'idle', webUrl: null });
  });
  it('refuses web invitations without a real room link and never accepts a web URL for talent stages', () => {
    const h = setup();
    expect(h.manager.start(gameSelection([]), true)).toEqual({ ok: false, error: 'invalid' });
    expect(h.manager.start({ ...gameSelection([]), webUrl: 'https://evil.test' }, false)).toEqual({ ok: false, error: 'invalid' });
    expect(h.manager.state().phase).toBe('idle');
  });
  it('can invite the room created inside Foony without closing or restarting its local session', () => {
    const h = setup();
    h.manager.start(gameSelection([]), false);
    const gameId = h.manager.state().gameId;
    expect(h.manager.inviteWeb(null)).toEqual({ ok: false, error: 'webRoomRequired' });
    expect(h.manager.inviteWeb('https://foony.com/zh/games/paintjob#r=kessfvk5')).toEqual({ ok: true });
    expect(h.manager.state()).toMatchObject({ phase: 'playing', gameId, webUrl: 'https://foony.com/zh/games/paintjob#r=kessfvk5' });
    expect(h.sent.at(-1)).toMatchObject({ kind: 'invite', gameId });
  });
  it('broadcasts an invitation without waiting for game capability discovery and lists members needing an installer', () => {
    const h = setup(); h.setRoom({ members: [member(0, true), { ...member(1), game: undefined }] });
    expect(h.manager.state().roomPeers).toBe(0);
    expect(h.manager.start(gameSelection(['aim']), true)).toEqual({ ok: true });
    expect(h.sent[0].kind).toBe('invite');
    expect(h.manager.state().invitation).toEqual({ error: null,
      members: [{ peer: ids[1], name: 'Player 1', status: 'needsUpdate' }] });
    expect(h.manager.begin()).toEqual({ ok: false, error: 'noPeers' });
    h.setRoom({ members: [member(0, true), member(1)] });
    expect(h.manager.state().invitation.members[0].status).toBe('waiting');
    h.deliver({ gameId: h.sent[0].gameId, kind: 'join', data: null });
    expect(h.manager.state().invitation.members[0].status).toBe('joined');
    expect(h.manager.begin()).toEqual({ ok: true });
  });
  it('converts a local board into a fresh consent lobby only after the invitation is sent successfully', () => {
    const h = setup(); const ref = gameCatalog.find((g) => g.game === 'chess');
    expect(h.manager.start(ref, false)).toEqual({ ok: true });
    const before = h.manager.state(); h.setWorks(false);
    expect(h.manager.start(ref, true)).toEqual({ ok: false, error: 'network' });
    expect(h.manager.state()).toEqual(before);
    h.setWorks(true); expect(h.manager.start(ref, true)).toEqual({ ok: true });
    expect(h.manager.state()).toMatchObject({ phase: 'lobby', currentTest: null, results: {}, participants: [{ peer: ids[0] }] });
    expect(h.manager.start(ref, true)).toEqual({ ok: false, error: 'busy' });
  });
  it('does not change local play when invitations are blocked by room mute or leaving the room', () => {
    const h = setup(); const ref = gameSelection(['aim']); h.manager.start(ref, false);
    h.setRoom({ members: [{ ...member(0, true), status: 'muted' }, member(1)] });
    expect(h.manager.start(ref, true)).toEqual({ ok: false, error: 'paused' });
    expect(h.manager.state().phase).toBe('playing'); expect(h.sent).toEqual([]);
    h.setRoom({ phase: 'idle', code: null, members: [] });
    expect(h.manager.start(ref, true)).toEqual({ ok: false, error: 'notInRoom' });
    expect(h.manager.state().phase).toBe('playing');
  });
  it('tells the organizer when invitees have different content, are busy or explicitly decline', () => {
    const host = setup(0); const guest = setup(1); const ref = gameSelection(['aim']);
    host.manager.start(ref, true);
    guest.setCatalog(gameCatalog.map((g) => ({ ...g, digest: '0'.repeat(64) })));
    guest.deliver(host.sent[0], 0);
    expect(guest.sent.at(-1)).toMatchObject({ kind: 'decline', data: { reason: 'incompatible' } });
    host.deliver(guest.sent.at(-1) as GamePacket, 1);
    expect(host.manager.state().invitation.members[0].status).toBe('incompatible');
    guest.setCatalog(gameCatalog); guest.manager.start(ref, false);
    guest.setTime(17_000); guest.deliver(host.sent[0], 0);
    expect(guest.sent.at(-1)).toMatchObject({ kind: 'decline', data: { reason: 'busy' } });
    host.deliver(guest.sent.at(-1) as GamePacket, 1);
    expect(host.manager.state().invitation.members[0].status).toBe('busy');
    guest.manager.cancel(); guest.setTime(33_000); guest.deliver(host.sent[0], 0);
    expect(guest.manager.accept()).toEqual({ ok: true }); host.deliver(guest.sent.at(-1) as GamePacket, 1);
    expect(host.manager.state().invitation.members[0].status).toBe('joined');
    host.deliver({ gameId: host.sent[0].gameId, kind: 'decline', data: null }, 2);
    expect(host.manager.state().invitation.members[1].status).toBe('declined');
  });
  it('bounds repeated incompatibility replies instead of flooding the room on every repeated invitation', () => {
    const h = setup(); const packet: GamePacket = { gameId: 'e'.repeat(16), kind: 'invite',
      data: { tests: ['aim'], selection: { ...gameSelection(['aim']), digest: '0'.repeat(64) } } };
    for (let i = 0; i < 20; i++) h.deliver(packet);
    expect(h.sent).toHaveLength(1); h.setTime(17_000); h.deliver(packet); expect(h.sent).toHaveLength(2);
  });
});
