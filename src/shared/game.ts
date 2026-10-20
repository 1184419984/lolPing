import type { Lang } from './i18n';
import type { MemberPath, RoomStateCore } from './room';
import { GAME_KEY, sameGame, type GameEntry, type GameRef } from './gameSurface';
import { MODULE_HASH, MODULE_ID, moduleObject } from './modules';
import { foonyRoomUrl } from './webGame';
import { sessionWire } from './gameSession';

export const GAME_ID = /^[0-9a-f]{16}$/;
export type GameTestId = string;
export type GamePacketKind = 'invite' | 'join' | 'decline' | 'begin' | 'result' | 'cancel' | 'sync';

export interface GameResult {
  test: GameTestId;
  score: number;
  metric: number;
  accuracy: number;
}

export interface GamePacket {
  gameId: string;
  kind: GamePacketKind;
  data: unknown;
}

export interface GameParticipant {
  peer: string;
  name: string;
  path?: MemberPath;
  ready: boolean;
}

export type GamePhase = 'idle' | 'invited' | 'lobby' | 'playing' | 'results';
export type GameInviteStatus = 'available' | 'needsUpdate' | 'muted' | 'paused' | 'connecting' | 'unreachable'
  | 'waiting' | 'joined' | 'declined' | 'incompatible' | 'busy';
export type GameInviteReply = 'declined' | 'incompatible' | 'busy';
export interface GameInvitation {
  error: 'notInRoom' | 'paused' | null;
  members: { peer: string; name: string; status: GameInviteStatus }[];
}

export interface GameState {
  webUrl: string | null;
  catalog: GameEntry[];
  selection: GameEntry | null;
  notice: 'updated' | null;
  lang: Lang;
  platform: 'win' | 'mac';
  roomActive: boolean;
  roomPeers: number;
  invitation: GameInvitation;
  self: string;
  phase: GamePhase;
  gameId: string | null;
  organizer: string | null;
  organizerName: string | null;
  tests: GameTestId[];
  currentTest: GameTestId | null;
  seed: number;
  participants: GameParticipant[];
  results: Record<string, GameResult[]>;
}

export type GameActionResult =
  | { ok: true }
  | { ok: false; error: 'notInRoom' | 'noPeers' | 'busy' | 'invalid' | 'notOrganizer' | 'notInvited' | 'paused' | 'network' | 'incompatible' | 'runtime' | 'webRoomRequired' };

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const uint = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const PACKET_SET = new Set<string>(['invite', 'join', 'decline', 'begin', 'result', 'cancel', 'sync']);

export function gameTests(raw: unknown): GameTestId[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 8) return null;
  const out: GameTestId[] = [];
  for (const test of raw) {
    if (typeof test !== 'string' || !GAME_KEY.test(test) || out.includes(test)) return null;
    out.push(test as GameTestId);
  }
  return out;
}

export function normalizeGameResult(raw: unknown): GameResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.test !== 'string' || !GAME_KEY.test(value.test)) return null;
  if (!finite(value.score) || value.score < 0 || value.score > 100) return null;
  if (!finite(value.metric) || value.metric < 0 || value.metric > 60_000) return null;
  if (!finite(value.accuracy) || value.accuracy < 0 || value.accuracy > 1) return null;
  return { test: value.test as GameTestId, score: Math.round(value.score * 100) / 100,
    metric: Math.round(value.metric * 100) / 100, accuracy: Math.round(value.accuracy * 1000) / 1000 };
}

