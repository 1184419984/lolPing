import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FEATURE_CATALOG } from '../../src/features/catalog';
import { ModuleRunner } from '../../src/main/moduleRunner';
import { readFileSync } from 'node:fs';

let dir: string;
let worker: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lolping-worker-'));
  worker = join(dir, 'worker.cjs');
  await build({ entryPoints: ['src/main/moduleWorker.ts'], outfile: worker, platform: 'node', format: 'cjs', bundle: true });
});
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

describe('ModuleRunner', () => {
  it('executes the hydration preview through a real isolated worker', async () => {
    const runner = new ModuleRunner(new Worker(worker));
    try {
      await runner.load({ format: 1, manifest: FEATURE_CATALOG[0], script: readFileSync('src/features/hydration.js', 'utf8'), assets: [] });
      const reply = await runner.handle('action', 'preview', { now: 1000, lang: 'en',
        settings: { enabled: false, intervalMin: 30, durationS: 8 }, paused: false, busy: false, room: false,
        texts: FEATURE_CATALOG[0].texts }, null);
      expect(reply.commands[0]).toMatchObject({ op: 'show', scene: { animation: 'fullscreen' } });
      expect(reply.commands[1]).toMatchObject({ op: 'sound', asset: 'builtin:Base' });
    } finally { await runner.stop(); }
  });
  it('rejects a guest infinite loop while keeping the host available', async () => {
    const runner = new ModuleRunner(new Worker(worker));
    try {
      await runner.load({ format: 1, manifest: FEATURE_CATALOG[0], script: 'globalThis.feature={handle(){for (;;) {}}};', assets: [] });
      await expect(runner.handle('tick', null, { now: 0, lang: 'en', settings: {}, paused: false,
        busy: false, room: false, texts: {} }, null)).rejects.toThrow();
      const reply = await runner.handle('activate', null, { now: 0, lang: 'en', settings: {}, paused: false,
        busy: false, room: false, texts: {} }, null).then(() => 'unexpected', () => 'interrupted');
      expect(reply).toBe('interrupted');
    } finally { await runner.stop(); }
  });
});
