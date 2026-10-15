import { describe, expect, it } from 'vitest';
import { hotGitTree, hotHostBlobs, isHotHostFile } from '../../src/shared/hotGitTree';

const sha = 'a'.repeat(40);
describe('hotGitTree', () => {
  it('builds stable ordered host identities while excluding hot scripts and their text', () => {
    const raw = { sha, truncated: false, tree: [
      { path: 'src/main/index.ts', sha, type: 'blob', mode: '100644' },
      { path: 'src/features/hydration.js', sha, type: 'blob', mode: '100644' },
      { path: 'src/shared/i18n.ts', sha, type: 'blob', mode: '100644' },
      { path: 'package.json', sha, type: 'blob', mode: '100644' },
    ] };
    const blobs = hotGitTree(raw, sha);
    expect(blobs).not.toBeNull();
    expect(hotHostBlobs(blobs ?? [])).toBe(`package.json\0${sha}\nsrc/main/index.ts\0${sha}\n`);
    expect(isHotHostFile('src/features/assets/hydration/water.png')).toBe(false);
    expect(isHotHostFile('native/hook-helper/src/decision.cpp')).toBe(true);
  });
  it('rejects truncated trees, invalid paths, duplicate paths and symlinks in executable boundaries', () => {
    const entry = { path: 'src/main/index.ts', sha, type: 'blob', mode: '100644' };
    for (const tree of [[entry, entry], [{ ...entry, mode: '120000' }], [{ ...entry, path: '../evil.js' }],
      [{ ...entry, path: 'src/features/evil.js', mode: '120000' }], [{ ...entry, path: 'src\\main\\index.ts' }]]) {
      expect(hotGitTree({ sha, truncated: false, tree }, sha)).toBeNull();
    }
    expect(hotGitTree({ sha, truncated: true, tree: [entry] }, sha)).toBeNull();
  });
});
