import variant from '@jitl/quickjs-singlefile-cjs-release-sync';
import { newQuickJSWASMModuleFromVariant, type QuickJSContext, type QuickJSRuntime } from 'quickjs-emscripten-core';
import { performance } from 'node:perf_hooks';
import { moduleCommand, moduleJson, moduleObject, type ModuleCommand, type ModuleContext, type ModulePayload } from '../shared/modules';

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
      vm.eval(`'use strict'; globalThis.feature = undefined;\n${payload.script}`);
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

  private eval(code: string): unknown {
    this.deadline = this.now() + 30;
    const result = this.context.evalCode(code, 'feature.js', { type: 'global' });
    try {
      if (result.error) throw new Error('Feature execution failed');
      return this.context.dump(result.value) as unknown;
    } finally { result.dispose(); }
  }

  dispose(): void {
    this.context.dispose();
    this.runtime.dispose();
  }
}
