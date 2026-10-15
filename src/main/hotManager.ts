import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { HOT_MAX_BYTES, hotBundle, hotCompatible, type BuildIdentity, type HotBundle, type HotInvitation, type HotState } from '../shared/hotUpdate';
import {
  MODULE_API, MODULE_ID, moduleCommand, moduleJson, moduleObject, moduleValues,
  type ModuleCommand, type ModuleContext, type ModuleError, type ModulePayload, type ModuleResult, type ModuleValues,
} from '../shared/modules';
import { ModuleRunner } from './moduleRunner';
import { HotSource } from './hotSource';
import { RateLimiter } from './rateLimiter';

interface ActiveModule {
  payload: ModulePayload;
  runner: Pick<ModuleRunner, 'handle' | 'stop'>;
  settings: ModuleValues;
  state: unknown;
  enabled: boolean;
  failed: boolean;
  digest: string;
}
interface Snapshot { bundle: HotBundle; values: Record<string, { settings: ModuleValues; state: unknown; enabled: boolean }> }
interface HotDeps {
  dir: string;
  worker: string;
  identity: BuildIdentity;
  builtin: HotBundle;
  source: Pick<HotSource, 'latest' | 'newer' | 'download'>;
  runner?(payload: ModulePayload): Promise<Pick<ModuleRunner, 'handle' | 'stop'>>;
  context(): Omit<ModuleContext, 'settings'>;
  hydration(): ModuleValues;
  command(module: string, commit: string, command: ModuleCommand, payload: ModulePayload): void;
  clear(): void;
  verifyPublisher(commit: string): Promise<void>;
  publish(commit: string, digest: string): ModuleResult;
}

/** Stage all modules before switching. Disk snapshots include the previous commit for recovery and rollback. */
export class HotManager extends EventEmitter {
  private active = new Map<string, ActiveModule>();
  private current: HotBundle;
  private previous: Snapshot | null = null;
  private phase: HotState['phase'] = 'idle';
  private progress = 0;
  private release: HotState['release'] = null;
  private invitation: HotInvitation | null = null;
  private error: ModuleError | null = null;
  private closed = false;
  private busy = false;
  private ticking = false;
  private timer: NodeJS.Timeout | null = null;
  private controller: AbortController | null = null;
  private completed: Promise<void> | null = null;
  private queuedContexts = 0;
  private ticksSinceSave = 0;
  private queue = Promise.resolve();
  private writes = Promise.resolve();
  private readonly outputLimit: RateLimiter;
  private stopPromise: Promise<void> | null = null;
  private rollbackScheduled = false;
  get commit(): string { return this.current.commit; }

  constructor(private readonly deps: HotDeps) {
    super();
    this.current = deps.builtin;
    this.outputLimit = new RateLimiter(() => deps.context().now);
  }

  async start(): Promise<void> {
    let snapshot: Snapshot = { bundle: this.current, values: {} };
    try {
      const size = (await stat(join(this.deps.dir, 'active.json'))).size;
      if (size > HOT_MAX_BYTES * 2 + 512 * 1024) throw new Error('limit');
      const stored = await readFile(join(this.deps.dir, 'active.json'), 'utf8');
      if (Buffer.byteLength(stored) > HOT_MAX_BYTES * 2 + 512 * 1024) throw new Error('limit');
      const raw: unknown = JSON.parse(stored);
      if (moduleObject(raw)) {
        const loaded = this.snapshot(raw.current);
        if (raw.host === this.deps.identity.host && raw.baseCommit === this.deps.identity.commit) {
          this.previous = this.snapshot(raw.previous);
          if (loaded) snapshot = loaded;
          else if (this.previous) { snapshot = this.previous; this.previous = null; }
        } else if (loaded) snapshot = { bundle: this.deps.builtin, values: loaded.values };
      }
    } catch { /* A missing or corrupt snapshot falls back to the bundled scripts. */ }
    try { this.active = await this.stage(snapshot); this.current = snapshot.bundle; }
    catch {
      snapshot = this.previous ?? { bundle: this.deps.builtin, values: snapshot.values };
      this.previous = null;
      try { this.active = await this.stage(snapshot); }
      catch {
        snapshot = { bundle: this.deps.builtin, values: snapshot.values };
        this.active = await this.stage(snapshot);
      }
      this.current = snapshot.bundle;
    }
    this.timer = setInterval(() => {
      if (this.busy || this.ticking || this.closed || this.phase === 'activating') return;
      this.ticking = true;
      this.queue = this.queue.then(async () => {
        await this.dispatch('tick', null);
        if (++this.ticksSinceSave >= 30 && !this.closed) {
          this.ticksSinceSave = 0;
          await this.persist(this.capture(), this.previous).catch(() => { this.error = 'disk'; this.emitState(); });
        }
      }).finally(() => { this.ticking = false; });
    }, 1000);
    this.emitState();
  }

