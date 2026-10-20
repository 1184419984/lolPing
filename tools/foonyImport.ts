import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import ts from 'typescript';

export const FOONY_ORIGIN = 'https://foony.com';
export const FOONY_GAMES = ['paintjob', 'tic-tac-toe', '4-in-a-row-connect', 'chess'] as const;
const STATIC = /\.(?:js|mjs|css|png|jpe?g|webp|gif|svg|ico|woff2?|ttf|otf|mp3|ogg|wav|webm|mp4|wasm|json)$/i;
const STATIC_PATH = /^\/(?:assets|img|fonts|audio|sounds|sfx|textures|images|music|games)\//;
type HtmlNode = DefaultTreeAdapterMap['node'];
export interface FoonyReferences {
  references: string[];
  imports: Record<string, string>;
  externalOrigins: string[];
  dynamicReferences: string[];
}
export interface FoonyImportedFile {
  source: string;
  path: string;
  bytes: number;
  sha256: string;
  mime: string;
  fetchedAt: string;
}
export interface FoonyImportReport {
  format: 1;
  startedAt: string;
  finishedAt: string;
  purpose: 'authorized-local-inspection';
  authorization: 'user-reported; no redistribution license inferred';
  originalSourceAvailable: false;
  offlineReady: false;
  games: readonly string[];
  pages: string[];
  files: FoonyImportedFile[];
  totalBytes: number;
  skipped: { source: string; reason: string }[];
  externalOrigins: string[];
  dynamicReferences: string[];
}
const refs = (): FoonyReferences => ({ references: [], imports: {}, externalOrigins: [], dynamicReferences: [] });

/** Only published same-origin static files and the four exact game landing pages are in scope. */
export function foonyImportUrl(raw: string, base: string, imports: Record<string, string> = {}): string | null {
  const mapped = imports[raw] ?? raw;
  if (!mapped || mapped.length > 1000 || /[\u0000-\u0020\\]/.test(mapped)) return null;
  try {
    const url = new URL(mapped, base);
    if (url.origin !== FOONY_ORIGIN || url.username || url.password || url.search || url.hash || /%2f|%5c|%00/i.test(url.pathname)) return null;
    if (FOONY_GAMES.some((game) => url.pathname === `/zh/games/${game}`)) return url.href;
    if (!STATIC_PATH.test(url.pathname) || !STATIC.test(url.pathname) || url.pathname.split('/').some((p) => p === '.' || p === '..')) return null;
    return url.href;
  } catch { return null; }
}

function remember(result: FoonyReferences, value: string): void {
  if (!value || value.length > 1000) return;
  if (/^https?:\/\//.test(value)) {
    try { const url = new URL(value); if (url.origin !== FOONY_ORIGIN) result.externalOrigins.push(url.origin); } catch { /* partial URLs stay unresolved */ }
  }
  if (STATIC.test(value) || value.startsWith('/m/')) result.references.push(value);
}

