import variant from '@jitl/quickjs-singlefile-cjs-release-sync';
import { newQuickJSWASMModuleFromVariant, type QuickJSContext, type QuickJSRuntime } from 'quickjs-emscripten-core';
import { performance } from 'node:perf_hooks';
import { moduleCommand, moduleJson, moduleObject, type ModuleCommand, type ModuleContext, type ModulePayload } from '../shared/modules';
import { gameView, type GameReply } from '../shared/gameSurface';
import { normalizeGameResult } from '../shared/game';
import { sessionView, type SessionReply } from '../shared/gameSession';

export interface VmReply { commands: ModuleCommand[]; state: unknown }

/** Guest JavaScript has no Node, DOM, filesystem or network objects. Every output is validated. */
export class ModuleVm {
  private deadline = 0;
  private constructor(
    private readonly runtime: QuickJSRuntime,
    private readonly context: QuickJSContext,
    private readonly payload: ModulePayload,
    private readonly now: () => number,
  ) {
    runtime.setMemoryLimit(16 * 1024 * 1024);
    runtime.setMaxStackSize(256 * 1024);
    runtime.setInterruptHandler(() => this.now() > this.deadline);
  }

  static async create(payload: ModulePayload, now: () => number = () => performance.now()): Promise<ModuleVm> {
    const engine = await newQuickJSWASMModuleFromVariant(variant);
    const runtime = engine.newRuntime();
    const context = runtime.newContext();
    const vm = new ModuleVm(runtime, context, payload, now);
    try {
      vm.eval(`'use strict'; globalThis.feature = undefined;\n${payload.script}`, 150);
      vm.eval(`if (!feature || typeof feature.handle !== 'function') throw Error('Missing feature.handle');`);
      return vm;
    } catch (error) {
      vm.dispose();
      throw error;
    }
  }

  handle(event: string, data: unknown, context: ModuleContext, state: unknown): VmReply {
    const input = moduleJson({ event, data, context, state }, 48 * 1024);
    if (input === null) throw new Error('Invalid input');
    const output = this.eval(`JSON.stringify(feature.handle(JSON.parse(${JSON.stringify(input)})))`);
    if (typeof output !== 'string' || output.length > 64 * 1024) throw new Error('Invalid output');
    const raw: unknown = JSON.parse(output);
    if (!moduleObject(raw) || !Array.isArray(raw.commands) || raw.commands.length > 16 || moduleJson(raw.state) === null) {
      throw new Error('Invalid output');
    }
    if (!this.payload.manifest.capabilities.includes('storage') && raw.state !== null) throw new Error('Storage denied');
    const commands: ModuleCommand[] = [];
    for (const value of raw.commands) {
      const command = moduleCommand(value, this.payload.manifest, this.payload.assets);
      if (!command) throw new Error('Capability or command denied');
      commands.push(command);
    }
    return { commands, state: raw.state };
  }

  game(event: string, data: unknown, context: ModuleContext, state: unknown): GameReply {
    if (!this.payload.manifest.capabilities.includes('games')) throw new Error('Games denied');
    const input = moduleJson({ event, data, context, state }, 48 * 1024);
    if (!input) throw new Error('Invalid game input');
    const output = this.eval(`JSON.stringify(feature.game(JSON.parse(${JSON.stringify(input)})))`);
    if (typeof output !== 'string' || output.length > 64 * 1024) throw new Error('Invalid game output');
    const raw: unknown = JSON.parse(output);
    if (!moduleObject(raw) || moduleJson(raw.state) === null) throw new Error('Invalid game state');
    const view = gameView(raw.view, ['builtin:ping', ...this.payload.assets.filter((a) => a.mime.startsWith('image/')).map((a) => a.name)]);
    if (!view || raw.wakeAfter !== null && (typeof raw.wakeAfter !== 'number' || !Number.isFinite(raw.wakeAfter)
      || raw.wakeAfter < 16 || raw.wakeAfter > 60_000)) throw new Error('Invalid game view');
    const result = raw.result === undefined ? undefined : normalizeGameResult(raw.result);
    if (result === null) throw new Error('Invalid game result');
    return { state: raw.state, view, wakeAfter: raw.wakeAfter as number | null, ...(result ? { result } : {}) };
  }

  private eval(code: string, budget = 30): unknown {
    this.deadline = this.now() + budget;
    const result = this.context.evalCode(code, 'feature.js', { type: 'global' });
    try {
      if (result.error) throw new Error('Feature execution failed');
      return this.context.dump(result.value) as unknown;
    } finally { result.dispose(); }
  }

  session(event: string, data: unknown, context: ModuleContext, state: unknown): SessionReply {
    if (!this.payload.manifest.capabilities.includes('games')) throw new Error('Games denied');
    const input = moduleJson({ event, data, context, state }, 160 * 1024);
    if (!input) throw new Error('Invalid session input');
    const output = this.eval(`JSON.stringify(feature.session(JSON.parse(${JSON.stringify(input)})))`, 150);
    if (typeof output !== 'string' || output.length > 256 * 1024) throw new Error('Invalid session output');
    const raw: unknown = JSON.parse(output);
    if (!moduleObject(raw) || moduleJson(raw.state, 128 * 1024) === null || typeof raw.accepted !== 'boolean') throw new Error('Invalid session state');
    const view = sessionView(raw.view);
    if (!view) throw new Error('Invalid session view');
    return { state: raw.state, view, accepted: raw.accepted };
  }

  dispose(): void {
    this.context.dispose();
    this.runtime.dispose();
  }
}
