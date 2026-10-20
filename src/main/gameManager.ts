import { EventEmitter } from 'node:events';
import {
  findGame, gameInvitation, normalizeGameResult, validateGamePacket, roomGamePeers,
  type GameActionResult, type GameInviteReply, type GamePacket, type GameResult, type GameState,
} from '../shared/game';
import type { Lang } from '../shared/i18n';
import type { Platform } from '../shared/platform';
import type { RoomStateCore } from '../shared/room';
import { sameGame, type GameEntry, type GameRef } from '../shared/gameSurface';
import { moduleObject } from '../shared/modules';
import { foonyGameUrl, foonyRoomUrl } from '../shared/webGame';
import { sessionWire, type SessionWire } from '../shared/gameSession';

interface GameDeps {
  catalog(): GameEntry[];
  room(): RoomStateCore;
  self(): string;
  name(): string;
  lang(): Lang;
  platform: Platform;
  enabled(): boolean;
  id(): string;
  now(): number;
  send(packet: GamePacket): { ok: boolean };
}

/** Room control stays in main; local high-resolution measurements stay in the game window. */
export class GameManager extends EventEmitter {
  private value: GameState;
  private multiplayer = false;
  private lastHostAt = 0;
  private nextSendAt = 0;
  private cursor = 0;
  private packetCount = 0;
  private roomCode: string | null;
  private ignored = new Set<string>();
  private endedAt = 0;
  private invitationAt = -Infinity;
  private rejectedPeers = new Set<string>();
  private closing: { packet: GamePacket; until: number; next: number }[] = [];
  private replies = new Map<string, GameInviteReply>();
  private rejections = new Map<string, number>();

  constructor(private readonly deps: GameDeps) {
    super();
    this.roomCode = deps.room().code;
    this.value = this.empty();
  }

  state(): GameState {
    const room = this.deps.room();
    const invitation = gameInvitation(room, this.deps.enabled());
    if (this.multiplayer && this.value.organizer === this.deps.self()) for (const member of invitation.members) {
      if (this.value.participants.some((p) => p.peer === member.peer && p.ready)) member.status = 'joined';
      else if (member.status === 'available') member.status = this.replies.get(member.peer) ?? 'waiting';
    }
    return { ...structuredClone(this.value), invitation, catalog: structuredClone(this.deps.catalog()), lang: this.deps.lang(), roomActive: room.phase === 'active', roomPeers: roomGamePeers(room),
      self: this.deps.self(), participants: this.value.participants.map((p) => ({ ...p })),
      tests: [...this.value.tests], results: Object.fromEntries(Object.entries(this.value.results)
        .map(([peer, results]) => [peer, results.map((r) => ({ ...r }))])) };
  }

  start(raw: unknown, multiplayer: boolean): GameActionResult {
    const selection = findGame(this.deps.catalog(), raw);
    if (!selection) return { ok: false, error: 'invalid' };
    const tests = selection.definition.stages.map((stage) => stage.id);
    const webUrl = selection.definition.web
      ? (multiplayer ? foonyRoomUrl : foonyGameUrl)(moduleObject(raw) && raw.webUrl !== undefined ? raw.webUrl : selection.definition.web)
      : null;
    if (selection.definition.web && !webUrl) return { ok: false, error: 'invalid' };
    const converting = multiplayer && !this.multiplayer && !selection.definition.web && sameGame(selection, this.value.selection);
    if (this.value.phase === 'lobby' || this.value.phase === 'playing' && !converting) return { ok: false, error: 'busy' };
    const invitation = gameInvitation(this.deps.room(), this.deps.enabled());
    if (multiplayer && invitation.error) return { ok: false, error: invitation.error };
    const gameId = this.deps.id();
    if (!/^[0-9a-f]{16}$/.test(gameId)) return { ok: false, error: 'invalid' };
    if (multiplayer && !this.deps.send({ gameId, kind: 'invite', data: { tests, selection: this.ref(selection),
      ...(webUrl ? { webUrl } : {}) } }).ok) return { ok: false, error: 'network' };
    this.multiplayer = multiplayer;
    this.endedAt = 0;
    this.rejectedPeers.clear();
    this.replies.clear();
    this.value = { ...this.empty(), webUrl, selection: structuredClone(selection), gameId,
      phase: multiplayer && !webUrl ? 'lobby' : 'playing',
      organizer: this.deps.self(), organizerName: this.deps.name(), tests, currentTest: multiplayer ? null : tests[0] ?? null,
      seed: parseInt(gameId.slice(0, 8), 16), participants: [{ peer: this.deps.self(), name: this.deps.name(), ready: true }] };
    this.roomCode = this.deps.room().code;
    this.nextSendAt = this.deps.now() + 3000;
    this.changed(); return { ok: true };
  }

