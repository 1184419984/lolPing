import { moduleJson, moduleObject } from './modules';

export const SESSION_LIMIT = 16384;
export type SessionAction =
  | { type: 'move'; round: number; ply: number; from: number; to: number; promotion: 'q' | 'r' | 'b' | 'n' }
  | { type: 'stroke'; round: number; color: number; width: number; points: number[] }
  | { type: 'guess'; round: number; text: string }
  | { type: 'choose'; round: number; index: number }
  | { type: 'depart'; round: number; peer: string }
  | { type: 'clear' | 'undo' | 'resign' | 'next' | 'rematch' | 'clock'; round: number };
export interface SessionEvent { seq: number; id: number; actor: string; now: number; action: SessionAction }
export type SessionWire =
  | { op: 'request'; id: number; action: SessionAction }
  | { op: 'event'; event: SessionEvent; to?: string }
  | { op: 'poll'; after: number }
  | { op: 'ack'; peer: string; id: number };
export interface SessionView {
  kind: 'grid' | 'draw';
  board: 'marks' | 'discs' | 'chess';
  status: 'turn' | 'won' | 'draw' | 'choose' | 'drawing' | 'reveal' | 'finished';
  round: number;
  ply: number;
  turn: string | null;
  winner: string | null;
  columns: number;
  cells: string[];
  legal: number[];
  check: boolean;
  moves: string[];
  choices: string[];
  word: string;
  hint: string;
  deadline: number;
  strokes: number[][];
  messages: { peer: string; text: string; hit: boolean }[];
  scores: { peer: string; score: number }[];
}
export interface SessionFrame { gameId: string; revision: number; view: SessionView; pending: boolean }
export interface SessionReply { state: unknown; view: SessionView; accepted: boolean }
const peer = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{16}$/.test(v);
const int = (v: unknown, min: number, max: number): v is number => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max
  && !/[\u0000-\u001f\u202a-\u202e\u2066-\u2069]/.test(v);

/** Both IPC and room actions are rebuilt from a small, bounded vocabulary. */
export function sessionAction(raw: unknown): SessionAction | null {
  if (!moduleObject(raw) || !int(raw.round, 0, 64)) return null;
  const round = raw.round;
  if (raw.type === 'move' && int(raw.ply, 0, 1000) && int(raw.from, 0, 63) && int(raw.to, 0, 63)
    && ['q', 'r', 'b', 'n'].includes(String(raw.promotion))) {
    return { type: 'move', round, ply: raw.ply, from: raw.from, to: raw.to, promotion: raw.promotion as 'q' | 'r' | 'b' | 'n' };
  }
  if (raw.type === 'stroke' && int(raw.color, 0, 7) && int(raw.width, 1, 24) && Array.isArray(raw.points)
    && raw.points.length >= 4 && raw.points.length <= 24 && raw.points.length % 2 === 0
    && raw.points.every((v) => int(v, 0, 1024))) return { type: 'stroke', round, color: raw.color, width: raw.width, points: [...raw.points] };
  if (raw.type === 'guess' && text(raw.text, 60) && raw.text.trim()) return { type: 'guess', round, text: raw.text.trim() };
  if (raw.type === 'choose' && int(raw.index, 0, 2)) return { type: 'choose', round, index: raw.index };
  if (raw.type === 'depart' && peer(raw.peer)) return { type: 'depart', round, peer: raw.peer };
  if (['clear', 'undo', 'resign', 'next', 'rematch', 'clock'].includes(String(raw.type))) {
    return { type: raw.type as 'clear' | 'undo' | 'resign' | 'next' | 'rematch' | 'clock', round };
  }
  return null;
}

