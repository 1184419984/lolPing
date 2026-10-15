import { describe, expect, it } from 'vitest';
import metadata from '../../package.json';
import { LATEST_RELEASE_URL, PROJECT_URL, RELEASES_API, UPDATE_REPOSITORY, releasePage } from '../../src/shared/project';

describe('project', () => {
  it('uses the packaging update source for every release link', () => {
    const { owner, repo } = metadata.build.publish[0];
    expect(UPDATE_REPOSITORY).toBe(`${owner}/${repo}`);
    expect(PROJECT_URL).toBe(`https://github.com/${owner}/${repo}`);
    expect(LATEST_RELEASE_URL).toBe(`${PROJECT_URL}/releases/latest`);
    expect(RELEASES_API).toBe(`https://api.github.com/repos/${owner}/${repo}`);
    expect(releasePage('1.2.3')).toBe(`${PROJECT_URL}/releases/tag/v1.2.3`);
    expect(metadata.repository.url).toBe(`${PROJECT_URL}.git`);
  });
});