  accept(): GameActionResult {
    if (this.value.phase !== 'invited' || !this.value.gameId) return { ok: false, error: 'notInvited' };
    if (!findGame(this.deps.catalog(), this.value.selection)) return { ok: false, error: 'incompatible' };
    if (this.deps.room().phase !== 'active' || this.deps.room().code !== this.roomCode) return { ok: false, error: 'notInRoom' };
    if (!this.deps.enabled()) return { ok: false, error: 'paused' };
    if (!this.deps.send({ gameId: this.value.gameId, kind: 'join', data: { selection: this.value.selection
      ? this.ref(this.value.selection) : null } }).ok) return { ok: false, error: 'network' };
    this.value.phase = this.value.webUrl ? 'playing' : 'lobby'; this.multiplayer = true;
    this.addParticipant(this.deps.self(), this.deps.name());
    this.changed(); return { ok: true };
  }

  inviteWeb(raw: unknown): GameActionResult {
    const webUrl = foonyRoomUrl(raw);
    if (this.value.phase !== 'playing' || !this.value.selection?.definition.web || !this.value.gameId) return { ok: false, error: 'invalid' };
    if (this.multiplayer && this.value.organizer !== this.deps.self()) return { ok: false, error: 'notOrganizer' };
    if (!webUrl) return { ok: false, error: 'webRoomRequired' };
    if (this.multiplayer && webUrl !== this.value.webUrl) return { ok: false, error: 'busy' };
    if (this.deps.room().phase !== 'active') return { ok: false, error: 'notInRoom' };
    if (!this.deps.enabled()) return { ok: false, error: 'paused' };
    if (roomGamePeers(this.deps.room()) === 0) return { ok: false, error: 'noPeers' };
    if (!this.deps.send({ gameId: this.value.gameId, kind: 'invite', data: { tests: [], webUrl,
      selection: this.ref(this.value.selection) } }).ok) return { ok: false, error: 'network' };
    this.value.webUrl = webUrl; this.multiplayer = true; this.roomCode = this.deps.room().code;
    this.nextSendAt = this.deps.now() + 3000;
    this.changed(); return { ok: true };
  }

  decline(): void {
    if (this.value.phase === 'invited' && this.value.gameId) {
      this.closePacket({ gameId: this.value.gameId, kind: 'decline', data: null });
      this.ignore(this.value.gameId);
      this.value = this.empty(); this.multiplayer = false; this.changed();
    }
  }

  begin(): GameActionResult {
    if (this.value.organizer !== this.deps.self()) return { ok: false, error: 'notOrganizer' };
    if (this.value.phase !== 'lobby' || this.value.participants.filter((p) => p.ready).length < 2) return { ok: false, error: 'noPeers' };
    const packet = this.beginPacket();
    if (!packet || !this.deps.send(packet).ok) return { ok: false, error: 'network' };
    this.value.phase = 'playing'; this.value.currentTest = this.value.tests[0] ?? null;
    this.changed(); return { ok: true };
  }

  sendSession(data: SessionWire): boolean {
    if (this.value.phase !== 'playing' || !this.value.selection?.definition.session || !this.value.gameId) return false;
    return !this.multiplayer || this.deps.send({ gameId: this.value.gameId, kind: 'sync', data }).ok;
  }

