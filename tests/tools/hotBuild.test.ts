import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { hotHostBlobs, type HotGitBlob } from '../../src/shared/hotGitTree';

describe('hotBuild', () => {
  it('matches Git tree identity and bundles committed bytes regardless of checkout line endings', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lolping-hot-build-'));
    const checkout = join(dir, 'checkout'); const tool = join(dir, 'build.cjs');
    const git = (...args: string[]): string => execFileSync('git', args,
      { cwd: checkout, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const run = (): { identity: { commit: string; host: string; dirty: boolean }; bundle: string } =>
      JSON.parse(execFileSync(process.execPath, [tool], { cwd: checkout, windowsHide: true, encoding: 'utf8' }));
    try {
      await mkdir(join(checkout, 'src', 'features'), { recursive: true });
      await mkdir(join(checkout, 'src', 'main'), { recursive: true });
      await build({ stdin: { contents: `import {buildFeatures} from './tools/hotBuild';
        process.stdout.write(JSON.stringify(buildFeatures()));`, loader: 'ts', resolveDir: process.cwd() },
        outfile: tool, platform: 'node', format: 'cjs', bundle: true });
      git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
      git('config', 'core.autocrlf', 'false');
      await writeFile(join(checkout, '.gitattributes'), '*.js text eol=crlf\n');
      await writeFile(join(checkout, 'package.json'), '{"name":"fixture"}\n');
      await writeFile(join(checkout, 'src', 'main', 'index.ts'), 'export const host = 1;\n');
      const script = 'globalThis.feature = {};\r\n';
      await writeFile(join(checkout, 'src', 'features', 'hydration.js'), script);
      git('add', '.'); git('commit', '-m', 'test: initial');
      const blobs: HotGitBlob[] = git('ls-tree', '-r', 'HEAD').split('\n').map((line) => {
        const [metadata, path] = line.split('\t'); return { path, sha: metadata.split(' ')[2] };
      });
      const expected = createHash('sha256').update(hotHostBlobs(blobs)).digest('hex');
      const clean = run();
      expect(clean.identity).toEqual({ commit: git('rev-parse', 'HEAD'), host: expected, dirty: false });
      expect(JSON.parse(clean.bundle)).toMatchObject({ modules: [{ script: script.replace(/\r\n/g, '\n') }] });
      await writeFile(join(checkout, 'src', 'features', 'hydration.js'), 'globalThis.feature = {changed: true};\r\n');
      const featureChange = run();
      expect(featureChange.identity).toMatchObject({ host: expected, dirty: true });
      await writeFile(join(checkout, 'src', 'main', 'index.ts'), 'export const host = 2;\n');
      expect(run().identity.host).not.toBe(expected);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 20_000);
});
