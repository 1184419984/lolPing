import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FEATURE_CATALOG } from '../../src/features/catalog';
import { HotSource } from '../../src/main/hotSource';
import { HOT_BUNDLE, HOT_MANIFEST, type HotRelease } from '../../src/shared/hotUpdate';
import { RELEASES_API, UPDATE_REPOSITORY } from '../../src/shared/project';
import { hotHostBlobs } from '../../src/shared/hotGitTree';

const commit = 'b'.repeat(40);
const tree = 'e'.repeat(40);
const scriptHash = createHash('sha1').update('blob 6\0script').digest('hex');
const blobs = [{ path: 'package.json', sha: 'a'.repeat(40) }, { path: 'src/features/hydration.js', sha: scriptHash }];
const bundle = JSON.stringify({ format: 1, commit, modules: [{ format: 1, manifest: FEATURE_CATALOG[0], script: 'script', assets: [] }] });
const manifest: HotRelease = { format: 1, api: 1, commit, repository: UPDATE_REPOSITORY,
  host: createHash('sha256').update(hotHostBlobs(blobs)).digest('hex'),
  bundle: { name: HOT_BUNDLE, bytes: Buffer.byteLength(bundle), sha256: createHash('sha256').update(bundle).digest('hex') } };
const asset = (name: string): string => `https://github.com/${UPDATE_REPOSITORY}/releases/download/hot-${commit}/${name}`;

describe('HotSource', () => {
  function setup(changes: Record<string, unknown> = {}) {
    const calls: string[] = [];
    const responses: Record<string, unknown> = {
      [`${RELEASES_API}/branches/main`]: { commit: { sha: commit } },
      [`${RELEASES_API}/releases/tags/hot-${commit}`]: { draft: false, tag_name: `hot-${commit}`,
        assets: [{ name: HOT_MANIFEST, state: 'uploaded' }, { name: HOT_BUNDLE, state: 'uploaded' }] },
      [`${RELEASES_API}/git/ref/tags/hot-${commit}`]: { object: { type: 'commit', sha: commit } },
      [`${RELEASES_API}/git/commits/${commit}`]: { sha: commit, tree: { sha: tree } },
      [`${RELEASES_API}/git/trees/${tree}?recursive=1`]: { sha: tree, truncated: false,
        tree: blobs.map((b) => ({ ...b, type: 'blob', mode: '100644' })) },
      [asset(HOT_MANIFEST)]: manifest, [asset(HOT_BUNDLE)]: bundle, ...changes,
    };
    const fetcher: typeof fetch = async (input) => {
      const url = String(input); calls.push(url);
      const data = responses[url];
      return data === undefined ? new Response(null, { status: 404 }) : new Response(typeof data === 'string' ? data : JSON.stringify(data));
    };
    return { source: new HotSource(fetcher), calls };
  }
  it('derives every URL from the fixed repository and validates the Git tag and artifact digest', async () => {
    const { source, calls } = setup();
    const signal = new AbortController().signal;
    expect(await source.latest(signal)).toEqual(manifest);
    expect(await source.download(manifest, signal)).toMatchObject({ commit, modules: [{ manifest: { id: 'hydration' } }] });
    expect(calls).toHaveLength(7);
    expect(calls.every((url) => url.startsWith(RELEASES_API) || url.startsWith(`https://github.com/${UPDATE_REPOSITORY}/`))).toBe(true);
  });
  it('refuses substituted tag commits or artifact bytes', async () => {
    const signal = new AbortController().signal;
    const badTag = setup({ [`${RELEASES_API}/git/ref/tags/hot-${commit}`]: { object: { type: 'commit', sha: 'a'.repeat(40) } } });
    await expect(badTag.source.latest(signal)).rejects.toThrow('invalid');
    const badBytes = setup({ [asset(HOT_BUNDLE)]: bundle.replace('script', 'broken') });
    await expect(badBytes.source.download(manifest, signal)).rejects.toThrow();
  });
  it('refuses incomplete releases and bounded-stream overflows', async () => {
    const signal = new AbortController().signal;
    const incomplete = setup({ [`${RELEASES_API}/releases/tags/hot-${commit}`]: { draft: false, tag_name: `hot-${commit}`, assets: [] } });
    await expect(incomplete.source.latest(signal)).rejects.toThrow('notBuilt');
    const oversized = setup({ [asset(HOT_BUNDLE)]: bundle + 'x' });
    await expect(oversized.source.download(manifest, signal)).rejects.toThrow('limit');
  });
  it('cancels stalled fetches and body reads even when the fake network ignores AbortSignal', async () => {
    for (const fetcher of [
      (async () => new Promise<Response>(() => undefined)) as typeof fetch,
      (async () => new Response(new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => undefined) }))) as typeof fetch,
    ]) {
      const source = new HotSource(fetcher); const controller = new AbortController();
      const promise = source.latest(controller.signal);
      controller.abort(); await expect(promise).rejects.toThrow('cancelled');
    }
  });
  it('rejects a release that claims the wrong host fingerprint', async () => {
    const { source } = setup({ [asset(HOT_MANIFEST)]: { ...manifest, host: 'f'.repeat(64) } });
    await expect(source.latest(new AbortController().signal)).rejects.toThrow('invalid');
  });
  it('rejects substituted scripts even when the new artifact has a matching release checksum', async () => {
    const changed = bundle.replace('script', 'broken');
    const altered = { ...manifest, bundle: { ...manifest.bundle, bytes: Buffer.byteLength(changed),
      sha256: createHash('sha256').update(changed).digest('hex') } };
    const { source } = setup({ [asset(HOT_BUNDLE)]: changed, [asset(HOT_MANIFEST)]: altered });
    const signal = new AbortController().signal;
    await expect(source.latest(signal)).resolves.toEqual(altered);
    await expect(source.download(altered, signal)).rejects.toThrow('invalid');
  });
  it('rejects truncated or substituted Git trees', async () => {
    for (const raw of [{ sha: tree, truncated: true, tree: [] }, { sha: 'f'.repeat(40), truncated: false, tree: [] }]) {
      const { source } = setup({ [`${RELEASES_API}/git/trees/${tree}?recursive=1`]: raw });
      await expect(source.latest(new AbortController().signal)).rejects.toThrow('invalid');
    }
  });
});
