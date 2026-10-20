import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FEATURE_CATALOG } from '../../src/features/catalog';
import { ModuleVm } from '../../src/main/moduleVm';
import { moduleObject, type ModuleContext, type ModulePayload } from '../../src/shared/modules';
import type { GameReply } from '../../src/shared/gameSurface';

export const arcadePayload: ModulePayload = { format: 1, manifest: FEATURE_CATALOG[1],
  script: readFileSync('src/features/arcade.js', 'utf8'), assets: [] };
const context: ModuleContext = { now: 0, lang: 'en', settings: {}, paused: false, busy: false, room: false,
  texts: arcadePayload.manifest.texts };

describe('arcade', () => {
  async function setup(stage: string, seed = 42) {
    const vm = await ModuleVm.create(arcadePayload);
    let now = 1000;
    let reply = vm.game('start', { game: 'talent', stage, seed, now }, context, null);
    const run = (event: string, ms = 0, control?: string): GameReply => {
      now += ms; reply = vm.game(event, { now, control }, context, reply.state); return reply;
    };
    return { run, reply: () => reply, dispose: () => vm.dispose() };
  }
  it('times five reactions from displayed frames and penalizes early clicks', async () => {
    const h = await setup('reaction');
    try {
      h.run('input', 0, 'pad'); h.run('shown'); h.run('input', 30, 'pad');
      expect(h.reply().view.nodes[0].text).toBe('Too early');
      for (let i = 0; i < 5; i++) {
        h.run('input', 20, 'pad'); h.run('shown'); h.run('timer', 2000); h.run('shown', 40);
        h.run('input', 200, 'pad');
      }
      expect(h.reply().result).toMatchObject({ test: 'reaction', metric: 200, score: 90.75 });
    } finally { h.dispose(); }
  });
  it('scores seeded aim targets and counts misses without sharing mouse traces', async () => {
    const h = await setup('aim'); const other = await setup('aim');
    try {
      h.run('input', 0, 'start'); other.run('input', 0, 'start');
      expect(h.reply().view).toEqual(other.reply().view);
      h.run('shown'); h.run('input', 10, 'miss'); h.run('shown');
      for (let i = 0; i < 20; i++) { h.run('input', 250, 'target'); if (i < 19) h.run('shown'); }
      expect(h.reply().result?.metric).toBe(250.5);
      expect(h.reply().result?.accuracy).toBeCloseTo(20 / 21, 3);
      expect(h.reply().result?.score).toBeGreaterThan(80);
    } finally { h.dispose(); other.dispose(); }
  });
  it('caps aim time and counts only pointer inputs before the click deadline', async () => {
    const h = await setup('clicks'); const a = await setup('aim');
    try {
      h.run('input', 0, 'start'); h.run('shown');
      for (let i = 0; i < 30; i++) h.run('input', 100, 'pad');
      h.run('timer', 2000);
      expect(h.reply().result).toMatchObject({ test: 'clicks', score: 60, metric: 6 });
      a.run('input', 0, 'start'); a.run('shown'); a.run('timer', 45000);
      expect(a.reply().result).toMatchObject({ test: 'aim', score: 0 });
    } finally { h.dispose(); a.dispose(); }
  });
  it('defers completion to a timer if displaying a frame crosses its deadline', async () => {
    const h = await setup('clicks');
    try {
      h.run('input', 0, 'start'); h.run('shown'); h.run('input', 4900, 'pad');
      const delayed = h.run('shown', 200);
      expect(delayed.result).toBeUndefined(); expect(delayed.wakeAfter).toBe(16);
      expect(h.run('timer', 16).result).toMatchObject({ test: 'clicks', metric: .2 });
    } finally { h.dispose(); }
  });
  it('plays the full seeded memory sequence and stops on a wrong or timed-out answer', async () => {
    const h = await setup('sequence');
    try {
      h.run('input', 0, 'start');
      for (let level = 1; level <= 8; level++) {
        for (let step = 0; step < level * 2; step++) { const shown = h.run('shown'); h.run('timer', shown.wakeAfter ?? 0); }
        h.run('shown');
        const raw = h.reply().state;
        if (!moduleObject(raw) || !Array.isArray(raw.sequence)) throw new Error('Missing sequence');
        for (const tile of raw.sequence.slice(0, level)) h.run('input', 20, `tile${tile}`);
      }
      expect(h.reply().result).toMatchObject({ test: 'sequence', score: 100, metric: 8 });
    } finally { h.dispose(); }
    const wrong = await setup('sequence');
    try {
      wrong.run('input', 0, 'start'); wrong.run('shown'); wrong.run('timer', 260); wrong.run('shown'); wrong.run('timer', 180);
      wrong.run('shown'); wrong.run('timer', 15000);
      expect(wrong.reply().result).toMatchObject({ test: 'sequence', score: 0 });
    } finally { wrong.dispose(); }
  });
  it('rejects arbitrary HTML, over-budget output and infinite game scripts', async () => {
    for (const body of ["return {state:null,view:{html:'<script/>'},wakeAfter:null}", 'for (;;) {}',
      "return {state:'x'.repeat(20000),view:{},wakeAfter:null}"]) {
      const vm = await ModuleVm.create({ ...arcadePayload, script: `feature={handle(){return {commands:[],state:null}},game(){${body}}}` });
      try { expect(() => vm.game('start', {}, context, null)).toThrow(); } finally { vm.dispose(); }
    }
  });
});