  state(): HotState {
    return {
      commit: this.current.commit, api: MODULE_API, phase: this.phase, release: this.release, invitation: this.invitation,
      progress: this.progress,
      canRollback: this.previous !== null, error: this.error,
      modules: [...this.active.values()].map((m) => ({ manifest: m.payload.manifest,
        digest: m.digest, commit: this.current.commit,
        enabled: m.enabled, phase: m.failed ? 'error' : !m.enabled ? 'disabled' : this.deps.context().paused ? 'paused' : 'running',
        settings: this.values(m), ...(m.failed ? { error: 'runtime' as const } : {}),
      })),
    };
  }
  offer(invitation: HotInvitation): void {
    if (invitation.commit === this.current.commit || this.invitation?.commit === invitation.commit) return;
    this.invitation = { ...invitation };
    this.emitState();
  }
  dismiss(): void { this.invitation = null; this.emitState(); }
  cancel(): void { this.controller?.abort(); }
  contextChanged(): void {
    this.emitState();
    if (this.closed || this.phase === 'activating' || this.active.size === 0 || this.queuedContexts >= 16) return;
    const context = this.deps.context();
    this.queuedContexts++;
    this.queue = this.queue.then(() => this.dispatch('settings', null, undefined, context))
      .finally(() => { this.queuedContexts--; });
  }

  private async operation(fn: (signal: AbortSignal) => Promise<void>): Promise<ModuleResult> {
    if (this.controller || this.closed || this.busy) return { ok: false, error: 'busy' };
    const controller = new AbortController();
    this.controller = controller;
    let finish = (): void => undefined;
    this.completed = new Promise<void>((resolve) => { finish = resolve; });
    const timeout = setTimeout(() => controller.abort(), 60_000);
    this.error = null;
    this.progress = 0;
    try {
      await this.queue;
      if (controller.signal.aborted || this.closed) throw new Error('cancelled');
      await fn(controller.signal);
      return { ok: true };
    }
    catch (error) {
      const code = error instanceof Error ? error.message : '';
      const known: ModuleError[] = ['invalid', 'incompatible', 'notNewer', 'wrongRemote', 'dirty', 'notPushed', 'notBuilt',
        'notInRoom', 'paused', 'noPeers', 'rateLimited', 'busy', 'runtime', 'disk', 'cancelled'];
      this.error = known.includes(code as ModuleError) ? code as ModuleError : controller.signal.aborted ? 'timeout' : 'network';
      this.phase = 'error'; return { ok: false, error: this.error };
    } finally {
      clearTimeout(timeout); this.controller = null; finish(); this.completed = null;
      this.emitState();
    }
  }

  async push(): Promise<ModuleResult> {
    if (!this.deps.context().room) return { ok: false, error: 'notInRoom' };
    if (this.deps.context().paused) return { ok: false, error: 'paused' };
    return this.operation(async (signal) => {
      this.phase = 'checking'; this.emitState();
      const latest = await this.deps.source.latest(signal);
      if (!hotCompatible(latest, this.deps.identity)) throw new Error('incompatible');
      await this.deps.verifyPublisher(latest.commit);
      const confirmed = await this.deps.source.latest(signal);
      if (confirmed.commit !== latest.commit || confirmed.bundle.sha256 !== latest.bundle.sha256) throw new Error('notBuilt');
      if (signal.aborted || this.closed) throw new Error('cancelled');
      const result = this.deps.publish(latest.commit, latest.bundle.sha256);
      if (!result.ok) throw new Error(result.error);
      this.release = latest; this.phase = 'available';
    });
  }

  async accept(): Promise<ModuleResult> {
    const offered = this.invitation ? { ...this.invitation } : null;
    return this.operation(async (signal) => {
      this.phase = 'checking'; this.emitState();
      const latest = await this.deps.source.latest(signal);
      if (offered && (latest.commit !== offered.commit || latest.bundle.sha256 !== offered.digest)) throw new Error('notBuilt');
      if (!hotCompatible(latest, this.deps.identity)) throw new Error('incompatible');
      if (!await this.deps.source.newer(this.current.commit, latest.commit, signal)) throw new Error('notNewer');
      this.release = latest; this.phase = 'downloading'; this.emitState();
      const bundle = await this.deps.source.download(latest, signal, (fraction) => {
        this.progress = Math.round(fraction * 80); this.emitState();
      });
      const confirmed = await this.deps.source.latest(signal);
      if (confirmed.commit !== latest.commit || confirmed.bundle.sha256 !== latest.bundle.sha256) throw new Error('notBuilt');
      if (signal.aborted || this.closed) throw new Error('cancelled');
      this.phase = 'activating'; this.progress = 90; this.emitState();
      await this.queue;
      const old = this.capture();
      const next: Snapshot = { bundle, values: old.values };
      const staged = await this.stage(next);
      try {
        if (signal.aborted || this.closed) throw new Error('cancelled');
        await this.persist(this.captureOf(bundle, staged), old);
        if (signal.aborted || this.closed) {
          await this.persist(old, this.previous);
          throw new Error('cancelled');
        }
      } catch (error) { await this.stopModules(staged); throw error; }
      const retiring = this.active;
      this.deps.clear(); this.active = staged; this.current = bundle; this.previous = old;
      this.outputLimit.clear();
      this.invitation = null; this.phase = 'idle'; this.progress = 100;
      await this.stopModules(retiring);
    });
  }

