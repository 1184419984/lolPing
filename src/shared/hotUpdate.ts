import {
  MAX_MODULES, MODULE_API, MODULE_HASH, moduleObject, modulePayload,
  type InstalledModule, type ModuleError, type ModulePayload, type ModuleScene,
} from './modules';

export const HOT_MANIFEST = 'lolPing-hot-update.json';
export const HOT_BUNDLE = 'lolPing-features.json';
export const HOT_MAX_BYTES = 24 * 1024 * 1024;
export const GIT_COMMIT = /^[0-9a-f]{40}$/;
export const HOT_BRANCH = 'main';
export interface BuildIdentity { commit: string; host: string; dirty: boolean }
export interface HotRelease {
  format: 1;
  api: number;
  repository: string;
  commit: string;
  host: string;
  bundle: { name: typeof HOT_BUNDLE; bytes: number; sha256: string };
}
export interface HotBundle { format: 1; commit: string; modules: ModulePayload[] }
export interface HotInvitation { commit: string; digest: string; name: string; peer: string }
export interface HotState {
  commit: string;
  api: number;
  phase: 'idle' | 'checking' | 'available' | 'downloading' | 'activating' | 'error';
  release: HotRelease | null;
  invitation: HotInvitation | null;
  modules: InstalledModule[];
  progress: number;
  canRollback: boolean;
  error: ModuleError | null;
}
export interface ModuleFrame {
  module: string;
  generation: string;
  lang: 'en' | 'zh-CN';
  scene: ModuleScene;
  assets: Record<string, string>;
}
export function hotRelease(raw: unknown, repository: string): HotRelease | null {
  if (!moduleObject(raw) || raw.format !== 1 || raw.repository !== repository) return null;
  if (!Number.isSafeInteger(raw.api) || Number(raw.api) < 1 || typeof raw.commit !== 'string' || !GIT_COMMIT.test(raw.commit)) return null;
  if (typeof raw.host !== 'string' || !MODULE_HASH.test(raw.host) || !moduleObject(raw.bundle)) return null;
  const b = raw.bundle;
  if (b.name !== HOT_BUNDLE || !Number.isSafeInteger(b.bytes) || Number(b.bytes) < 1 || Number(b.bytes) > HOT_MAX_BYTES) return null;
  if (typeof b.sha256 !== 'string' || !MODULE_HASH.test(b.sha256)) return null;
  return { format: 1, api: Number(raw.api), repository, commit: raw.commit, host: raw.host,
    bundle: { name: HOT_BUNDLE, bytes: Number(b.bytes), sha256: b.sha256 } };
}
export function hotBundle(raw: unknown, commit: string): HotBundle | null {
  if (!moduleObject(raw) || raw.format !== 1 || raw.commit !== commit || !GIT_COMMIT.test(commit)) return null;
  if (!Array.isArray(raw.modules) || raw.modules.length < 1 || raw.modules.length > MAX_MODULES) return null;
  const modules: ModulePayload[] = [];
  for (const value of raw.modules) {
    const p = modulePayload(value);
    if (!p || modules.some((old) => old.manifest.id === p.manifest.id)) return null;
    modules.push(p);
  }
  return { format: 1, commit, modules };
}
export const hotCompatible = (release: HotRelease, identity: BuildIdentity): boolean =>
  release.api === MODULE_API && release.host === identity.host;
/** Git hashes have no numeric order: only a strict descendant on the configured branch is newer. */
export function gitAhead(raw: unknown, base: string, head: string): boolean {
  if (base === head || !GIT_COMMIT.test(base) || !GIT_COMMIT.test(head) || !moduleObject(raw)) return false;
  return raw.status === 'ahead' && Number.isSafeInteger(raw.ahead_by) && Number(raw.ahead_by) > 0
    && raw.behind_by === 0 && moduleObject(raw.base_commit) && raw.base_commit.sha === base
    && moduleObject(raw.merge_base_commit) && raw.merge_base_commit.sha === base;
}
