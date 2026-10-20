import { readFileSync } from 'node:fs';
import { FEATURE_CATALOG } from '../../../src/features/catalog';
import type { ModuleContext, ModulePayload } from '../../../src/shared/modules';

export const tabletopPayload: ModulePayload = { format: 1, manifest: FEATURE_CATALOG[2],
  script: readFileSync('src/features/tabletop.js', 'utf8'), assets: ['paintjob', 'tictactoe', 'connectfour', 'chess'].map((name) => ({
    name: `${name}.webp`, mime: 'image/webp', data: readFileSync(`src/features/assets/tabletop/${name}.webp`).toString('base64'),
  })) };
export const tabletopContext: ModuleContext = { now: 0, lang: 'zh-CN', settings: {}, paused: false,
  busy: false, room: true, texts: tabletopPayload.manifest.texts };
