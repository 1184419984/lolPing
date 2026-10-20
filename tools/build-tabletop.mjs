import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

// The committed output is the exact Git blob distributed by the hot-update verifier.
await build({ entryPoints: ['src/features/tabletop.source.js'], outfile: 'src/features/tabletop.js',
  bundle: true, format: 'iife', platform: 'browser', target: 'es2020', minify: true, legalComments: 'inline',
  banner: { js: '/*!\n' + (await readFile('docs/tabletop-licenses.txt', 'utf8')).replace(/\r\n/g, '\n') + '\n*/' } });
