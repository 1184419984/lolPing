import { GIT_COMMIT } from './hotUpdate';
import { moduleObject } from './modules';

export interface HotGitBlob { path: string; sha: string }

/** Static host text can stay installed; feature text and scripts are bundled separately. */
export const isHotHostFile = (name: string): boolean =>
  (name.startsWith('src/') && !name.startsWith('src/features/') && name !== 'src/shared/i18n.ts')
  || name.startsWith('native/') || name.startsWith('assets/') || name === 'package.json' || name === 'package-lock.json'
  || name === 'electron.vite.config.ts' || name === 'tools/hotBuild.ts';

/** Reject incomplete Git trees, duplicate paths and symlinks at host or feature boundaries. */
export function hotGitTree(raw: unknown, tree: string): HotGitBlob[] | null {
  if (!moduleObject(raw) || raw.sha !== tree || raw.truncated !== false || !Array.isArray(raw.tree) || raw.tree.length > 20_000) return null;
  const paths = new Set<string>();
  const blobs: HotGitBlob[] = [];
  for (const entry of raw.tree) {
    if (!moduleObject(entry) || typeof entry.path !== 'string' || entry.path.length > 500 || paths.has(entry.path)) return null;
    if (entry.path.startsWith('/') || entry.path.split('/').some((part) => !part || part === '.' || part === '..')
      || /[\u0000-\u001f\\]/.test(entry.path)) return null;
    if (typeof entry.sha !== 'string' || !GIT_COMMIT.test(entry.sha)) return null;
    paths.add(entry.path);
    if (entry.type === 'tree' && entry.mode === '040000') continue;
    if (entry.type !== 'blob' || (entry.mode !== '100644' && entry.mode !== '100755')) {
      if (isHotHostFile(entry.path) || entry.path.startsWith('src/features/')) return null;
      continue;
    }
    blobs.push({ path: entry.path, sha: entry.sha });
  }
  return blobs.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

export const hotHostBlobs = (blobs: readonly HotGitBlob[]): string =>
  blobs.filter((blob) => isHotHostFile(blob.path)).map((blob) => `${blob.path}\0${blob.sha}\n`).join('');