export function sessionWire(raw: unknown): SessionWire | null {
  if (!moduleObject(raw)) return null;
  if (raw.op === 'poll' && int(raw.after, 0, SESSION_LIMIT)) return { op: 'poll', after: raw.after };
  if (raw.op === 'ack' && peer(raw.peer) && int(raw.id, 1, SESSION_LIMIT)) return { op: 'ack', peer: raw.peer, id: raw.id };
  if (raw.op === 'request' && int(raw.id, 1, SESSION_LIMIT)) {
    const action = sessionAction(raw.action);
    return action && action.type !== 'clock' && action.type !== 'depart' ? { op: 'request', id: raw.id, action } : null;
  }
  if (raw.op === 'event' && moduleObject(raw.event)) {
    const e = raw.event; const action = sessionAction(e.action);
    if (!action || !int(e.seq, 1, SESSION_LIMIT) || !int(e.id, 0, SESSION_LIMIT) || !peer(e.actor)
      || !int(e.now, 0, Number.MAX_SAFE_INTEGER) || raw.to !== undefined && !peer(raw.to)) return null;
    return { op: 'event', event: { seq: e.seq, id: e.id, actor: e.actor, now: e.now, action },
      ...(raw.to ? { to: raw.to as string } : {}) };
  }
  return null;
}

/** No script may return markup, arbitrary assets, code, or unbounded canvas data. */
export function sessionView(raw: unknown): SessionView | null {
  if (!moduleObject(raw) || !['grid', 'draw'].includes(String(raw.kind)) || !['marks', 'discs', 'chess'].includes(String(raw.board))
    || !['turn', 'won', 'draw', 'choose', 'drawing', 'reveal', 'finished'].includes(String(raw.status))
    || !int(raw.round, 0, 64) || !int(raw.ply, 0, 1000) || raw.turn !== null && !peer(raw.turn)
    || raw.winner !== null && !peer(raw.winner) || !int(raw.columns, 1, 8) || typeof raw.check !== 'boolean'
    || !int(raw.deadline, 0, Number.MAX_SAFE_INTEGER) || !text(raw.word, 60) || !text(raw.hint, 60)) return null;
  if (!Array.isArray(raw.cells) || raw.cells.length > 64 || !raw.cells.every((v) => text(v, 4))
    || !Array.isArray(raw.legal) || raw.legal.length > 64 || !raw.legal.every((v) => int(v, 0, 63))
    || !Array.isArray(raw.moves) || raw.moves.length > 1000 || !raw.moves.every((v) => text(v, 16))
    || !Array.isArray(raw.choices) || raw.choices.length > 3 || !raw.choices.every((v) => text(v, 60))
    || !Array.isArray(raw.strokes) || raw.strokes.length > 400
    || !raw.strokes.every((v) => Array.isArray(v) && v.length >= 6 && v.length <= 26 && v.length % 2 === 0
      && int(v[0], 0, 7) && int(v[1], 1, 24) && v.slice(2).every((n) => int(n, 0, 1024)))
    || !Array.isArray(raw.messages) || raw.messages.length > 24
    || !raw.messages.every((v) => moduleObject(v) && peer(v.peer) && text(v.text, 60) && typeof v.hit === 'boolean')
    || !Array.isArray(raw.scores) || raw.scores.length > 8
    || !raw.scores.every((v) => moduleObject(v) && peer(v.peer) && int(v.score, 0, 10000))) return null;
  if (moduleJson(raw, 128 * 1024) === null) return null;
  if (raw.kind === 'grid' && (raw.cells.length < 1 || raw.cells.length / raw.columns > 8 || raw.cells.length % raw.columns !== 0
    || raw.board === 'chess' && (raw.cells.length !== 64 || raw.columns !== 8))) return null;
  return { kind: raw.kind as SessionView['kind'], board: raw.board as SessionView['board'], status: raw.status as SessionView['status'], round: raw.round,
    ply: raw.ply, turn: raw.turn as string | null, winner: raw.winner as string | null, columns: raw.columns,
    cells: [...raw.cells] as string[], legal: [...raw.legal] as number[], check: raw.check,
    moves: [...raw.moves] as string[], choices: [...raw.choices] as string[], word: raw.word, hint: raw.hint,
    deadline: raw.deadline, strokes: (raw.strokes as number[][]).map((s) => [...s]),
    messages: (raw.messages as SessionView['messages']).map((m) => ({ peer: m.peer, text: m.text, hit: m.hit })),
    scores: (raw.scores as SessionView['scores']).map((s) => ({ peer: s.peer, score: s.score })) };
}
