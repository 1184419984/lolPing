import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim();
const metadata = JSON.parse(execFileSync('git', ['show', 'HEAD:package.json'], { encoding: 'utf8', windowsHide: true }));
const { owner, repo } = metadata.build.publish[0];
const repository = `${owner}/${repo}`;
const remote = git('config', '--get', 'remote.origin.url').replace(/\.git$/, '').replace(/\/$/, '');
if (![ `https://github.com/${repository}`, `git@github.com:${repository}`, `ssh://git@github.com/${repository}` ].includes(remote)) {
  throw new Error('origin is not the configured Git repository');
}
if (git('status', '--porcelain')) throw new Error('Commit and push all changes before building a hot release');
if (git('branch', '--show-current') !== 'main') throw new Error('Hot releases must come from main');
const commit = git('rev-parse', 'HEAD');
if (git('ls-remote', 'origin', 'refs/heads/main').split(/\s+/)[0] !== commit) throw new Error('HEAD is not pushed to origin/main');
await mkdir('out/hot-tools', { recursive: true });
await build({ entryPoints: ['tools/hotBuild.ts'], outfile: 'out/hot-tools/build.mjs', platform: 'node', format: 'esm', bundle: true });
const { buildFeatures } = await import(pathToFileURL(resolve('out/hot-tools/build.mjs')).href);
const result = buildFeatures();
await mkdir('out/hot-release', { recursive: true });
await writeFile('out/hot-release/lolPing-features.json', result.bundle);
await writeFile('out/hot-release/lolPing-hot-update.json', JSON.stringify(result.release));
console.log(`Verified ${repository}@${commit}; artifacts are in out/hot-release`);