/** Parse JavaScript as data. No downloaded code is evaluated and no source-map addresses are guessed. */
export function foonyScriptReferences(source: string): FoonyReferences {
  const result = refs();
  const ast = ts.createSourceFile('distributed.js', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) remember(result, node.text);
    else if (ts.isTemplateExpression(node) && /(?:\/assets\/|\/img\/|https?:\/\/|wss?:\/\/)/.test(node.head.text)) {
      result.dynamicReferences.push(node.getText(ast).slice(0, 300));
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return result;
}

export function foonyHtmlReferences(source: string): FoonyReferences {
  const result = refs();
  const walk = (node: HtmlNode): void => {
    if ('tagName' in node) {
      const attr = (name: string): string => node.attrs.find((a) => a.name === name)?.value ?? '';
      const text = 'childNodes' in node ? node.childNodes.filter((n) => n.nodeName === '#text')
        .map((n) => 'value' in n ? n.value : '').join('') : '';
      if (node.tagName === 'script' && (attr('type') === 'importmap' || attr('id') === 'foony-stable-imports')) {
        try {
          const raw: unknown = JSON.parse(text);
          if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            const entries = attr('type') === 'importmap' && 'imports' in raw ? raw.imports : raw;
            if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
              for (const [key, value] of Object.entries(entries)) if (typeof value === 'string') result.imports[key] = value;
              for (const value of Object.values(result.imports)) remember(result, value);
            }
          }
        } catch { /* Not all inline JSON is an import map. */ }
      } else if (node.tagName === 'script') {
        remember(result, attr('src'));
        if (!attr('src') && (!attr('type') || attr('type') === 'module' || attr('type') === 'text/javascript')) {
          const parsed = foonyScriptReferences(text);
          result.references.push(...parsed.references); result.externalOrigins.push(...parsed.externalOrigins);
          result.dynamicReferences.push(...parsed.dynamicReferences);
        }
      } else if (node.tagName === 'link') {
        if (/^(stylesheet|modulepreload|preload|icon|shortcut icon|apple-touch-icon)$/.test(attr('rel'))) remember(result, attr('href'));
      } else if (['img', 'source', 'audio', 'video'].includes(node.tagName)) {
        remember(result, attr('src')); remember(result, attr('poster'));
        for (const candidate of attr('srcset').split(',')) remember(result, candidate.trim().split(/\s+/)[0]);
      }
    }
    if ('childNodes' in node) for (const child of node.childNodes) walk(child);
  };
  walk(parse(source));
  return result;
}

