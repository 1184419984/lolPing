import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FEATURE_CATALOG } from '../../src/features/catalog';
import { ModuleVm } from '../../src/main/moduleVm';
import { moduleValues, type ModuleContext, type ModulePayload } from '../../src/shared/modules';

const payload: ModulePayload = { format: 1, manifest: FEATURE_CATALOG[0], script: readFileSync('src/features/hydration.js', 'utf8'), assets: [] };
const context: ModuleContext = { now: 1000, lang: 'en', settings: { enabled: true, intervalMin: 5, durationS: 8 },
  paused: false, busy: false, room: false, texts: { hydrationTitle: { en: 'Water', 'zh-CN': 'Water' } } };

describe('ModuleVm', () => {
  it('executes the actual hydration script and shows a fullscreen supplied image once per interval', async () => {
    const vm = await ModuleVm.create(payload);
    try {
      const initial = vm.handle('activate', null, context, null);
      expect(initial.commands).toEqual([]);
      const due = vm.handle('tick', null, { ...context, now: 301000 }, initial.state);
      expect(due.commands[0]).toMatchObject({ op: 'show', scene: { animation: 'fullscreen', display: 'all', elements: [
        { type: 'image', asset: 'builtin:hydration' }, { type: 'text' },
      ] } });
      expect(due.commands[1]).toMatchObject({ op: 'sound', asset: 'builtin:Base' });
      expect(vm.handle('tick', null, { ...context, now: 302000 }, due.state).commands).toEqual([]);
    } finally { vm.dispose(); }
  });
  it('defers busy reminders and starts a full interval after pause or settings changes', async () => {
    const vm = await ModuleVm.create(payload);
    try {
      let state = vm.handle('activate', null, context, null).state;
      const busy = vm.handle('tick', null, { ...context, now: 301000, busy: true }, state);
      expect(busy.commands).toEqual([]);
      expect(vm.handle('tick', null, { ...context, now: 302000 }, busy.state).commands).toHaveLength(2);
      state = vm.handle('tick', null, { ...context, now: 301000, paused: true }, state).state;
      const resumed = vm.handle('tick', null, { ...context, now: 900000 }, state);
      expect(resumed.commands).toEqual([]);
      expect(vm.handle('tick', null, { ...context, now: 1200000 }, resumed.state).commands).toHaveLength(2);
      expect(vm.handle('action', 'preview', { ...context, settings: moduleValues(payload.manifest.settings, null) }, null).commands).toHaveLength(2);
    } finally { vm.dispose(); }
  });
  it('does not expose Node, file, network, DOM or host timer APIs', async () => {
    const vm = await ModuleVm.create({ ...payload, script: `globalThis.feature={handle(){return {commands:[],state:{
      node:typeof process, require:typeof require, network:typeof fetch, dom:typeof document, timer:typeof setInterval}}}};` });
    try {
      expect(vm.handle('tick', null, context, null).state).toEqual({ node: 'undefined', require: 'undefined',
        network: 'undefined', dom: 'undefined', timer: 'undefined' });
    } finally { vm.dispose(); }
  });
  it('recovers broken old timer state and resets on activation without displaying immediately', async () => {
    const vm = await ModuleVm.create(payload);
    try {
      for (const state of ['bad', {}, { nextAt: 'bad' }, { nextAt: 0, lastNow: 0, interval: 300000, enabled: true, paused: false }]) {
        const activated = vm.handle('activate', null, context, state);
        expect(activated.commands).toEqual([]);
        expect(activated.state).toMatchObject({ nextAt: 301000, lastNow: 1000 });
      }
    } finally { vm.dispose(); }
  });
  it('interrupts infinite scripts and refuses oversized state or denied capabilities', async () => {
    let clock = 0;
    await expect(ModuleVm.create({ ...payload, script: 'for (;;) {}' }, () => clock++)).rejects.toThrow();
    for (const script of [
      `globalThis.feature={handle(){for (;;) {}}};`,
      `globalThis.feature={handle(){const a=[]; for (;;) a.push(new Array(100000).fill('memory'));}};`,
      `globalThis.feature={handle(){return {commands:[],state:'x'.repeat(20000)}}};`,
      `globalThis.feature={handle(){return {commands:[{op:'publish',topic:'x',data:{}}],state:null}}};`,
    ]) {
      const vm = await ModuleVm.create({ ...payload, script });
      try { expect(() => vm.handle('tick', null, context, null)).toThrow(); } finally { vm.dispose(); }
    }
  });
});
