import { Worker } from 'node:worker_threads';
import { moduleObject, type ModuleContext, type ModulePayload } from '../shared/modules';
import type { VmReply } from './moduleVm';
import type { GameReply } from '../shared/gameSurface';
import type { SessionReply } from '../shared/gameSession';

/** A hung guest can be terminated without blocking Electron or the native input helper. */
export class ModuleRunner {
  private seq = 0;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  private closed = false;
  constructor(private readonly worker: Worker) {
    worker.on('message', (raw: unknown) => {
      if (!moduleObject(raw) || typeof raw.id !== 'number') return;
      const p = this.pending.get(raw.id);
      if (!p) return;
      this.pending.delete(raw.id);
      clearTimeout(p.timer);
      if (raw.ok === true) p.resolve(raw.reply);
      else p.reject(new Error('Feature execution failed'));
    });
    worker.on('error', () => this.fail());
    worker.on('exit', () => this.fail());
  }
  async load(payload: ModulePayload): Promise<void> {
    await this.request({ op: 'load', payload }, 10_000);
  }
  async handle(event: string, data: unknown, context: ModuleContext, state: unknown): Promise<VmReply> {
    const reply = await this.request({ op: 'event', event, data, context, state }, 1000);
    if (!moduleObject(reply) || !Array.isArray(reply.commands)) throw new Error('Invalid worker reply');
    return reply as unknown as VmReply;
  }
  async game(event: string, data: unknown, context: ModuleContext, state: unknown): Promise<GameReply> {
    const reply = await this.request({ op: 'game', event, data, context, state }, 1000);
    if (!moduleObject(reply)) throw new Error('Invalid game reply');
    return reply as unknown as GameReply;
  }
  private request(body: Record<string, unknown>, timeout: number): Promise<unknown> {
    if (this.closed || this.pending.size >= 1) return Promise.reject(new Error('Worker unavailable'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.fail(); void this.worker.terminate(); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.worker.postMessage({ ...body, id }); }
      catch { this.fail(); }
    });
  }
  async session(event: string, data: unknown, context: ModuleContext, state: unknown): Promise<SessionReply> {
    const reply = await this.request({ op: 'session', event, data, context, state }, 1000);
    if (!moduleObject(reply)) throw new Error('Invalid session reply');
    return reply as unknown as SessionReply;
  }
  private fail(): void {
    this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Worker stopped')); }
    this.pending.clear();
  }
  async stop(): Promise<void> {
    this.fail();
    await this.worker.terminate();
  }
}
