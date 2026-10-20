import { randomBytes } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { gameInput, sameGameControls, type GameFrame, type GameInput, type GameRef } from '../shared/gameSurface';
import type { GameResult } from '../shared/game';
import type { ModuleContext, ModulePayload } from '../shared/modules';
import { ModuleRunner } from './moduleRunner';

interface RuntimeDeps {
  payload(ref: GameRef): ModulePayload | null;
  context(): ModuleContext;
  runner(): ModuleRunner | Pick<ModuleRunner, 'load' | 'game' | 'stop'>;
  submit(result: GameResult): void;
  failed(ref: GameRef): void;
}
interface Session {
  runner: Pick<ModuleRunner, 'load' | 'game' | 'stop'>;
  ref: GameRef;
  frame: GameFrame;
  state: unknown;
  shown: boolean;
  lastAt: number;
  stage: string;
}

/** A disposable isolated worker per stage. Only the owning window can send bounded surface events. */
export class GameRuntime {
  private session: Session | null = null;
  private generation = 0;
  private busy = false;
  private starting: Session['runner'] | null = null;
  constructor(private readonly deps: RuntimeDeps) {}

  static worker(path: string): ModuleRunner {
    return new ModuleRunner(new Worker(path, { resourceLimits: { maxOldGenerationSizeMb: 64 } }));
  }

  async open(ref: GameRef, stage: string, seed: number, now: number): Promise<GameFrame | null> {
    if (this.busy || !Number.isFinite(now) || now < 0 || now > 1e12) return null;
    const payload = this.deps.payload(ref);
    const definition = payload?.manifest.games?.find((g) => g.id === ref.game);
    if (!payload || definition?.session || !definition?.stages.some((s) => s.id === stage)) return null;
    this.busy = true;
    await this.stop();
    const generation = this.generation;
    let runner: Session['runner'] | null = null;
    try {
      runner = this.deps.runner(); this.starting = runner;
      await runner.load(payload);
      const reply = await runner.game('start', { game: ref.game, stage, seed, now }, this.context(payload), null);
      if (generation !== this.generation) { await runner.stop(); return null; }
      if (reply.result) throw new Error('Premature result');
      this.session = { runner, ref, stage, state: reply.state, shown: false, lastAt: now,
        frame: { token: randomBytes(16).toString('hex'), revision: 1, view: reply.view, wakeAfter: null, ready: false } };
      return this.session.frame;
    } catch (error) {
      await runner?.stop();
      console.warn('[game] start failed', error);
      if (generation === this.generation) this.deps.failed(ref);
      return null;
    } finally { if (this.starting === runner) this.starting = null; this.busy = false; }
  }

  async input(raw: unknown): Promise<GameFrame | null> {
    const input = gameInput(raw); const s = this.session;
    if (!input || !s || this.busy || input.token !== s.frame.token || input.revision !== s.frame.revision
      || input.now < s.lastAt || input.event !== 'shown' && !s.shown || input.event === 'shown' && s.shown) return null;
    if (!this.allowed(s, input)) return null;
    const payload = this.deps.payload(s.ref);
    if (!payload) { await this.stop(); return null; }
    this.busy = true;
    try {
      const reply = await s.runner.game(input.event, { now: input.now, control: input.control }, this.context(payload), s.state);
      if (this.session !== s) return null;
      if (reply.result && reply.result.test !== s.stage) throw new Error('Wrong result');
      s.state = reply.state; s.lastAt = input.now;
      if (input.event === 'shown') {
        if (reply.result) throw new Error('Premature result');
        s.shown = true; s.frame = { ...s.frame, wakeAfter: reply.wakeAfter, ready: true };
      } else if (reply.result) {
        await this.stop(); this.deps.submit(reply.result); return null;
      } else {
        s.shown = sameGameControls(s.frame.view, reply.view);
        s.frame = { token: s.frame.token, revision: s.frame.revision + 1, view: reply.view,
          wakeAfter: s.shown ? reply.wakeAfter : null, ready: s.shown };
      }
      return s.frame;
    } catch (error) {
      console.warn('[game] event failed', input.event, s.stage, error);
      if (this.session === s) { await this.stop(); this.deps.failed(s.ref); }
      return null;
    } finally { this.busy = false; }
  }

  async stop(): Promise<void> {
    this.generation++;
    const s = this.session; this.session = null;
    const starting = this.starting; this.starting = null;
    await Promise.all([s?.runner.stop(), starting && starting !== s?.runner ? starting.stop() : undefined]);
  }

  private allowed(s: Session, input: GameInput): boolean {
    if (input.event === 'shown') return true;
    if (input.event === 'timer') return s.frame.wakeAfter !== null && input.now - s.lastAt >= s.frame.wakeAfter - 1;
    return input.control === s.frame.view.backgroundAction || s.frame.view.nodes.some((n) => n.id === input.control
      && !n.disabled && ['button', 'tile', 'target'].includes(n.type));
  }
  private context(payload: ModulePayload): ModuleContext { return { ...this.deps.context(), texts: payload.manifest.texts }; }
}