  async rollback(): Promise<ModuleResult> {
    if (!this.previous) return { ok: false, error: 'missing' };
    const target = this.previous;
    return this.operation(async (signal) => {
      this.phase = 'activating'; this.emitState(); await this.queue;
      const staged = await this.stage(target);
      const old = this.capture();
      try {
        if (signal.aborted || this.closed) throw new Error('cancelled');
        await this.persist(this.captureOf(target.bundle, staged), null);
        if (signal.aborted || this.closed) {
          await this.persist(old, target);
          throw new Error('cancelled');
        }
      }
      catch (error) { await this.stopModules(staged); throw error; }
      const retiring = this.active;
      this.deps.clear(); this.active = staged; this.current = target.bundle; this.previous = null; this.phase = 'idle';
      this.outputLimit.clear();
      await this.stopModules(retiring);
    });
  }

  async configure(id: string, raw: unknown): Promise<ModuleResult> {
    if (this.closed) return { ok: false, error: 'cancelled' };
    if (!MODULE_ID.test(id) || this.controller || this.busy) return { ok: false, error: 'busy' };
    const m = this.active.get(id);
    if (!m || !moduleObject(raw)) return { ok: false, error: 'invalid' };
    this.busy = true;
    const oldSettings = m.settings;
    const oldEnabled = m.enabled;
    try {
      m.settings = moduleValues(m.payload.manifest.settings, { ...m.settings, ...raw });
      if (typeof raw.moduleEnabled === 'boolean') m.enabled = raw.moduleEnabled;
      await this.queue;
      if (this.closed) { m.settings = oldSettings; m.enabled = oldEnabled; return { ok: false, error: 'cancelled' }; }
      await this.persist(this.capture(), this.previous); this.deps.clear(); this.emitState(); return { ok: true };
    } catch { m.settings = oldSettings; m.enabled = oldEnabled; return { ok: false, error: 'disk' }; }
    finally { this.busy = false; }
  }

  async action(id: string, key: string): Promise<ModuleResult> {
    if (this.closed) return { ok: false, error: 'cancelled' };
    const m = this.active.get(id);
    if (!m || !m.payload.manifest.actions.some((a) => a.key === key)) return { ok: false, error: 'invalid' };
    if (!m.enabled || this.deps.context().paused) return { ok: false, error: 'paused' };
    if (this.busy || this.controller) return { ok: false, error: 'busy' };
    this.busy = true;
    try {
      this.queue = this.queue.then(() => this.dispatch('action', key, id));
      await this.queue;
      return m.failed ? { ok: false, error: 'runtime' } : { ok: true };
    }
    finally { this.busy = false; }
  }

  async roomEvent(data: unknown): Promise<void> {
    if (!moduleObject(data) || typeof data.module !== 'string' || !MODULE_ID.test(data.module)) return;
    const id = data.module;
    if (this.busy || this.controller || this.closed) return;
    this.busy = true;
    try {
      this.queue = this.queue.then(() => this.dispatch('room.message', data, id));
      await this.queue;
    } finally { this.busy = false; }
  }

