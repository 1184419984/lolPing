import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FEATURE_CATALOG } from '../../src/features/catalog';
import { HotManager } from '../../src/main/hotManager';
import type { HotBundle, HotRelease } from '../../src/shared/hotUpdate';
import { UPDATE_REPOSITORY } from '../../src/shared/project';

const base = 'a'.repeat(40);
const head = 'b'.repeat(40);
const host = 'c'.repeat(64);
const payload = { format: 1 as const, manifest: FEATURE_CATALOG[0], script: 'old', assets: [] };
const builtin: HotBundle = { format: 1, commit: base, modules: [payload] };
const release: HotRelease = { format: 1, api: 1, repository: UPDATE_REPOSITORY, commit: head, host,
  bundle: { name: 'lolPing-features.json', bytes: 100, sha256: 'd'.repeat(64) } };
const cleanup: { manager: HotManager; dir: string }[] = [];
afterEach(async () => {
  for (const item of cleanup.splice(0)) { await item.manager.stop(); await rm(item.dir, { recursive: true, force: true }); }
});

describe('HotManager', () => {
  async function setup(options: { fail?: boolean; laterFail?: boolean; newer?: boolean; offered?: boolean; mismatch?: boolean;
    shifted?: boolean; downloadGate?: Promise<void>; commands?: boolean; saved?: unknown; failScripts?: string[] } = {}) {
    const dir = await mkdtemp(join(tmpdir(), 'lolping-hot-'));
    if (options.saved !== undefined) await writeFile(join(dir, 'active.json'), JSON.stringify(options.saved));
    let downloads = 0;
    let publications = 0;
    let checks = 0;
    const outputs: unknown[] = [];
    let downloading = (): void => undefined;
    const downloadStarted = new Promise<void>((resolve) => { downloading = resolve; });
    const manager = new HotManager({
      dir, worker: '', identity: { commit: base, host, dirty: false }, builtin,
      source: { latest: async () => {
        checks++;
        if (options.shifted && checks > 1) return { ...release, commit: 'e'.repeat(40) };
        return options.mismatch ? { ...release, host: 'e'.repeat(64) } : release;
      }, newer: async () => options.newer !== false,
        download: async () => {
          downloads++; downloading(); await options.downloadGate;
          return { ...builtin, commit: head, modules: [{ ...payload, script: 'new' }] };
        } },
      runner: async (p) => {
        if (options.fail && p.script === 'new' || options.failScripts?.includes(p.script)) throw new Error('script failed');
        return { handle: async (event, _data, _context, state) => {
          if (options.laterFail && p.script === 'new' && event === 'action') throw new Error('later failure');
          return { commands: options.commands ? Array.from({ length: 16 }, () => ({ op: 'sound' as const, asset: 'builtin:Base', volume: 1 })) : [],
            state: state ?? { counter: 1 } };
        }, stop: async () => undefined };
      },
      context: () => ({ now: 1000, lang: 'en', paused: false, busy: false, room: true, texts: {} }),
      hydration: () => ({ enabled: true, intervalMin: 85, durationS: 8 }),
      command: (_id, _commit, command) => outputs.push(command), clear: () => undefined, verifyPublisher: async () => undefined,
      publish: () => { publications++; return { ok: true }; },
    });
    cleanup.push({ manager, dir }); await manager.start();
    if (options.offered) manager.offer({ commit: head, digest: release.bundle.sha256, peer: 'a'.repeat(16), name: 'Friend' });
    return { manager, dir, outputs, downloadStarted, counts: () => ({ downloads, publications }) };
  }
  it('never downloads or activates until the recipient accepts', async () => {
    const { manager, counts } = await setup({ offered: true });
    expect(counts().downloads).toBe(0);
    manager.dismiss(); expect(manager.state().invitation).toBeNull();
    expect(manager.state().commit).toBe(base);
    expect(await manager.push()).toEqual({ ok: true });
    expect(counts()).toEqual({ downloads: 0, publications: 1 });
  });
  it('switches a descendant commit without restarting and preserves settings and rollback', async () => {
    const { manager, dir } = await setup({ offered: true });
    expect(await manager.accept()).toEqual({ ok: true });
    expect(manager.state()).toMatchObject({ commit: head, canRollback: true, invitation: null,
      modules: [{ settings: { enabled: true, intervalMin: 85, durationS: 8 } }] });
    const persisted: unknown = JSON.parse(await readFile(join(dir, 'active.json'), 'utf8'));
    expect(persisted).toMatchObject({ current: { bundle: { commit: head } }, previous: { bundle: { commit: base } } });
    expect(await manager.rollback()).toEqual({ ok: true });
    expect(manager.state()).toMatchObject({ commit: base, canRollback: false });
  });
  it('keeps the previous runtime and commit when staging fails', async () => {
    const { manager } = await setup({ fail: true, offered: true });
    expect(await manager.accept()).toEqual({ ok: false, error: 'runtime' });
    expect(manager.state()).toMatchObject({ commit: base, modules: [{ phase: 'running' }] });
  });
  it('rejects equal, older or diverged Git history before downloading', async () => {
    const { manager, counts } = await setup({ newer: false, offered: true });
    expect(await manager.accept()).toEqual({ ok: false, error: 'notNewer' });
    expect(counts().downloads).toBe(0); expect(manager.state().commit).toBe(base);
  });
  it('refuses a changed host before downloading or replacing the runtime', async () => {
    const { manager, counts } = await setup({ offered: true, mismatch: true });
    expect(await manager.accept()).toEqual({ ok: false, error: 'incompatible' });
    expect(counts().downloads).toBe(0); expect(manager.commit).toBe(base);
  });
  it('restores the previous commit after an activated script later fails', async () => {
    const { manager } = await setup({ offered: true, laterFail: true });
    expect(await manager.accept()).toEqual({ ok: true });
    const restored = new Promise<void>((resolve) => {
      manager.on('state', () => { if (manager.commit === base) resolve(); });
    });
    expect(await manager.action('hydration', 'preview')).toEqual({ ok: false, error: 'runtime' });
    await restored;
    expect(manager.state()).toMatchObject({ commit: base, canRollback: false, modules: [{ phase: 'running' }] });
  });
  it('keeps the running commit if the remote head changes while the update is downloaded', async () => {
    const { manager } = await setup({ offered: true, shifted: true });
    expect(await manager.accept()).toEqual({ ok: false, error: 'notBuilt' });
    expect(manager.commit).toBe(base);
  });
  it('does not publish an invitation when remote head changes during verification', async () => {
    const { manager, counts } = await setup({ shifted: true });
    expect(await manager.push()).toEqual({ ok: false, error: 'notBuilt' });
    expect(counts().publications).toBe(0);
  });
  it('cancels a downloaded update without replacing the runtime or losing the old snapshot', async () => {
    let finish = (): void => undefined;
    const downloadGate = new Promise<void>((resolve) => { finish = resolve; });
    const { manager, dir, downloadStarted } = await setup({ offered: true, downloadGate });
    const update = manager.accept(); await downloadStarted; manager.cancel(); finish();
    expect(await update).toEqual({ ok: false, error: 'cancelled' });
    await manager.stop();
    expect(JSON.parse(await readFile(join(dir, 'active.json'), 'utf8'))).toMatchObject({ current: { bundle: { commit: base } } });
    expect(manager.commit).toBe(base);
  });
  it('caps high frequency sound output instead of flooding the host', async () => {
    const { manager, outputs } = await setup({ commands: true });
    await manager.action('hydration', 'preview'); await manager.action('hydration', 'preview');
    expect(outputs).toHaveLength(2);
  });
  it('restores a valid previous snapshot when the active snapshot is corrupt without using the network', async () => {
    const { manager, counts } = await setup({ saved: { host, baseCommit: base,
      current: { bundle: { ...builtin, commit: head, modules: [] }, values: {} },
      previous: { bundle: builtin, values: { hydration: { settings: {}, state: { counter: 12 }, enabled: false } } } } });
    expect(manager.state()).toMatchObject({ commit: base, canRollback: false, modules: [{ enabled: false }] });
    expect(counts()).toEqual({ downloads: 0, publications: 0 });
  });
  it('falls back to bundled scripts if both saved generations fail to initialize', async () => {
    const bad = (commit: string, script: string) => ({ bundle: { ...builtin, commit,
      modules: [{ ...payload, script }] }, values: {} });
    const { manager } = await setup({ failScripts: ['broken', 'alsoBroken'], saved: { host, baseCommit: base,
      current: bad(head, 'broken'), previous: bad('e'.repeat(40), 'alsoBroken') } });
    expect(manager.state()).toMatchObject({ commit: base, canRollback: false, modules: [{ phase: 'running' }] });
  });
  it('uses the new installer scripts while preserving normalized settings and state from an older base', async () => {
    const { manager, dir } = await setup({ saved: { host, baseCommit: head,
      current: { bundle: { ...builtin, commit: head, modules: [{ ...payload, script: 'obsolete' }] },
        values: { hydration: { settings: { enabled: true, intervalMin: 53, durationS: 999 },
          state: { counter: 17 }, enabled: false } } } } });
    expect(manager.state()).toMatchObject({ commit: base, canRollback: false, modules: [{ enabled: false }] });
    await manager.stop();
    expect(JSON.parse(await readFile(join(dir, 'active.json'), 'utf8'))).toMatchObject({ baseCommit: base,
      current: { bundle: { commit: base, modules: [{ script: 'old' }] },
        values: { hydration: { settings: { enabled: true, intervalMin: 53, durationS: 30 },
          state: { counter: 17 }, enabled: false } } } });
  });
});
