import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyHotPublisher } from '../../src/main/hotGit';
import { UPDATE_REPOSITORY } from '../../src/shared/project';

describe('verifyHotPublisher', () => {
  const identity = { commit: 'a'.repeat(40), host: 'b'.repeat(64), dirty: false };
  it('refuses dirty or stale builds even when packaged', async () => {
    await expect(verifyHotPublisher({ ...identity, dirty: true }, true, '', identity.commit)).rejects.toThrow('dirty');
    await expect(verifyHotPublisher(identity, true, '', 'c'.repeat(40))).rejects.toThrow('notPushed');
    await expect(verifyHotPublisher(identity, true, '', identity.commit)).resolves.toBeUndefined();
  });
  it('refuses a source checkout whose origin is a different repository', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lolping-git-'));
    try {
      execFileSync('git', ['init', dir], { windowsHide: true });
      execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/other/project.git'], { cwd: dir, windowsHide: true });
      await expect(verifyHotPublisher(identity, false, dir, identity.commit)).rejects.toThrow('wrongRemote');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('accepts a clean pushed head and refuses a later unpushed commit without using a live network', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lolping-pushed-'));
    const remote = join(dir, 'remote.git'); const checkout = join(dir, 'checkout');
    const git = (...args: string[]): string => execFileSync('git', args,
      { cwd: checkout, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    try {
      await mkdir(checkout);
      execFileSync('git', ['init', '--bare', remote], { windowsHide: true, stdio: 'ignore' });
      git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
      git('commit', '--allow-empty', '-m', 'test: initial');
      git('remote', 'add', 'origin', `https://github.com/${UPDATE_REPOSITORY}.git`);
      git('config', `url.${remote.replace(/\\/g, '/')}.insteadOf`, `https://github.com/${UPDATE_REPOSITORY}.git`);
      git('push', 'origin', 'main');
      const pushed = { ...identity, commit: git('rev-parse', 'HEAD') };
      await expect(verifyHotPublisher(pushed, false, checkout, pushed.commit)).resolves.toBeUndefined();
      git('commit', '--allow-empty', '-m', 'test: local');
      const local = { ...identity, commit: git('rev-parse', 'HEAD') };
      await expect(verifyHotPublisher(local, false, checkout, local.commit)).rejects.toThrow('notPushed');
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 20_000);
});
