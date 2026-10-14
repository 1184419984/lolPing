import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isCustomRef } from '../shared/emotes';
import { renameWithRetry } from './settingsStore';

/** At most this many stills and this many bytes of friends' emotes are kept; the rest is evicted least recently used first. */
export const CACHE_MAX_FILES = 200;
export const CACHE_MAX_BYTES = 4 * 1024 * 1024;
/** A crashed put leaves a `.tmp` behind; a live one owns its file for milliseconds, so only tmp this old is swept. */
const STALE_TMP_MS = 5 * 60_000;
const NAME_RE = /^([0-9a-f]{32})\.webp$/;

/** Owns `<settings folder>/emote-cache/`: verified stills that arrived over a room, capped, evicted by last use. */
export class EmoteCache {
  readonly dir: string;
  private known = new Set<string>();
  /** When a display last showed each emote; falls back to the file's mtime after a launch. */
  private lastUse = new Map<string, number>();
  /** Set after the first write failure, so the log says so once: received stills stay unavailable (the placeholder). */
  private broken = false;

  constructor(dir: string, private readonly now: () => number) {
    this.dir = dir;
  }

  /** Reads what earlier sessions left behind. Run once at launch, before anything asks has(). */
  async present(): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return; // nothing cached yet, or the folder can't be read: empty until a put succeeds
    }
    for (const name of names) {
      const m = NAME_RE.exec(name);
      if (m) this.known.add(m[1]);
    }
  }

  has(hash: string): boolean {
    return this.known.has(hash);
  }

  /** A display showed this emote: it counts as the most recently used at the next sweep. */
  touch(hash: string): void {
    if (this.known.has(hash)) this.lastUse.set(hash, this.now());
  }

  /** Stores a still that has already been verified against its hash and image header. False when the disk refused. */
  async put(hash: string, bytes: Uint8Array): Promise<boolean> {
    if (!isCustomRef(`c:${hash}`)) return false;
    const tmp = join(this.dir, `${hash}.webp.tmp`);
    try {
      await mkdir(this.dir, { recursive: true });
      await writeFile(tmp, bytes);
      await renameWithRetry(tmp, join(this.dir, `${hash}.webp`));
      this.known.add(hash);
      await this.sweep();
      return true;
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => undefined);
      if (!this.broken) {
        this.broken = true;
        console.warn('[emotes] emote cache unavailable:', (err as Error).message);
      }
      return false;
    }
  }

  /** Keeps at most CACHE_MAX_FILES stills and CACHE_MAX_BYTES, evicting the least recently used. Run after every put. */
  async sweep(): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return;
    }
    const entries: { hash: string; at: number; size: number }[] = [];
    for (const name of names) {
      const m = NAME_RE.exec(name);
      if (!m) continue;
      try {
        const s = await stat(join(this.dir, name));
        entries.push({ hash: m[1], at: this.lastUse.get(m[1]) ?? s.mtimeMs, size: s.size });
      } catch {
        // gone between readdir and stat: it is no longer served either
      }
    }
    entries.sort((a, b) => b.at - a.at);
    const kept = new Set<string>();
    let files = 0;
    let bytes = 0;
    for (const e of entries) {
      if (files < CACHE_MAX_FILES && bytes + e.size <= CACHE_MAX_BYTES) {
        files++;
        bytes += e.size;
        kept.add(e.hash);
        continue;
      }
      this.lastUse.delete(e.hash);
      await rm(join(this.dir, `${e.hash}.webp`), { force: true }).catch(() => undefined);
    }
    // What the sweep leaves is exactly what has() may answer, evictions included: no stale index until the next put.
    this.known = kept;
    for (const name of names) {
      if (!name.endsWith('.tmp')) continue;
      try {
        const s = await stat(join(this.dir, name));
        if (this.now() - s.mtimeMs > STALE_TMP_MS) await rm(join(this.dir, name), { force: true }).catch(() => undefined);
      } catch {
        // vanished on its own: done
      }
    }
  }
}