  submit(raw: unknown): GameActionResult {
    if (this.value.selection?.definition.session) return { ok: false, error: 'invalid' };
    const result = normalizeGameResult(raw);
    if (!result || this.value.phase !== 'playing' || result.test !== this.value.currentTest) return { ok: false, error: 'invalid' };
    this.storeResult(this.deps.self(), result);
    if (this.multiplayer && this.value.gameId) this.deps.send({ gameId: this.value.gameId, kind: 'result', data: result });
    const own = this.value.results[this.deps.self()] ?? [];
    this.value.currentTest = this.value.tests[own.length] ?? null;
    if (!this.value.currentTest) { this.value.phase = 'results'; this.endedAt = this.deps.now(); }
    this.changed(); return { ok: true };
  }

  cancel(): void {
    if (this.multiplayer && this.value.gameId) this.closePacket({ gameId: this.value.gameId,
      kind: this.value.organizer === this.deps.self() ? 'cancel' : 'decline', data: null });
    if (this.value.gameId) this.ignore(this.value.gameId);
    this.value = this.empty(); this.multiplayer = false; this.changed();
  }

  receive(raw: unknown): void {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    const event = raw as Record<string, unknown>;
    const packet = validateGamePacket(raw);
    if (!packet || typeof event.peer !== 'string' || typeof event.name !== 'string') return;
    const peer = event.peer;
    const member = this.deps.room().members.find((m) => m.peer === peer && !m.self && !m.muted && !m.needsUpdate);
    if (!member || member.game !== 1 || this.ignored.has(packet.gameId)) return;
    if (packet.kind === 'sync') {
      const data = sessionWire(packet.data);
      if (packet.gameId === this.value.gameId && this.value.phase === 'playing' && this.value.selection?.definition.session
        && this.value.participants.some((p) => p.peer === peer && p.ready) && data) {
        if (peer === this.value.organizer) this.lastHostAt = this.deps.now();
        this.emit('sync', peer, data);
      }
      return;
    }
    if (packet.kind === 'invite') {
      if (packet.gameId === this.value.gameId) {
        if (peer === this.value.organizer) this.lastHostAt = this.deps.now();
        return;
      }
      if (this.value.phase !== 'idle' && this.value.phase !== 'results') {
        this.rejectInvitation(peer, packet.gameId, 'busy'); return;
      }
      if (this.deps.now() - this.invitationAt < 15_000) return;
      const data = packet.data as { tests: GameState['tests']; selection?: GameRef; webUrl?: string };
      const selection = findGame(this.deps.catalog(), data.selection);
      if (!selection || selection.definition.stages.map((s) => s.id).join(',') !== data.tests.join(',')
        || Boolean(selection.definition.web) !== Boolean(data.webUrl)) {
        if (this.rejectInvitation(peer, packet.gameId, 'incompatible')) this.emit('incompatible', member.name);
        return;
      }
      this.value = { ...this.empty(), gameId: packet.gameId, phase: 'invited', organizer: peer,
        organizerName: member.name, webUrl: data.webUrl ?? null, selection: structuredClone(selection), tests: data.tests,
        participants: [{ peer, name: member.name, ready: true }] };
      this.multiplayer = true; this.roomCode = this.deps.room().code;
      this.invitationAt = this.deps.now(); this.rejectedPeers.clear();
      this.replies.clear();
      this.endedAt = 0; this.lastHostAt = this.deps.now(); this.changed(); this.emit('invitation', member.name); return;
    }
    if (packet.gameId !== this.value.gameId) return;
    if (peer === this.value.organizer) this.lastHostAt = this.deps.now();
    if (packet.kind === 'join' && (this.value.phase === 'lobby' || this.value.phase === 'playing' && this.value.webUrl)
      && !this.rejectedPeers.has(peer)) {
      const data = packet.data as { selection?: GameRef } | null;
      if (sameGame(data?.selection ?? null, this.value.selection)) this.addParticipant(peer, member.name);
    }
    if (packet.kind === 'decline') {
      const data = packet.data as { reason?: 'incompatible' | 'busy' } | null;
      if (this.value.organizer === this.deps.self()) this.replies.set(peer, data?.reason ?? 'declined');
      if (!data?.reason) this.rejectedPeers.add(peer);
      if (this.value.phase === 'lobby') this.value.participants = this.value.participants.filter((p) => p.peer !== peer);
      else { const player = this.value.participants.find((p) => p.peer === peer); if (player) player.ready = false; }
    }
    if (packet.kind === 'begin' && peer === this.value.organizer && this.value.phase === 'lobby') {
      const data = packet.data as { tests: GameState['tests']; seed: number; peers: string[]; selection?: GameRef; webUrl?: string };
      if (!sameGame(data.selection ?? null, this.value.selection)) return;
      if ((data.webUrl ?? null) !== this.value.webUrl) return;
      if (!data.peers.includes(peer) || data.tests.join(',') !== this.value.tests.join(',')) return;
      if (!data.peers.includes(this.deps.self())) {
        this.ignore(packet.gameId); this.value = this.empty(); this.multiplayer = false; this.changed(); return;
      }
      this.value.tests = data.tests; this.value.seed = data.seed;
      const room = this.deps.room();
      this.value.participants = data.peers.map((id) => ({ peer: id, ready: true,
        name: id === this.deps.self() ? this.deps.name() : room.members.find((m) => m.peer === id)?.name ?? id.slice(0, 6) }));
      this.value.phase = 'playing'; this.value.currentTest = data.tests[0] ?? null;
    }
    if (packet.kind === 'result' && (this.value.phase === 'playing' || this.value.phase === 'results')
      && this.value.participants.some((p) => p.peer === peer)) {
      const result = normalizeGameResult(packet.data);
      if (result && this.value.tests.includes(result.test)) this.storeResult(peer, result);
    }
    if (packet.kind === 'cancel' && peer === this.value.organizer) {
      this.ignore(packet.gameId); this.value = this.empty(); this.multiplayer = false;
    }
    this.changed();
  }