export function foonyCssReferences(source: string): FoonyReferences {
  const result = refs();
  for (const match of source.matchAll(/url\(\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^)'"\s]+))\s*\)|@import\s+["']([^"']+)["']/g)) {
    remember(result, match[1] ?? match[2] ?? match[3] ?? match[4]);
  }
  return result;
}

interface ImportOptions {
  root: string;
  fetcher?: typeof fetch;
  now?: () => Date;
  maxFiles?: number;
  maxBytes?: number;
  maxFileBytes?: number;
  onFile?(file: FoonyImportedFile): void;
  resume?: boolean;
}

/** Download an inspectable snapshot, not an executable local copy of Foony's service. */
export async function importFoony(options: ImportOptions): Promise<FoonyImportReport> {
  const root = resolve(options.root);
  const now = options.now ?? (() => new Date());
  const fetcher = options.fetcher ?? fetch;
  const maxFiles = options.maxFiles ?? 800;
  const maxBytes = options.maxBytes ?? 256 * 1024 * 1024;
  const maxFileBytes = options.maxFileBytes ?? 16 * 1024 * 1024;
  const report: FoonyImportReport = { format: 1, startedAt: now().toISOString(), finishedAt: '',
    purpose: 'authorized-local-inspection', authorization: 'user-reported; no redistribution license inferred',
    originalSourceAvailable: false, offlineReady: false, games: [...FOONY_GAMES],
    pages: FOONY_GAMES.map((game) => `${FOONY_ORIGIN}/zh/games/${game}`), files: [], totalBytes: 0,
    skipped: [], externalOrigins: [], dynamicReferences: [] };
  const queue = [...report.pages]; const seen = new Set(queue);
  const imports: Record<string, string> = Object.create(null) as Record<string, string>;
  const external = new Set<string>(); const dynamic = new Set<string>();
  const cached = new Map<string, FoonyImportedFile>();
  if (options.resume) {
    const raw: unknown = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
    if (!raw || typeof raw !== 'object' || !('files' in raw) || !Array.isArray(raw.files)) throw new Error('Invalid snapshot');
    for (const item of raw.files) {
      if (!item || typeof item !== 'object' || typeof item.source !== 'string' || typeof item.sha256 !== 'string'
        || typeof item.path !== 'string' || typeof item.mime !== 'string' || typeof item.fetchedAt !== 'string'
        || typeof item.bytes !== 'number' || foonyImportUrl(item.source, FOONY_ORIGIN) !== item.source) throw new Error('Invalid cached file');
      const pathname = new URL(item.source).pathname;
      const expected = report.pages.includes(item.source) ? `site${pathname}/index.html` : `site${pathname}`;
      if (item.path !== expected || !/^[0-9a-f]{64}$/.test(item.sha256)) throw new Error('Invalid cached path');
      cached.set(item.source, { source: item.source, path: item.path, bytes: item.bytes, sha256: item.sha256,
        mime: item.mime, fetchedAt: item.fetchedAt });
    }
  }
  await mkdir(root, { recursive: true });
  const saveReport = async (): Promise<void> => {
    report.finishedAt = now().toISOString(); report.externalOrigins = [...external].sort(); report.dynamicReferences = [...dynamic].sort();
    await writeFile(join(root, 'manifest.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'w' });
  };
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const url = queue[cursor];
    if (report.files.length >= maxFiles || report.totalBytes >= maxBytes) {
      report.skipped.push(...queue.slice(cursor).map((source) => ({ source, reason: 'snapshot-limit' }))); break;
    }
    try {
      const pathname = new URL(url).pathname;
      const page = report.pages.includes(url);
      const file = page ? `site${pathname}/index.html` : `site${pathname}`;
      const target = resolve(root, file);
      const within = relative(root, target);
      if (!within || within.startsWith('..') || isAbsolute(within)) throw new Error('path-limit');
      const previous = cached.get(url);
      let content: Buffer; let mime: string;
      if (previous) {
        if ((await stat(target)).size > maxFileBytes) throw new Error('file-limit');
        content = await readFile(target); mime = previous.mime;
        if (content.length !== previous.bytes || createHash('sha256').update(content).digest('hex') !== previous.sha256) throw new Error('cache-hash-mismatch');
        if (report.totalBytes + content.length > maxBytes) throw new Error('byte-limit');
      } else {
        const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(20000),
          headers: { 'User-Agent': 'lolPing-authorized-local-import/1', Accept: '*/*' }, credentials: 'omit' });
        if (!response.ok) throw new Error(`http-${response.status}`);
        mime = response.headers.get('content-type')?.split(';')[0].trim() ?? '';
        if (!page && /html/i.test(mime)) throw new Error('unexpected-html');
        if (Number(response.headers.get('content-length') ?? 0) > maxFileBytes) throw new Error('file-limit');
        const chunks: Uint8Array[] = []; let bytes = 0;
        if (!response.body) throw new Error('empty-response');
        const reader = response.body.getReader();
        try {
          for (;;) {
            const next = await reader.read();
            if (next.done) break;
            bytes += next.value.length;
            if (bytes > maxFileBytes || report.totalBytes + bytes > maxBytes) throw new Error('byte-limit');
            chunks.push(next.value);
          }
        } finally { await reader.cancel(); reader.releaseLock(); }
        content = Buffer.concat(chunks);
        await mkdir(join(target, '..'), { recursive: true });
        await writeFile(target, content, { flag: 'wx' });
      }
      const bytes = content.length;
      const item: FoonyImportedFile = { source: url, path: file, bytes,
        sha256: createHash('sha256').update(content).digest('hex'), mime, fetchedAt: previous?.fetchedAt ?? now().toISOString() };
      report.files.push(item); report.totalBytes += bytes; options.onFile?.(item);
      const source = content.toString('utf8');
      const found = page ? foonyHtmlReferences(source) : /\.(?:m?js)$/.test(pathname)
        ? foonyScriptReferences(source) : /\.css$/.test(pathname) ? foonyCssReferences(source) : refs();
      Object.assign(imports, found.imports);
      for (const origin of found.externalOrigins) external.add(origin);
      for (const value of found.dynamicReferences) dynamic.add(value);
      for (const raw of found.references) {
        const next = foonyImportUrl(raw, url, imports);
        if (next && !seen.has(next)) {
          seen.add(next);
          if (/\/(?:PaintJob|Chess|TicTacToe|FourInARow|GameConfig)[-./]/.test(next)) queue.splice(cursor + 1, 0, next);
          else queue.push(next);
        }
        else if (!next && raw.startsWith('/m/')) report.skipped.push({ source: raw, reason: 'unresolved-import-map' });
      }
    } catch (error) {
      report.skipped.push({ source: url, reason: error instanceof Error ? error.message.slice(0, 160) : 'download-failed' });
    }
    if (report.files.length % 25 === 0) await saveReport();
  }
  await saveReport();
  return report;
}
