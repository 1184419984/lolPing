import { describe, expect, it } from 'vitest';
import { ModuleAssets } from '../../src/main/moduleAssets';
import { FEATURE_CATALOG } from '../../src/features/catalog';
import type { ModulePayload } from '../../src/shared/modules';
import { MAX_MODULES } from '../../src/shared/modules';

const payload: ModulePayload = { format: 1, manifest: FEATURE_CATALOG[0], script: 'script',
  assets: [{ name: 'water.png', mime: 'image/png', data: Buffer.from('image').toString('base64') }] };

describe('ModuleAssets', () => {
  it('serves only registered media by digest and drops retired media', () => {
    const assets = new ModuleAssets(); const urls = assets.register(payload);
    const path = new URL(urls['water.png']).pathname;
    expect(assets.read(path)).toEqual({ bytes: Buffer.from('image'), mime: 'image/png' });
    expect(assets.register(payload)).toBe(urls);
    assets.clear(); expect(assets.read(path)).toBeNull();
  });
  it('restores cached media after clearing without retaining retired generations', () => {
    const assets = new ModuleAssets(); const urls = assets.register(payload);
    const path = new URL(urls['water.png']).pathname;
    const bytes = assets.read(path)?.bytes;
    const next = { ...payload, script: 'next' };
    assets.clear(); const nextUrls = assets.register(next);
    expect(assets.read(path)).toBeNull();
    assets.clear(); expect(assets.register(payload)).toBe(urls);
    expect(assets.read(path)?.bytes).toBe(bytes);
    expect(assets.read(new URL(nextUrls['water.png']).pathname)).toBeNull();
  });
  it('bounds active registrations including cached generations restored after clearing', () => {
    const assets = new ModuleAssets(); const urls = assets.register(payload);
    expect(assets.register({ ...payload })).toEqual(urls);
    assets.clear();
    for (let i = 0; i < MAX_MODULES; i++) assets.register({ ...payload, script: `script${i}` });
    expect(() => assets.register(payload)).toThrow('limit');
    assets.clear(); expect(assets.register(payload)).toBe(urls);
  });
  it('does not serve executable code, unknown hashes or path escapes', () => {
    const assets = new ModuleAssets(); const url = assets.register(payload)['water.png'];
    const root = new URL(url).pathname.replace('water.png', '');
    for (const path of [`${root}script.js`, `${root}../water.png`, `${root}%2e%2e/water.png`,
      `/${'0'.repeat(64)}/water.png`, `${root}other.png`, '/water.png']) expect(assets.read(path)).toBeNull();
  });
});
