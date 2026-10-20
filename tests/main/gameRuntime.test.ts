import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FEATURE_CATALOG } from '../../src/features/catalog';
import { GameRuntime } from '../../src/main/gameRuntime';
import { ModuleVm } from '../../src/main/moduleVm';
import type { GameFrame, GameRef } from '../../src/shared/gameSurface';
import type { GameResult } from '../../src/shared/game';
import type { ModulePayload } from '../../src/shared/modules';

describe('GameRuntime', () => {
  const ref: GameRef = { module: 'arcade', game: 'talent', digest: 'f'.repeat(64) };
  async function setup() {
    let available = true;
    const results: GameResult[] = []; const failures: GameRef[] = [];
    const payload: ModulePayload = { format: 1, manifest: FEATURE_CATALOG[1], assets: [], script: readFileSync('src/features/arcade.js', 'utf8') };
    const runtime = new GameRuntime({ payload: () => available ? payload : null,
      context: () => ({ now: 0, lang: 'en', settings: {}, paused: false, busy: false, room: false, texts: payload.manifest.texts }),
      runner: () => {
        let vm: ModuleVm | null = null;
        return { load: async (p) => { vm = await ModuleVm.create(p); },
          game: async (event, data, context, state) => { if (!vm) throw new Error('Not loaded'); return vm.game(event, data, context, state); },
          stop: async () => { vm?.dispose(); vm = null; } };
      }, submit: (result) => results.push(result), failed: (failed) => failures.push(failed) });
    const opened = await runtime.open(ref, 'clicks', 42, 1000);
    if (!opened) throw new Error('Not opened');
    let frame: GameFrame = opened;
    let now = 1000;
    const send = async (event: 'shown' | 'input' | 'timer', control?: string, ms = 0) => {
      now += ms;
      const next = await runtime.input({ token: frame.token, revision: frame.revision, now, event, control });
      if (next) frame = next;
      return next;
    };
    return { runtime, opened, send, results, failures, frame: () => frame, unavailable: () => { available = false; } };
  }
  it('requires a displayed revision and rejects fabricated controls or stale input', async () => {
    const h = await setup();
    try {
      expect(await h.send('input', 'start')).toBeNull();
      await h.send('shown'); expect(await h.send('input', 'exec')).toBeNull();
      await h.send('input', 'start');
      expect(await h.runtime.input({ token: h.opened.token, revision: 1, event: 'input', now: 1001, control: 'start' })).toBeNull();
      await h.send('shown');
      for (let i = 0; i < 5; i++) { await h.send('input', 'pad', 100); await h.send('shown'); }
      expect(await h.send('timer', undefined, 1)).toBeNull();
      await h.send('timer', undefined, 4500);
      expect(h.results).toEqual([{ test: 'clicks', score: 10, metric: 1, accuracy: 1 }]);
      expect(h.failures).toEqual([]);
    } finally { await h.runtime.stop(); }
  });
  it('drops a retiring generation without submitting its pending result', async () => {
    const h = await setup();
    try {
      await h.send('shown'); await h.send('input', 'start'); await h.send('shown');
      h.unavailable(); expect(await h.send('timer', undefined, 5000)).toBeNull();
      expect(h.results).toEqual([]); expect(h.failures).toEqual([]);
    } finally { await h.runtime.stop(); }
  });
});
