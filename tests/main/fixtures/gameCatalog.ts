import { FEATURE_CATALOG } from '../../../src/features/catalog';
import type { GameEntry, GameRef } from '../../../src/shared/gameSurface';

const games = FEATURE_CATALOG[1].games ?? [];
const talent = games[0];
export const gameCatalog: GameEntry[] = [
  ...games.map((definition) => ({ module: 'arcade', game: definition.id, digest: 'f'.repeat(64), definition, assets: {} })),
  ...(FEATURE_CATALOG[2].games ?? []).map((definition) => ({ module: 'tabletop', game: definition.id, digest: 'f'.repeat(64), definition, assets: {} })),
  { module: 'arcade', game: 'legacyWeb', digest: 'f'.repeat(64), assets: {}, definition: { ...talent, id: 'legacyWeb',
    stages: [], web: 'https://foony.com/zh/games/paintjob' } },
  ...talent.stages.map((stage) => ({ module: 'arcade', game: stage.id, digest: 'f'.repeat(64), assets: {},
    definition: { ...talent, id: stage.id, stages: [stage] } })),
  { module: 'arcade', game: 'duo', digest: 'f'.repeat(64), assets: {}, definition: { ...talent, id: 'duo',
    stages: talent.stages.filter((s) => s.id === 'aim' || s.id === 'clicks') } },
];
export function gameSelection(tests: readonly string[]): GameRef {
  const entry = gameCatalog.find((g) => g.definition.stages.map((s) => s.id).join(',') === tests.join(','));
  return entry ? { module: entry.module, game: entry.game, digest: entry.digest }
    : { module: 'arcade', game: 'missing', digest: 'f'.repeat(64) };
}
