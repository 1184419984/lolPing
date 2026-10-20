import { EventEmitter } from 'node:events';
import type { GameState } from '../shared/game';
import { sessionAction, SESSION_LIMIT, type SessionAction, type SessionEvent, type SessionFrame, type SessionWire } from '../shared/gameSession';
import type { GameRef } from '../shared/gameSurface';
import type { ModuleContext, ModulePayload } from '../shared/modules';
import type { ModuleRunner } from './moduleRunner';

interface Deps {
  payload(ref: GameRef): ModulePayload | null;
  runner(): Pick<ModuleRunner, 'load' | 'session' | 'stop'>;
  context(): ModuleContext;
  send(data: SessionWire): boolean;
  now(): number;
  failed(ref: GameRef): void;
}
interface Running {
  key: string;
  game: GameState;
  payload: ModulePayload;
  runner: ReturnType<Deps['runner']>;
  state: unknown;
  frame: SessionFrame | null;
  log: SessionEvent[];
  received: Map<number, SessionEvent>;
  seen: Map<string, number>;
  requestId: number;
  pending: { id: number; action: SessionAction }[];
  peers: Map<string, number>;
  nextAt: number;
  lastClock: number;
}

/** Ordered authoritative actions are replayed in isolated workers. Polling repairs dropped packets. */
export class GameSession extends EventEmitter {
  private running: Running | null = null;
  private queue = Promise.resolve();
  private generation = 0;
  private queued = 0;
  private guestTick = 0;
  constructor(private readonly deps: Deps) { super(); }

  frame(): SessionFrame | null { return this.running?.frame ? structuredClone(this.running.frame) : null; }
  async whenIdle(): Promise<void> {
    for (;;) { const pending = this.queue; await pending; if (pending === this.queue) return; }
  }

  sync(game: GameState): void {
    const key = game.phase === 'playing' && game.selection?.definition.session ? game.gameId : null;
    if (key && this.running?.key === key) {
      const s = this.running;
      if (game.organizer === game.self && s.frame) for (const player of game.participants) {
        if (!player.ready && s.game.participants.some((p) => p.peer === player.peer && p.ready)) {
          this.request(s, game.self, 0, { type: 'depart', round: s.frame.view.round, peer: player.peer });
        }
      }
      s.game = game; return;
    }
    const previous = this.running;
    this.running = null; const generation = ++this.generation;
    if (previous) void previous.runner.stop();
    this.emit('frame', null);
    if (!key || !game.selection) return;
    const payload = this.deps.payload(game.selection);
    if (!payload) return;
    const s: Running = { key, game, payload, runner: this.deps.runner(), state: null, frame: null,
      log: [], received: new Map(), seen: new Map(), requestId: 0, pending: [], peers: new Map(), nextAt: 0, lastClock: 0 };
    this.running = s;
    this.enqueue(s, async () => {
      await s.runner.load(payload);
      const reply = await s.runner.session('start', { game: game.selection?.game, seed: game.seed,
        peers: game.participants.map((p) => p.peer), self: game.self, host: game.organizer, now: 0 }, this.context(s), null);
      if (generation !== this.generation) return;
      s.state = reply.state;
      s.frame = { gameId: key, revision: 0, view: reply.view, pending: false };
      this.publish(s);
      if (s.game.organizer === s.game.self && reply.view.kind === 'draw') {
        this.request(s, s.game.self, 0, { type: 'clock', round: reply.view.round });
      }
    });
  }

  action(raw: unknown): boolean {
    const action = sessionAction(raw); const s = this.running;
    if (!action || action.type === 'clock' || action.type === 'depart' || !s?.frame || s.pending.length >= 24) return false;
    if (s.requestId >= SESSION_LIMIT) { this.emit('limit'); return false; }
    const id = ++s.requestId;
    if (s.game.organizer === s.game.self) this.request(s, s.game.self, id, action);
    else {
      s.pending.push({ id, action });
      if (s.pending.length === 1) this.deps.send({ op: 'request', id, action });
      this.publish(s);
    }
    return true;
  }

