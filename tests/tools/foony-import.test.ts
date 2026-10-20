import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FOONY_GAMES, foonyCssReferences, foonyHtmlReferences, foonyImportUrl, foonyScriptReferences, importFoony } from '../../tools/foonyImport';

describe('foony-import', () => {
  it('accepts only static published paths and the four selected pages', () => {
    const base = 'https://foony.com/assets/main.js';
    expect(foonyImportUrl('./game.js', base)).toBe('https://foony.com/assets/game.js');
    expect(foonyImportUrl('/m/i.js', base, { '/m/i.js': '/assets/PaintJob.js' })).toBe('https://foony.com/assets/PaintJob.js');
    for (const raw of ['https://evil.test/a.js', 'file:///a.js', '/api/activeCluster', '/accounts/token', '/game.js',
      '/assets/main.js?token=secret', '/assets/%2fetc.js', '/assets/a.js#hash', '/assets/a.js.map',
      'https://user:secret@foony.com/assets/a.js', '/zh/games/other']) expect(foonyImportUrl(raw, base)).toBeNull();
  });
  it('parses HTML and JavaScript without executing downloaded scripts', () => {
    const html = `<script id="foony-stable-imports" type="application/json">{"/m/i.js":"/assets/PaintJob.js"}</script>
      <script type="module">import('/m/i.js');globalThis.neverRun=true;</script>
      <link rel="stylesheet" href="/assets/main.css"><img src="/img/games/paintjob/icon.webp">
      <a href="/account/delete">Ignore</a>`;
    const parsed = foonyHtmlReferences(html);
    expect(parsed.imports).toEqual({ '/m/i.js': '/assets/PaintJob.js' });
    expect(parsed.references).toEqual(['/assets/PaintJob.js', '/m/i.js', '/assets/main.css', '/img/games/paintjob/icon.webp']);
    const js = foonyScriptReferences('import "./other.js";const a="/img/board.png";const b=`/img/${id}.png`;fetch("https://s2.foony.com/accounts/");');
    expect(js.references).toEqual(['./other.js', '/img/board.png']);
    expect(js.dynamicReferences).toHaveLength(1); expect(js.externalOrigins).toEqual(['https://s2.foony.com']);
    expect(foonyCssReferences(`a{background:url('/img/board.png')}@import "./more.css";`).references).toEqual(['/img/board.png', './more.css']);
  });
  it('records source hashes and unresolved dependencies without calling APIs or third-party hosts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lolping-foony-test-'));
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input); requests.push(url);
      const path = new URL(url).pathname;
      const text = path.startsWith('/zh/') ? '<script type="module" src="/assets/main.js"></script>'
        : path === '/assets/main.js' ? 'import "./second.js";fetch("https://s2.foony.com/room");const a="/img/a.png"'
        : path === '/assets/second.js' ? 'export const a=1;' : 'image';
      return new Response(text, { headers: { 'content-type': path.startsWith('/zh/') ? 'text/html' : 'application/octet-stream' } });
    };
    try {
      const report = await importFoony({ root: dir, fetcher, now: () => new Date('2026-10-16T00:00:00Z') });
      expect(report.files).toHaveLength(FOONY_GAMES.length + 3);
      expect(report).toMatchObject({ originalSourceAvailable: false, offlineReady: false });
      expect(requests.every((url) => url.startsWith('https://foony.com/'))).toBe(true);
      expect(report.externalOrigins).toContain('https://s2.foony.com');
      for (const file of report.files) {
        const bytes = await readFile(join(dir, file.path));
        expect(file.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      }
      expect(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))).toEqual(report);
      const before = requests.length;
      const resumed = await importFoony({ root: dir, fetcher, resume: true });
      expect(requests).toHaveLength(before); expect(resumed.files).toEqual(report.files);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('bounds downloads and records redirects or missing files instead of bypassing access controls', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lolping-foony-limit-'));
    let requests = 0;
    const fetcher: typeof fetch = async () => {
      requests++;
      return requests === 1 ? new Response(null, { status: 302, headers: { location: 'https://evil.test' } })
        : new Response('x'.repeat(32));
    };
    try {
      const report = await importFoony({ root: dir, fetcher, maxFileBytes: 16 });
      expect(report.files).toHaveLength(0); expect(report.skipped[0].reason).toBe('http-302');
      expect(report.skipped.slice(1).every((s) => s.reason === 'byte-limit')).toBe(true);
      expect(requests).toBe(4);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