export function validateGamePacket(raw: unknown): GamePacket | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.gameId !== 'string' || !GAME_ID.test(value.gameId) || typeof value.kind !== 'string'
    || !PACKET_SET.has(value.kind)) return null;
  const kind = value.kind as GamePacketKind;
  if (kind === 'sync') {
    const data = sessionWire(value.data);
    return data ? { gameId: value.gameId, kind, data } : null;
  }
  if (kind === 'invite' || kind === 'begin') {
    const data = value.data && typeof value.data === 'object' && !Array.isArray(value.data)
      ? value.data as Record<string, unknown> : null;
    const webUrl = data?.webUrl === undefined ? undefined : foonyRoomUrl(data.webUrl);
    if (webUrl === null) return null;
    const tests = webUrl && Array.isArray(data?.tests) && data.tests.length === 0 ? [] : gameTests(data?.tests);
    if (!tests) return null;
    if (webUrl && tests.length !== 0) return null;
    const selection = gameRef(data?.selection);
    if (data?.selection !== undefined && !selection) return null;
    const extra = { ...(selection ? { selection } : {}), ...(webUrl ? { webUrl } : {}) };
    if (kind === 'begin' && (!uint(data?.seed) || (data?.seed as number) > 0xffffffff)) return null;
    if (kind === 'begin') {
      const peers = data?.peers;
      if (!Array.isArray(peers) || peers.length < 1 || peers.length > 8
        || peers.some((peer) => typeof peer !== 'string' || !GAME_ID.test(peer)) || new Set(peers).size !== peers.length) return null;
      return { gameId: value.gameId, kind, data: { tests, seed: data?.seed, peers: [...peers], ...extra } };
    }
    return { gameId: value.gameId, kind, data: { tests, ...extra } };
  }
  if (kind === 'result') {
    const result = normalizeGameResult(value.data);
    return result ? { gameId: value.gameId, kind, data: result } : null;
  }
  if (kind === 'join' && moduleObject(value.data) && value.data.selection !== undefined) {
    const selection = gameRef(value.data.selection);
    return selection ? { gameId: value.gameId, kind, data: { selection } } : null;
  }
  if (kind === 'decline' && moduleObject(value.data) && ['incompatible', 'busy'].includes(String(value.data.reason))) {
    return { gameId: value.gameId, kind, data: { reason: value.data.reason } };
  }
  return { gameId: value.gameId, kind, data: null };
}

export function gameRef(raw: unknown): GameRef | null {
  if (!moduleObject(raw) || typeof raw.module !== 'string' || !MODULE_ID.test(raw.module)
    || typeof raw.game !== 'string' || !GAME_KEY.test(raw.game)
    || typeof raw.digest !== 'string' || !MODULE_HASH.test(raw.digest)) return null;
  return { module: raw.module, game: raw.game, digest: raw.digest };
}

export function findGame(entries: readonly GameEntry[], ref: unknown): GameEntry | null {
  const parsed = gameRef(ref);
  return entries.find((entry) => sameGame(entry, parsed)) ?? null;
}

export function averageGameScore(results: readonly GameResult[]): number {
  if (results.length === 0) return 0;
  return Math.round(results.reduce((sum, result) => sum + result.score, 0) / results.length * 10) / 10;
}

export function rankGameParticipants(
  participants: readonly Pick<GameParticipant, 'peer' | 'name'>[], results: Record<string, GameResult[]>, totalTests: number,
): { peer: string; name: string; score: number; completed: number }[] {
  return participants.map((p) => ({ peer: p.peer, name: p.name, score: averageGameScore(results[p.peer] ?? []),
    completed: (results[p.peer] ?? []).length })).sort((a, b) => Number(b.completed === totalTests) - Number(a.completed === totalTests)
      || b.score - a.score || b.completed - a.completed || (a.peer < b.peer ? -1 : a.peer > b.peer ? 1 : 0));
}

export function roomGamePeers(room: RoomStateCore): number {
  return room.phase === 'active' ? room.members.filter((m) => !m.self && m.game === 1 && !m.muted && !m.needsUpdate
    && m.status === 'on' && (m.path === 'lan' || m.path === 'internet')).length : 0;
}

/** Inviting is allowed before peers are ready; diagnostics never imply consent or compatibility. */
export function gameInvitation(room: RoomStateCore, enabled: boolean): GameInvitation {
  return { error: room.phase !== 'active' ? 'notInRoom'
    : !enabled || room.members.some((m) => m.self && m.status !== 'on') ? 'paused' : null,
  members: room.members.filter((m) => !m.self).map((m) => ({ peer: m.peer, name: m.name,
    status: m.needsUpdate || m.game !== 1 ? 'needsUpdate' : m.muted || m.status === 'muted' ? 'muted'
      : m.status === 'paused' ? 'paused' : m.path === 'connecting' ? 'connecting'
      : m.path === 'unreachable' ? 'unreachable' : 'available' })) };
}
