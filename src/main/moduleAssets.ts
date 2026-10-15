import { createHash } from 'node:crypto';
import { MAX_MODULES, type ModuleAsset, type ModulePayload } from '../shared/modules';

interface StoredAsset { bytes: Uint8Array; mime: ModuleAsset['mime'] }
interface CachedModule {
  digest: string;
  assets: Map<string, StoredAsset>;
  urls: Record<string, string>;
}

/** Only active modules can serve immutable, content-addressed media; scripts are never served. */
export class ModuleAssets {
  private modules = new Map<string, Map<string, StoredAsset>>();
  private cache = new WeakMap<ModulePayload, CachedModule>();

  register(payload: ModulePayload): Record<string, string> {
    let cached = this.cache.get(payload);
    if (!cached) {
      const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      const assets = this.modules.get(digest) ?? new Map<string, StoredAsset>();
      if (!this.modules.has(digest)) {
        for (const a of payload.assets) assets.set(a.name, { bytes: Buffer.from(a.data, 'base64'), mime: a.mime });
      }
      cached = { digest, assets,
        urls: Object.fromEntries(payload.assets.map((a) => [a.name, `lolping://modules/${digest}/${a.name}`])) };
      this.cache.set(payload, cached);
    }
    // A cleared generation may be restored from rollback without hashing or decoding it again.
    if (!this.modules.has(cached.digest)) {
      if (this.modules.size >= MAX_MODULES) throw new Error('limit');
      this.modules.set(cached.digest, cached.assets);
    }
    return cached.urls;
  }

  read(path: string): StoredAsset | null {
    const match = /^\/([0-9a-f]{64})\/([a-zA-Z0-9][a-zA-Z0-9._-]{0,63}\.(?:png|jpg|webp|wav|ogg))$/.exec(path);
    if (!match) return null;
    return this.modules.get(match[1])?.get(match[2]) ?? null;
  }

  clear(): void { this.modules.clear(); }
}
