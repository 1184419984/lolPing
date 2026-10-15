import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { UPDATE_REPOSITORY } from '../shared/project';
import type { BuildIdentity } from '../shared/hotUpdate';

const exec = promisify(execFile);
/** Source checkouts must be clean and pushed; installed builds have immutable embedded provenance. */
export async function verifyHotPublisher(identity: BuildIdentity, packaged: boolean, cwd: string, latest: string): Promise<void> {
  if (identity.dirty) throw new Error('dirty');
  if (identity.commit !== latest) throw new Error('notPushed');
  if (packaged) return;
  const git = async (...args: string[]): Promise<string> =>
    (await exec('git', args, { cwd, windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024 })).stdout.trim();
  const remote = (await git('config', '--get', 'remote.origin.url')).replace(/\.git$/, '').replace(/\/$/, '');
  if (![ `https://github.com/${UPDATE_REPOSITORY}`, `git@github.com:${UPDATE_REPOSITORY}`,
    `ssh://git@github.com/${UPDATE_REPOSITORY}` ].includes(remote)) throw new Error('wrongRemote');
  if (await git('status', '--porcelain')) throw new Error('dirty');
  if (await git('rev-parse', 'HEAD') !== identity.commit || await git('branch', '--show-current') !== 'main') throw new Error('notPushed');
  if ((await git('ls-remote', 'origin', 'refs/heads/main')).split(/\s+/)[0] !== latest) throw new Error('notPushed');
}
