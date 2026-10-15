import { describe, expect, it } from 'vitest';
import { gitAhead, hotBundle, hotCompatible, hotRelease, type HotRelease } from '../../src/shared/hotUpdate';
import { FEATURE_CATALOG } from '../../src/features/catalog';
import { UPDATE_REPOSITORY } from '../../src/shared/project';

const base = 'a'.repeat(40);
const head = 'b'.repeat(40);
export const release: HotRelease = { format: 1, api: 1, repository: UPDATE_REPOSITORY, commit: head,
  host: 'c'.repeat(64), bundle: { name: 'lolPing-features.json', bytes: 100, sha256: 'd'.repeat(64) } };

describe('hotUpdate', () => {
  it('uses Git ancestry rather than hash ordering or adjacent versions', () => {
    const comparison = { status: 'ahead', ahead_by: 52, behind_by: 0, base_commit: { sha: base }, merge_base_commit: { sha: base } };
    expect(gitAhead(comparison, base, head)).toBe(true);
    expect(gitAhead(comparison, base, base)).toBe(false);
    for (const change of [{ status: 'behind' }, { status: 'diverged' }, { behind_by: 1 }, { ahead_by: 0 },
      { merge_base_commit: { sha: head } }, { base_commit: { sha: head } }]) {
      expect(gitAhead({ ...comparison, ...change }, base, head)).toBe(false);
    }
  });
  it('accepts only the configured repository and bounded artifact identity', () => {
    expect(hotRelease(release, UPDATE_REPOSITORY)).toEqual(release);
    for (const change of [{ repository: 'evil/other' }, { commit: 'v1.0.0' }, { host: '' }, { api: 0 },
      { bundle: { ...release.bundle, name: '../payload.js' } }, { bundle: { ...release.bundle, bytes: Infinity } }]) {
      expect(hotRelease({ ...release, ...change }, UPDATE_REPOSITORY)).toBeNull();
    }
  });
  it('requires an unchanged host and supported capability API', () => {
    const identity = { commit: base, host: release.host, dirty: false };
    expect(hotCompatible(release, identity)).toBe(true);
    expect(hotCompatible({ ...release, host: 'e'.repeat(64) }, identity)).toBe(false);
    expect(hotCompatible({ ...release, api: 2 }, identity)).toBe(false);
  });
  it('rebuilds bounded bundles without manual version numbers or duplicate modules', () => {
    const module = { format: 1, manifest: FEATURE_CATALOG[0], script: 'globalThis.feature = {};', assets: [] };
    const bundle = { format: 1, commit: head, modules: [module] };
    expect(hotBundle(bundle, head)).toEqual(bundle);
    expect(hotBundle(bundle, base)).toBeNull();
    expect(hotBundle({ ...bundle, modules: [module, module] }, head)).toBeNull();
    expect(hotBundle({ ...bundle, modules: [] }, head)).toBeNull();
  });
});
