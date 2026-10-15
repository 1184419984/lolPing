import metadata from '../../package.json';

const source = metadata.build.publish[0];
/** Packaging, release links and room update notices share this one update source. */
export const UPDATE_REPOSITORY = `${source.owner}/${source.repo}`;
export const PROJECT_URL = `https://github.com/${UPDATE_REPOSITORY}`;
export const LATEST_RELEASE_URL = `${PROJECT_URL}/releases/latest`;
export const RELEASES_API = `https://api.github.com/repos/${UPDATE_REPOSITORY}`;
export const releasePage = (version: string): string => `${PROJECT_URL}/releases/tag/v${encodeURIComponent(version)}`;
