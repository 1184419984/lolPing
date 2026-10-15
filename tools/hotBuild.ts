import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { FEATURE_CATALOG } from '../src/features/catalog';
import { HOT_BUNDLE, hotBundle, type BuildIdentity, type HotRelease } from '../src/shared/hotUpdate';
import { MODULE_API } from '../src/shared/modules';
import { UPDATE_REPOSITORY } from '../src/shared/project';
import type { ModuleAsset } from '../src/shared/modules';
import { hotHostBlobs, isHotHostFile } from '../src/shared/hotGitTree';

const git = (...args: string[]): string => execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim();

/** Hash the host's Git blobs, not platform-specific checkout line endings. Feature scripts are excluded. */
export function buildIdentity(): BuildIdentity {
  const files = [...new Set(git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0'))]
    .filter(isHotHostFile).sort();
  const blobs = files.map((path) => ({ path, sha: git('hash-object', '--path', path, path) }));
  return { commit: git('rev-parse', 'HEAD'), host: createHash('sha256').update(hotHostBlobs(blobs)).digest('hex'),
    dirty: git('status', '--porcelain').length > 0 };
}

export function buildFeatures(identity = buildIdentity()): { identity: BuildIdentity; bundle: string; release: HotRelease } {
  const raw = { format: 1, commit: identity.commit, modules: FEATURE_CATALOG.map((manifest) => ({
    format: 1, manifest, script: featureFile(`src/features/${manifest.id}.js`, identity.dirty).toString('utf8'),
    assets: featureAssets(manifest.id, identity.dirty),
  })) };
  const validated = hotBundle(raw, identity.commit);
  if (!validated) throw new Error('Invalid feature bundle');
  const bundle = JSON.stringify(validated);
  return { identity, bundle, release: {
    format: 1, api: MODULE_API, repository: UPDATE_REPOSITORY, commit: identity.commit, host: identity.host,
    bundle: { name: HOT_BUNDLE, bytes: Buffer.byteLength(bundle), sha256: createHash('sha256').update(bundle).digest('hex') },
  } };
}

function featureFile(path: string, dirty: boolean): Buffer {
  return dirty ? readFileSync(path) : execFileSync('git', ['show', `HEAD:${path}`], { windowsHide: true });
}

function featureAssets(id: string, dirty: boolean): ModuleAsset[] {
  const dir = `src/features/assets/${id}`;
  if (!existsSync(dir)) return [];
  const mimes: Record<string, ModuleAsset['mime']> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', wav: 'audio/wav', ogg: 'audio/ogg' };
  return readdirSync(dir).sort().map((name) => ({ name, mime: mimes[name.split('.').at(-1) ?? ''],
    data: featureFile(`${dir}/${name}`, dirty).toString('base64') }));
}
