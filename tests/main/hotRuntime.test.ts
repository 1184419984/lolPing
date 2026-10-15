import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FEATURE_CATALOG } from '../../src/features/catalog';
import { HotManager } from '../../src/main/hotManager';
import type { HotBundle, HotRelease } from '../../src/shared/hotUpdate';
import type { ModuleCommand, ModulePayload } from '../../src/shared/modules';
import { UPDATE_REPOSITORY } from '../../src/shared/project';
import { RoomManager } from '../../src/main/roomManager';
import { FakeTransport } from './fixtures/fakeTransport';
import { makeRoomCode } from '../../src/shared/roomCode';
import { open, type RoomKeys } from '../../src/main/roomCrypto';
import { decodeMessage } from '../../src/shared/roomProtocol';
import type { HotInvitation } from '../../src/shared/hotUpdate';
import { vi } from 'vitest';

let dir: string;
let worker: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lolping-runtime-'));
  worker = join(dir, 'worker.cjs');
  await build({ entryPoints: ['src/main/moduleWorker.ts'], outfile: worker, platform: 'node', format: 'cjs', bundle: true });
});
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

describe('Git hot runtime', () => {
  it('switches actual scripts, migrates state, restores offline and rolls back without restarting the host', async () => {
    const base = 'a'.repeat(40); const head = 'b'.repeat(40); const host = 'c'.repeat(64);
    const payload: ModulePayload = { format: 1, manifest: { ...FEATURE_CATALOG[0], id: 'sample', settings: [] }, assets: [],
      script: `globalThis.feature={handle(i){return {state:{count:(i.state?.count||0)+1},commands:i.event==='action'?
        [{op:'sound',asset:'builtin:Base',volume:0.2}]:[]}}};` };
    const builtin: HotBundle = { format: 1, commit: base, modules: [payload] };
    const next: HotBundle = { format: 1, commit: head, modules: [{ ...payload, script: payload.script.replace('volume:0.2', 'volume:0.7') }] };
    const release: HotRelease = { format: 1, api: 1, repository: UPDATE_REPOSITORY, commit: head, host,
      bundle: { name: 'lolPing-features.json', bytes: 100, sha256: 'd'.repeat(64) } };
    const commands: ModuleCommand[] = [];
    let network = 0;
    const options = {
      dir: join(dir, 'saved'), worker, identity: { commit: base, host, dirty: false }, builtin,
      source: { latest: async () => { network++; return release; }, newer: async () => { network++; return true; },
        download: async () => { network++; return next; } },
      context: () => ({ now: 1000, lang: 'en' as const, paused: false, busy: false, room: true, texts: {} }),
      hydration: () => ({}), command: (_id: string, _commit: string, command: ModuleCommand) => commands.push(command),
      clear: () => undefined, verifyPublisher: async () => undefined, publish: () => ({ ok: true as const }),
    };
    let manager = new HotManager(options);
    try {
      await manager.start();
      expect(await manager.action('sample', 'preview')).toEqual({ ok: true });
      expect(commands.at(-1)).toEqual({ op: 'sound', asset: 'builtin:Base', volume: 0.2 });
      expect(await manager.accept()).toEqual({ ok: true });
      expect(manager.commit).toBe(head);
      expect(await manager.action('sample', 'preview')).toEqual({ ok: true });
      expect(commands.at(-1)).toEqual({ op: 'sound', asset: 'builtin:Base', volume: 0.7 });
      await manager.stop();
      const beforeRestart = network;
      manager = new HotManager(options);
      await manager.start();
      expect(network).toBe(beforeRestart);
      expect(manager.commit).toBe(head);
      expect(await manager.rollback()).toEqual({ ok: true });
      expect(manager.commit).toBe(base);
      expect(await manager.action('sample', 'preview')).toEqual({ ok: true });
      expect(commands.at(-1)).toEqual({ op: 'sound', asset: 'builtin:Base', volume: 0.2 });
    } finally { await manager.stop(); }
  });
  it('keeps the room and legacy pings alive across an accepted Git update through real workers', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'setTimeout', 'clearInterval', 'clearTimeout', 'Date'], now: 1780000000000 });
    const base = 'a'.repeat(40); const head = 'b'.repeat(40); const host = 'c'.repeat(64);
    const keys: RoomKeys = { msgKey: Buffer.alloc(32, 1), relayTopic: 'runtime-room' };
    const code = makeRoomCode(new Uint8Array(9).fill(3));
    const payload: ModulePayload = { format: 1, manifest: { ...FEATURE_CATALOG[0], id: 'sample', settings: [] }, assets: [],
      script: `globalThis.feature={handle(i){return {state:null,commands:i.event==='action'?
        [{op:'sound',asset:'builtin:Base',volume:0.2}]:[]}}};` };
    const target: HotBundle = { format: 1, commit: head, modules: [{ ...payload, script: payload.script.replace('0.2', '0.8') }] };
    const release: HotRelease = { format: 1, api: 1, repository: UPDATE_REPOSITORY, commit: head, host,
      bundle: { name: 'lolPing-features.json', bytes: 100, sha256: 'd'.repeat(64) } };
    let runtime: HotManager | null = null;
    const makeRoom = (transport: FakeTransport, seed: number, commit: () => string) => new RoomManager({
      transports: [transport], now: Date.now, randomBytes: (n) => new Uint8Array(n).fill(seed), deriveKeys: async () => keys,
      appVersion: '0.5.1', profile: () => ({ name: `Peer${seed}`, color: 1, limit: 5 }), announceEmotes: () => [],
      featureCommit: commit, resolveTarget: () => ({ displayId: 1, width: 1920, height: 1080 }),
    });
    const aTransport = new FakeTransport(); const bTransport = new FakeTransport();
    const a = makeRoom(aTransport, 1, () => head); const b = makeRoom(bTransport, 2, () => runtime?.commit ?? base);
    let ai = 0; let bi = 0;
    const pump = () => {
      for (let round = 0; round < 10; round++) {
        const before = ai + bi;
        while (ai < aTransport.sent.length) { const packet = aTransport.sent[ai++].packet; bTransport.deliver('a', packet); }
        while (bi < bTransport.sent.length) { const packet = bTransport.sent[bi++].packet; aTransport.deliver('b', packet); }
        if (before === ai + bi) return;
      }
      throw new Error('Room traffic failed to settle');
    };
    const effects: ModuleCommand[] = [];
    let downloads = 0;
    try {
      await a.join(code); await b.join(code); pump();
      await vi.advanceTimersByTimeAsync(3000); pump();
      runtime = new HotManager({ dir: join(dir, 'room-runtime'), worker, identity: { commit: base, host, dirty: false },
        builtin: { format: 1, commit: base, modules: [payload] },
        source: { latest: async () => release, newer: async () => true, download: async () => { downloads++; return target; } },
        context: () => ({ now: Date.now(), lang: 'en', paused: false, busy: false, room: true, texts: {} }), hydration: () => ({}),
        command: (_id, _commit, command) => effects.push(command), clear: () => undefined,
        verifyPublisher: async () => undefined, publish: (commit, digest) => b.sendHot(commit, digest),
      });
      await runtime.start();
      b.on('hot', (offer: HotInvitation) => runtime?.offer(offer));
      const identity = b.self; const starts = bTransport.starts;
      const pings: unknown[] = []; b.on('remotePing', (ping: unknown) => pings.push(ping));
      expect(a.sendHot(head, release.bundle.sha256)).toEqual({ ok: true }); pump();
      expect(runtime.state().invitation).toMatchObject({ commit: head }); expect(downloads).toBe(0);
      runtime.dismiss(); expect(runtime.state().invitation).toBeNull(); expect(runtime.commit).toBe(base);
      await vi.advanceTimersByTimeAsync(60_000); pump();
      expect(a.sendHot(head, release.bundle.sha256)).toEqual({ ok: true }); pump();
      expect(await runtime.accept()).toEqual({ ok: true });
      b.profileChanged(); pump();
      expect(runtime.commit).toBe(head); expect(b.self).toBe(identity);
      expect(bTransport.starts).toBe(starts); expect(bTransport.stops).toBe(0);
      expect(await runtime.action('sample', 'preview')).toEqual({ ok: true });
      expect(effects.at(-1)).toEqual({ op: 'sound', asset: 'builtin:Base', volume: 0.8 });
      a.sendPing('danger', { d: 1, x: 0.25, y: 0.5 }); pump();
      expect(pings).toHaveLength(1); expect(a.state().members.find((m) => !m.self)?.commit).toBe(head);
      const offers = aTransport.sent.flatMap(({ packet }) => {
        const plain = open(keys.msgKey, packet); const msg = plain ? decodeMessage(plain) : null;
        return msg?.t === 'hot' ? [msg] : [];
      });
      expect(offers).toHaveLength(2);
      expect(Object.keys(offers[0]).sort()).toEqual(['commit', 'digest', 'peer', 'repository', 'seq', 't', 'ts']);
    } finally {
      a.quit(); b.quit(); await runtime?.stop(); vi.useRealTimers();
    }
  }, 15_000);
});
