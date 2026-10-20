import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FEATURE_CATALOG } from '../../src/features/catalog';
import { HotManager } from '../../src/main/hotManager';
import { GameRuntime } from '../../src/main/gameRuntime';
import { isHotHostFile } from '../../src/shared/hotGitTree';
import type { HotBundle, HotRelease } from '../../src/shared/hotUpdate';
import type { ModulePayload } from '../../src/shared/modules';
import type { GameResult } from '../../src/shared/game';
import { UPDATE_REPOSITORY } from '../../src/shared/project';
import { tabletopPayload, tabletopContext } from './fixtures/tabletop';

let dir: string;
let worker: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lolping-hot-games-')); worker = join(dir, 'worker.cjs');
  await build({ entryPoints: ['src/main/moduleWorker.ts'], outfile: worker, platform: 'node', format: 'cjs', bundle: true });
});
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

describe('hot game updates', () => {
  const old: ModulePayload = { format: 1, manifest: FEATURE_CATALOG[1], assets: [], script: readFileSync('src/features/arcade.js', 'utf8') };
  const base = 'a'.repeat(40); const commit = 'b'.repeat(40); const host = 'c'.repeat(64);
  async function setup(payload: ModulePayload) {
    const builtin: HotBundle = { format: 1, commit: base, modules: [old] };
    const release: HotRelease = { format: 1, api: 1, repository: UPDATE_REPOSITORY, commit, host,
      bundle: { name: 'lolPing-features.json', bytes: 1000, sha256: 'd'.repeat(64) } };
    const snapshotDir = await mkdtemp(join(dir, 'snapshot-'));
    const manager = new HotManager({ dir: snapshotDir, worker, identity: { commit: base, host, dirty: false }, builtin,
      source: { latest: async () => release, newer: async () => true, download: async () => ({ ...builtin, commit, modules: [payload] }) },
      context: () => ({ now: 0, lang: 'en', paused: false, busy: false, room: false, texts: {} }),
      hydration: () => ({}), command: () => undefined, clear: () => undefined, verifyPublisher: async () => undefined,
      publish: () => ({ ok: true }) });
    await manager.start(); return manager;
  }
  it('activates a new catalog entry, interface and score script in the same host and rolls it back', async () => {
    const definition = old.manifest.games?.find((g) => g.id === 'talent');
    const stage = definition?.stages.find((s) => s.id === 'clicks');
    if (!definition || !stage) throw new Error('Missing game');
    const updated: ModulePayload = { ...old, manifest: { ...old.manifest, games: [...old.manifest.games ?? [], { ...definition, id: 'remix', stages: [stage] }] },
      script: old.script.replace('s.hits * 2', 's.hits * 3').replace("layout: 'pad', tone: 'accent'", "layout: 'pad', tone: 'danger'") };
    const manager = await setup(updated); const results: GameResult[] = [];
    const runtime = new GameRuntime({ payload: (ref) => manager.games().find((g) => g.digest === ref.digest)?.payload ?? null,
      context: () => ({ now: 0, lang: 'en', paused: false, busy: false, room: false, texts: {}, settings: {} }),
      runner: () => GameRuntime.worker(worker), submit: (result) => results.push(result), failed: () => undefined });
    try {
      expect(manager.games()[0].payload.manifest.games).toHaveLength(1);
      expect(await manager.accept()).toEqual({ ok: true });
      const pack = manager.games()[0]; expect(pack.payload.manifest.games).toHaveLength(2);
      expect(pack.digest).toBe(createHash('sha256').update(JSON.stringify(updated)).digest('hex'));
      let frame = await runtime.open({ module: 'arcade', game: 'remix', digest: pack.digest }, 'clicks', 42, 1000);
      if (!frame) throw new Error('Game not loaded');
      const send = async (event: string, now: number, control?: string) => {
        if (!frame) throw new Error('Missing frame');
        if (event === 'shown' && frame.ready) return;
        frame = await runtime.input({ token: frame.token, revision: frame.revision, event, now, control });
      };
      await send('shown', 1000); await send('input', 1010, 'start'); await send('shown', 1020);
      expect(frame?.view.tone).toBe('danger');
      for (let i = 1; i <= 5; i++) { await send('input', 1020 + i * 100, 'pad'); await send('shown', 1020 + i * 100); }
      await send('timer', 6020);
      expect(results).toEqual([{ test: 'clicks', metric: 1, score: 15, accuracy: 1 }]);
      expect(await manager.rollback()).toEqual({ ok: true });
      expect(manager.games()[0].payload.manifest.games).toHaveLength(1);
      expect(manager.commit).toBe(base);
      for (const path of ['src/features/catalog.ts', 'src/features/arcade.js', 'src/shared/i18n.ts']) expect(isHotHostFile(path)).toBe(false);
    } finally { await runtime.stop(); await manager.stop(); }
  });
  it('keeps the current catalog if a game fails its isolated activation check', async () => {
    const manager = await setup({ ...old, script: "feature={handle(){return {commands:[],state:null}},game(){return {state:null,view:{html:'bad'},wakeAfter:null}}}" });
    try {
      expect(await manager.accept()).toEqual({ ok: false, error: 'runtime' });
      expect(manager.commit).toBe(base); expect(manager.games()[0].payload.script).toBe(old.script);
    } finally { await manager.stop(); }
  });
  it('activates shared room rules in real session workers and rolls back without changing the host', async () => {
    const manager = await setup(tabletopPayload);
    const runner = GameRuntime.worker(worker);
    try {
      expect(await manager.accept()).toEqual({ ok: true });
      const pack = manager.games()[0];
      expect(pack.payload.manifest.games).toHaveLength(4);
      await runner.load(pack.payload);
      const reply = await runner.session('start', { game: 'paintjob', peers: ['a'.repeat(16), 'b'.repeat(16)],
        host: 'a'.repeat(16), self: 'a'.repeat(16), seed: 42, now: 0 }, tabletopContext, null);
      expect(reply.view.choices).toHaveLength(3);
      expect(await manager.rollback()).toEqual({ ok: true });
      expect(manager.commit).toBe(base);
      expect(manager.games()[0].payload.manifest.id).toBe('arcade');
    } finally { await runner.stop(); await manager.stop(); }
  });
  it('restores the previous generation when a staged game later fails during input', async () => {
    const updated = { ...old, script: old.script.replace('const now = data.now;', "if (event === 'input') throw Error('broken'); const now = data.now;") };
    const manager = await setup(updated);
    try {
      expect(await manager.accept()).toEqual({ ok: true });
      const pack = manager.games()[0];
      const restored = new Promise<void>((resolve) => {
        manager.on('state', s => { if (s.commit === base && s.phase === 'idle') resolve(); });
      });
      await manager.gameFailed('arcade', pack.digest); await restored;
      expect(manager.games()[0].payload.script).toBe(old.script);
      expect(manager.state().canRollback).toBe(false);
    } finally { await manager.stop(); }
  });
});