  private values(m: ActiveModule): ModuleValues {
    return m.payload.manifest.id === 'hydration' ? moduleValues(m.payload.manifest.settings, { ...m.settings, ...this.deps.hydration() }) : m.settings;
  }
  private async dispatch(event: string, data: unknown, only?: string, captured?: Omit<ModuleContext, 'settings'>): Promise<void> {
    if (this.closed || this.phase === 'activating') return;
    for (const [id, m] of this.active) {
      if (only && id !== only || m.failed || !m.enabled) continue;
      if (event === 'tick' && !m.payload.manifest.capabilities.includes('timers')) continue;
      if (event === 'room.message' && !m.payload.manifest.capabilities.includes('room.receive')) continue;
      const base = captured ?? this.deps.context();
      const context = { ...base, texts: { ...base.texts, ...m.payload.manifest.texts }, settings: this.values(m) };
      try {
        const reply = await m.runner.handle(event, data, context, m.state);
        if (this.closed) return;
        m.state = reply.state;
        if (context.paused || event === 'settings') continue;
        for (const raw of reply.commands) {
          const command = moduleCommand(raw, m.payload.manifest, m.payload.assets);
          if (!command) throw new Error('runtime');
          const budget = command.op === 'sound' ? 'sound' : command.op === 'publish' ? 'publish' : 'overlay';
          const rate = budget === 'overlay' ? 4 : 1;
          const burst = budget === 'overlay' ? 8 : 2;
          if (!this.outputLimit.allow('all', 12, 24) || !this.outputLimit.allow(`${id}:${budget}`, rate, burst)) continue;
          this.deps.command(id, this.current.commit, command, m.payload);
        }
      } catch {
        m.failed = true; this.deps.clear(); await m.runner.stop(); this.error = 'runtime'; this.emitState();
        if (this.previous && !this.rollbackScheduled) {
          this.rollbackScheduled = true;
          setImmediate(() => {
            this.rollbackScheduled = false;
            if (this.controller) { this.controller.abort(); void this.completed?.then(() => this.rollback()); }
            else void this.rollback();
          });
          return;
        }
      }
    }
  }

  private async stage(snapshot: Snapshot): Promise<Map<string, ActiveModule>> {
    const staged = new Map<string, ActiveModule>();
    try {
      for (const payload of snapshot.bundle.modules) {
        const saved = snapshot.values[payload.manifest.id];
        const runner = this.deps.runner ? await this.deps.runner(payload)
          : new ModuleRunner(new Worker(this.deps.worker, { resourceLimits: { maxOldGenerationSizeMb: 64 } }));
        const m: ActiveModule = { payload, runner, settings: moduleValues(payload.manifest.settings, saved?.settings),
          state: saved?.state ?? null, enabled: saved?.enabled !== false, failed: false,
          digest: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
        staged.set(payload.manifest.id, m);
        if (runner instanceof ModuleRunner) await runner.load(payload);
        const context = this.deps.context();
        const reply = await runner.handle('activate', null, { ...context,
          texts: { ...context.texts, ...payload.manifest.texts }, settings: this.values(m) }, m.state);
        m.state = reply.state;
      }
      return staged;
    } catch { await this.stopModules(staged); throw new Error('runtime'); }
  }

  private snapshot(raw: unknown): Snapshot | null {
    if (!moduleObject(raw) || !moduleObject(raw.bundle) || typeof raw.bundle.commit !== 'string') return null;
    const bundle = hotBundle(raw.bundle, raw.bundle.commit);
    if (!bundle || !moduleObject(raw.values)) return null;
    const values: Snapshot['values'] = Object.create(null) as Snapshot['values'];
    for (const p of bundle.modules) {
      const v = raw.values[p.manifest.id];
      if (moduleObject(v)) values[p.manifest.id] = { settings: moduleValues(p.manifest.settings, v.settings),
        state: moduleJson(v.state) !== null ? v.state : null, enabled: v.enabled !== false };
    }
    return { bundle, values };
  }
  private capture(): Snapshot {
    return this.captureOf(this.current, this.active);
  }
  private captureOf(bundle: HotBundle, modules: Map<string, ActiveModule>): Snapshot {
    const values: Snapshot['values'] = Object.create(null) as Snapshot['values'];
    for (const [id, m] of modules) values[id] = { settings: m.settings, state: m.state, enabled: m.enabled };
    return { bundle, values };
  }
  private persist(current: Snapshot, previous: Snapshot | null): Promise<void> {
    const json = JSON.stringify({ host: this.deps.identity.host, baseCommit: this.deps.identity.commit, current, previous });
    const write = this.writes.then(async () => {
      await mkdir(this.deps.dir, { recursive: true });
      const target = join(this.deps.dir, 'active.json');
      await writeFile(`${target}.tmp`, json);
      await rename(`${target}.tmp`, target);
    }).catch(() => { throw new Error('disk'); });
    this.writes = write.catch(() => undefined);
    return write;
  }
  private async stopModules(modules: Map<string, ActiveModule>): Promise<void> {
    await Promise.all([...modules.values()].map((m) => m.runner.stop()));
  }
  private emitState(): void { if (!this.closed) this.emit('state', this.state()); }
  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.closed = true; this.controller?.abort(); if (this.timer) clearInterval(this.timer);
    this.stopPromise = (async () => {
      await this.completed; await this.queue;
      await this.persist(this.capture(), this.previous).catch(() => undefined); await this.stopModules(this.active);
    })();
    return this.stopPromise;
  }
}
