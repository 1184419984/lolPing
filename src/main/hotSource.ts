import { createHash } from 'node:crypto';
import { GIT_COMMIT, HOT_BRANCH, HOT_BUNDLE, HOT_MANIFEST, gitAhead, hotBundle, hotRelease, type HotBundle, type HotRelease } from '../shared/hotUpdate';
import { moduleObject } from '../shared/modules';
import { RELEASES_API, UPDATE_REPOSITORY } from '../shared/project';
import { hotGitTree, hotHostBlobs, type HotGitBlob } from '../shared/hotGitTree';

/** All addresses are derived locally; room notices cannot supply a URL or repository. */
export class HotSource {
  private verified: { commit: string; blobs: HotGitBlob[] } | null = null;
  constructor(private readonly fetcher: typeof fetch) {}

  private async bytes(url: string, max: number, signal: AbortSignal, missing = 'network', progress?: (fraction: number) => void): Promise<Uint8Array> {
    signal.throwIfAborted();
    let abort = (): void => undefined;
    const aborted = new Promise<never>((_, reject) => {
      abort = () => reject(new Error('cancelled'));
      signal.addEventListener('abort', abort, { once: true });
    });
    const unlessAborted = <T>(promise: Promise<T>): Promise<T> => Promise.race([promise, aborted]);
    try {
      const response = await unlessAborted(this.fetcher(url, { signal, headers: {
        Accept: 'application/vnd.github+json', 'User-Agent': 'lolPing-hot-features',
      } }));
      if (response.status === 404) throw new Error(missing);
      if (!response.ok || !response.body) throw new Error('network');
      if (Number(response.headers.get('content-length')) > max) {
        void response.body.cancel().catch(() => undefined);
        throw new Error('limit');
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        for (;;) {
          const { value, done } = await unlessAborted(reader.read());
          if (done) break;
          total += value.length;
          if (total > max) throw new Error('limit');
          chunks.push(value);
          progress?.(total / max);
        }
      } finally { void reader.cancel().catch(() => undefined); }
      return Buffer.concat(chunks, total);
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }

  private async json(path: string, signal: AbortSignal, missing = 'network', max = 512 * 1024): Promise<unknown> {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await this.bytes(`${RELEASES_API}${path}`, max, signal, missing))) as unknown;
  }

  async latest(signal: AbortSignal): Promise<HotRelease> {
    const branch = await this.json(`/branches/${HOT_BRANCH}`, signal);
    if (!moduleObject(branch) || !moduleObject(branch.commit) || typeof branch.commit.sha !== 'string') throw new Error('invalid');
    const commit = branch.commit.sha;
    if (!GIT_COMMIT.test(commit)) throw new Error('invalid');
    const tag = `hot-${commit}`;
    const release = await this.json(`/releases/tags/${tag}`, signal, 'notBuilt');
    const ref = await this.json(`/git/ref/tags/${tag}`, signal, 'notBuilt');
    if (!moduleObject(ref) || !moduleObject(ref.object) || ref.object.type !== 'commit' || ref.object.sha !== commit) throw new Error('invalid');
    if (!moduleObject(release) || release.draft !== false || release.tag_name !== tag || !Array.isArray(release.assets)) throw new Error('notBuilt');
    for (const name of [HOT_MANIFEST, HOT_BUNDLE]) {
      if (!release.assets.some((a: unknown) => moduleObject(a) && a.name === name && a.state === 'uploaded')) throw new Error('notBuilt');
    }
    const raw = JSON.parse(new TextDecoder().decode(await this.bytes(this.asset(commit, HOT_MANIFEST), 16 * 1024, signal))) as unknown;
    const manifest = hotRelease(raw, UPDATE_REPOSITORY);
    if (!manifest || manifest.commit !== commit) throw new Error('invalid');
    const blobs = await this.tree(commit, signal);
    if (createHash('sha256').update(hotHostBlobs(blobs)).digest('hex') !== manifest.host) throw new Error('invalid');
    return manifest;
  }

  async newer(base: string, head: string, signal: AbortSignal): Promise<boolean> {
    if (base === head || !GIT_COMMIT.test(base) || !GIT_COMMIT.test(head)) return false;
    return gitAhead(await this.json(`/compare/${base}...${head}?per_page=1`, signal), base, head);
  }

  async download(release: HotRelease, signal: AbortSignal, progress?: (fraction: number) => void): Promise<HotBundle> {
    const bytes = await this.bytes(this.asset(release.commit, HOT_BUNDLE), release.bundle.bytes, signal, 'notBuilt', progress);
    if (bytes.length !== release.bundle.bytes || createHash('sha256').update(bytes).digest('hex') !== release.bundle.sha256) throw new Error('invalid');
    const bundle = hotBundle(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown, release.commit);
    if (!bundle) throw new Error('invalid');
    const blobs = new Map((await this.tree(release.commit, signal)).map((blob) => [blob.path, blob.sha]));
    for (const module of bundle.modules) {
      if (blobs.get(`src/features/${module.manifest.id}.js`) !== this.blobHash(Buffer.from(module.script, 'utf8'))) throw new Error('invalid');
      for (const asset of module.assets) {
        if (blobs.get(`src/features/assets/${module.manifest.id}/${asset.name}`) !== this.blobHash(Buffer.from(asset.data, 'base64'))) throw new Error('invalid');
      }
    }
    return bundle;
  }
  private blobHash(bytes: Uint8Array): string {
    return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  }
  private async tree(commit: string, signal: AbortSignal): Promise<HotGitBlob[]> {
    if (this.verified?.commit === commit) return this.verified.blobs;
    const raw = await this.json(`/git/commits/${commit}`, signal);
    if (!moduleObject(raw) || raw.sha !== commit || !moduleObject(raw.tree) || typeof raw.tree.sha !== 'string'
      || !GIT_COMMIT.test(raw.tree.sha)) throw new Error('invalid');
    const blobs = hotGitTree(await this.json(`/git/trees/${raw.tree.sha}?recursive=1`, signal, 'network', 4 * 1024 * 1024), raw.tree.sha);
    if (!blobs || !blobs.some((blob) => blob.path === 'package.json')) throw new Error('invalid');
    this.verified = { commit, blobs };
    return blobs;
  }
  private asset(commit: string, name: string): string {
    return `https://github.com/${UPDATE_REPOSITORY}/releases/download/hot-${commit}/${name}`;
  }
}