  receive(peer: string, data: SessionWire): void {
    const s = this.running;
    if (!s || !s.game.participants.some((p) => p.peer === peer && p.ready)) return;
    const host = s.game.organizer === s.game.self;
    if (host && data.op === 'request') this.request(s, peer, data.id, data.action);
    if (host && data.op === 'poll') s.peers.set(peer, Math.min(data.after, s.log.length));
    if (!host && peer === s.game.organizer) {
      if (data.op === 'ack' && data.peer === s.game.self) {
        s.pending = s.pending.filter((p) => p.id !== data.id); this.publish(s);
      }
      if (data.op === 'event' && (!data.to || data.to === s.game.self)) {
        const event = data.event;
        if (event.seq <= s.log.length || event.seq > s.log.length + 64 || s.received.size >= 64) return;
        s.received.set(event.seq, event);
        this.enqueue(s, async () => {
          for (;;) {
            const next = s.received.get(s.log.length + 1);
            if (!next) break;
            s.received.delete(next.seq);
            if (!await this.apply(s, next)) throw new Error('Session replay diverged');
            s.log.push(next);
            if (next.actor === s.game.self) s.pending = s.pending.filter((p) => p.id !== next.id);
          }
          this.publish(s);
        });
      }
    }
  }

  tick(): void {
    const s = this.running; const now = this.deps.now();
    if (!s?.frame || now < s.nextAt) return;
    s.nextAt = now + 120;
    if (s.game.organizer === s.game.self) {
      const peer = [...s.peers].find(([id, after]) => after < s.log.length && s.game.participants.some((p) => p.peer === id && p.ready));
      if (peer) {
        if (this.deps.send({ op: 'event', to: peer[0], event: s.log[peer[1]] })) {
          s.peers.delete(peer[0]); s.peers.set(peer[0], peer[1] + 1);
        }
      }
      if (s.frame.view.kind === 'draw' && s.frame.view.deadline > 0 && now >= s.frame.view.deadline && now - s.lastClock >= 1000) {
        s.lastClock = now;
        this.request(s, s.game.self, 0, { type: 'clock', round: s.frame.view.round });
      }
    } else {
      if (s.pending.length) this.deps.send({ op: 'request', ...s.pending[0] });
      if (++this.guestTick % 8 === 0) this.deps.send({ op: 'poll', after: s.log.length });
    }
  }

  async stop(): Promise<void> {
    const s = this.running; this.running = null; this.generation++;
    await s?.runner.stop();
    await this.queue;
  }

  private request(s: Running, actor: string, id: number, action: SessionAction): void {
    this.enqueue(s, async () => {
      const seen = s.seen.get(actor) ?? 0;
      if (id && id <= seen) { this.deps.send({ op: 'ack', peer: actor, id }); return; }
      if (s.log.length >= SESSION_LIMIT - 1) { this.emit('limit'); return; }
      if (!s.frame) return;
      const event = { seq: s.log.length + 1, actor, id, now: this.deps.now(), action };
      if (await this.apply(s, event)) {
        s.log.push(event);
        this.deps.send({ op: 'event', event });
      }
      if (id) {
        s.seen.set(actor, id);
        this.deps.send({ op: 'ack', peer: actor, id });
      }
      this.publish(s);
    });
  }

  private async apply(s: Running, event: SessionEvent): Promise<boolean> {
    const reply = await s.runner.session('action', { ...event, self: s.game.self }, this.context(s), s.state);
    if (!reply.accepted) return false;
    s.state = reply.state;
    s.frame = { gameId: s.key, revision: event.seq, view: reply.view, pending: s.pending.length > 0 };
    return true;
  }
  private context(s: Running): ModuleContext { return { ...this.deps.context(), texts: s.payload.manifest.texts }; }
  private publish(s: Running): void {
    if (this.running !== s || !s.frame) return;
    s.frame.pending = s.pending.length > 0;
    this.emit('frame', structuredClone(s.frame));
  }
  private enqueue(s: Running, run: () => Promise<void>): void {
    if (this.queued >= 64) return;
    this.queued++;
    this.queue = this.queue.then(async () => { if (this.running === s) await run(); }).catch((error: unknown) => {
      if (this.running !== s) return;
      console.warn('[game] session failed', error);
      this.running = null; void s.runner.stop();
      if (s.game.selection) this.deps.failed(s.game.selection);
      this.emit('frame', null);
    }).finally(() => { this.queued--; });
  }
}
