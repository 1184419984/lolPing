import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const workspace = resolve(import.meta.dirname, '..');
const output = join(workspace, 'out', 'foony-tools');
const resume = process.argv[2] === '--resume' ? process.argv[3] : null;
if (process.argv.length > 2 && !resume) throw new Error('Usage: node tools/foony-import.mjs [--resume snapshot-name]');
if (resume && !/^[0-9TZ-]+$/.test(resume)) throw new Error('Invalid snapshot name');
const snapshot = join(workspace, 'vendor', 'foony', 'snapshots', resume ?? new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
if (existsSync(snapshot) && !resume) throw new Error('Snapshot already exists');
const entry = join(output, 'foony-import.mjs');
await build({ entryPoints: [join(workspace, 'tools', 'foonyImport.ts')], outfile: entry,
  platform: 'node', format: 'esm', bundle: true, packages: 'external' });
const { importFoony } = await import(pathToFileURL(entry).href);
let count = 0;
const report = await importFoony({ root: snapshot, resume: Boolean(resume), maxFiles: resume ? 1200 : 800, onFile: (file) => {
  count++;
  if (count <= 4 || count % 25 === 0) console.log(`${count} files: ${file.path}`);
} });
console.log(JSON.stringify({ directory: snapshot, files: report.files.length, bytes: report.totalBytes,
  skipped: report.skipped.length, externalOrigins: report.externalOrigins, offlineReady: report.offlineReady,
  originalSourceAvailable: report.originalSourceAvailable }, null, 2));
if (report.pages.some((page) => !report.files.some((file) => file.source === page))) process.exitCode = 1;