  refresh(): void {
    const room = this.deps.room();
    if (room.code !== this.roomCode) {
      this.ignored.clear(); this.closing = []; this.invitationAt = -Infinity;
      this.replies.clear(); this.rejections.clear();
    }
    if (this.multiplayer && (room.code !== this.roomCode || room.phase === 'idle')) {
      this.value = this.empty(); this.multiplayer = false;
      this.ignored.clear();
    }
    if (this.multiplayer) for (const player of this.value.participants) {
      if (player.peer !== this.deps.self() && !room.members.some((m) => m.peer === player.peer)) player.ready = false;
    }
    if (this.value.selection?.definition.session && this.value.organizer !== this.deps.self()
      && this.value.participants.some((p) => p.peer === this.value.organizer && !p.ready)) {
      this.cancel(); return;
    }
    if (this.value.phase === 'lobby') this.value.participants = this.value.participants.filter((p) => p.ready);
    this.roomCode = room.code;
    this.changed();
  }

  catalogChanged(): void {
    if (this.value.selection && !findGame(this.deps.catalog(), this.value.selection)
      && this.value.phase !== 'idle' && this.value.phase !== 'results') {
      this.cancel(); this.value.notice = 'updated';
    }
    this.changed();
  }

  /** Repeating compact control/results packets repairs UDP or relay loss without synchronizing reaction clocks. */
  tick(): void {
    const now = this.deps.now();
    this.closing = this.closing.filter((item) => item.until > now);
    if (this.deps.room().phase === 'active' && this.deps.enabled()) {
      const closing = this.closing.find((item) => item.next <= now);
      if (closing) { closing.next = now + 3000; this.deps.send(closing.packet); }
    }
    if (!this.multiplayer || !this.value.gameId || this.value.phase === 'idle') return;
    if (this.endedAt && now - this.endedAt > 10 * 60_000) {
      this.multiplayer = false;
      for (const player of this.value.participants) if ((this.value.results[player.peer]?.length ?? 0) < this.value.tests.length) player.ready = false;
      this.changed(); return;
    }
    if (this.value.organizer !== this.deps.self() && now - this.lastHostAt > 90_000) {
      if (this.value.phase === 'results') {
        this.multiplayer = false;
        for (const player of this.value.participants) if (player.peer !== this.deps.self()) player.ready = false;
      } else this.value = this.empty();
      this.multiplayer = false; this.changed(); return;
    }
    if (now < this.nextSendAt) return;
    this.nextSendAt = now + 3000;
    const packets: GamePacket[] = [];
    const ownResults = this.value.results[this.deps.self()] ?? [];
    if (this.value.organizer === this.deps.self()) {
      if (this.value.phase === 'lobby' || this.value.webUrl) packets.push({ gameId: this.value.gameId, kind: 'invite', data: { tests: this.value.tests,
        selection: this.value.selection ? this.ref(this.value.selection) : null,
        ...(this.value.webUrl ? { webUrl: this.value.webUrl } : {}) } });
      else { const packet = this.beginPacket(); if (packet) packets.push(packet); }
    } else if (this.value.phase === 'lobby' || this.value.webUrl) packets.push({ gameId: this.value.gameId, kind: 'join', data: {
      selection: this.value.selection ? this.ref(this.value.selection) : null } });
    for (const result of ownResults) {
      packets.push({ gameId: this.value.gameId, kind: 'result', data: result });
    }
    // Alternate start control with results so a late guest cannot receive results only before its first begin.
    if (packets.length && this.deps.enabled()) {
      const index = this.value.organizer === this.deps.self() && packets[0].kind === 'begin' && packets.length > 1
        ? this.packetCount++ % 2 === 0 ? 0 : 1 + this.cursor++ % (packets.length - 1)
        : this.cursor++ % packets.length;
      this.deps.send(packets[index]);
    }
  }

