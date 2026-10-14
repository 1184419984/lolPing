import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CACHE_MAX_BYTES, CACHE_MAX_FILES, EmoteCache } from '../../src/main/emoteCache';

const HASH = (n: number): string => n.toString(16).padStart(32, '0');
const stillOf = (n: number, size: number): Uint8Array => new Uint8Array(size).fill(n + 1);
const webpNames = (dir: string): string[] => readdirSync(dir).filter((f) => f.endsWith('.webp'));

let dir: string;
let cache: EmoteCache;
let clock: number;

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), 'lolping-emote-cache-')), 'emote-cache');
  clock = Date.now() + 5000;
  cache = new EmoteCache(dir, () => clock);
});

afterEach(() => {
  rmSync(join(dir, '..'), { recursive: true, force: true });
});

describe('EmoteCache', () => {
  it('stores a verified still and finds it again after a relaunch', async () => {
    expect(await cache.put(HASH(1), stillOf(1, 100))).toBe(true);
    expect(cache.has(HASH(1))).toBe(true);
    expect(cache.has(HASH(2))).toBe(false);

    const again = new EmoteCache(dir, () => clock);
    await again.present();
    expect(again.has(HASH(1))).toBe(true);
  });

  it('refuses a hash that is not 32 hex characters', async () => {
    expect(await cache.put('../escape', stillOf(1, 100))).toBe(false);
    expect(existsSync(dir)).toBe(false);
  });

  it('evicts least recently used files beyond the cap, and touch() protects a shown one', async () => {
    const count = CACHE_MAX_FILES + 1;
    for (let n = 0; n < count; n++) {
      expect(await cache.put(HASH(n), stillOf(n, 100))).toBe(true);
      const at = new Date(Date.now() - (count - n) * 1000); // HASH(1) is the oldest on disk, HASH(0) the second oldest
      utimesSync(join(dir, `${HASH(n)}.webp`), at, at);
    }
    cache.touch(HASH(1)); // a display showed the oldest file just now
    await cache.put(HASH(9), stillOf(9, 100)); // one over the cap: the sweep evicts exactly one
    expect(webpNames(dir)).toHaveLength(CACHE_MAX_FILES);
    expect(cache.has(HASH(1))).toBe(true); // shown beats old
    expect(cache.has(HASH(0))).toBe(false); // the runner-up went instead
    expect(cache.has(HASH(9))).toBe(true);
  });

  it('keeps at most CACHE_MAX_FILES files', async () => {
    for (let n = 0; n < CACHE_MAX_FILES + 5; n++) await cache.put(HASH(n), stillOf(n, 100));
    expect(webpNames(dir)).toHaveLength(CACHE_MAX_FILES);
    expect(cache.has(HASH(0))).toBe(false); // the oldest five went
    expect(cache.has(HASH(CACHE_MAX_FILES + 4))).toBe(true);
  });

  it('keeps at most CACHE_MAX_BYTES', async () => {
    const perFile = 300_000; // 4 MB / 300 KB ≈ 14 files
    for (let n = 0; n < 20; n++) await cache.put(HASH(n), stillOf(n, perFile));
    expect(webpNames(dir).length * perFile).toBeLessThanOrEqual(CACHE_MAX_BYTES);
    expect(webpNames(dir).length).toBeLessThan(20);
  });

  it('answers false and logs once when the folder cannot be created', async () => {
    mkdirSync(dir, { recursive: true });
    const blocker = join(dir, 'blocked');
    writeFileSync(blocker, 'a file where the cache folder should be');
    const broken = new EmoteCache(blocker, () => clock);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await broken.put(HASH(1), stillOf(1, 100))).toBe(false);
    expect(await broken.put(HASH(2), stillOf(2, 100))).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(broken.has(HASH(1))).toBe(false);
  });

  it('sweep ignores unknown names and forgets files that vanished', async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'note.txt'), 'not an emote');
    await cache.put(HASH(3), stillOf(3, 100));
    rmSync(join(dir, `${HASH(3)}.webp`));
    await cache.sweep();
    expect(cache.has(HASH(3))).toBe(false);
  });
});