  private addParticipant(peer: string, name: string): void {
    if (this.value.participants.length < 8 && !this.value.participants.some((p) => p.peer === peer)) {
      this.value.participants.push({ peer, name, ready: true });
    }
  }
  private storeResult(peer: string, result: GameResult): void {
    const results = this.value.results[peer] ?? [];
    if (!results.some((r) => r.test === result.test)) this.value.results[peer] = [...results, result];
  }
  private beginPacket(): GamePacket | null {
    return this.value.gameId ? { gameId: this.value.gameId, kind: 'begin', data: { tests: this.value.tests,
      selection: this.value.selection ? this.ref(this.value.selection) : null,
      ...(this.value.webUrl ? { webUrl: this.value.webUrl } : {}),
      seed: this.value.seed, peers: this.value.participants.map((p) => p.peer) } } : null;
  }
  private closePacket(packet: GamePacket): void {
    if (this.deps.room().phase !== 'active') return;
    this.deps.send(packet);
    this.closing = [...this.closing.filter((item) => item.packet.gameId !== packet.gameId),
      { packet, until: this.deps.now() + 15_000, next: this.deps.now() + 3000 }].slice(-4);
  }
  private ignore(id: string): void {
    if (this.ignored.size >= 32) {
      const oldest = this.ignored.values().next().value;
      if (oldest !== undefined) this.ignored.delete(oldest);
    }
    this.ignored.add(id);
  }
  private empty(): GameState {
    return { catalog: [], selection: null, webUrl: null, notice: null, lang: this.deps.lang(), platform: this.deps.platform, roomActive: false, roomPeers: 0,
      invitation: { error: 'notInRoom', members: [] }, self: this.deps.self(),
      phase: 'idle', gameId: null, organizer: null, organizerName: null, tests: [], currentTest: null,
      seed: 0, participants: [], results: {} };
  }
  private rejectInvitation(peer: string, gameId: string, reason: 'incompatible' | 'busy'): boolean {
    const key = `${peer}:${gameId}`; const now = this.deps.now();
    if (now - (this.rejections.get(key) ?? -Infinity) < 15_000) return false;
    if (this.rejections.size >= 32) {
      const oldest = this.rejections.keys().next().value;
      if (oldest !== undefined) this.rejections.delete(oldest);
    }
    this.rejections.set(key, now);
    this.deps.send({ gameId, kind: 'decline', data: { reason } });
    return true;
  }
  private ref(entry: GameEntry): GameRef { return { module: entry.module, game: entry.game, digest: entry.digest }; }
  private changed(): void { this.emit('state', this.state()); }
}
