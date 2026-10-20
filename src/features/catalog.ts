import { strings } from '../shared/i18n';
import type { Localized, ModuleManifest } from '../shared/modules';
import type { GameDefinition } from '../shared/gameSurface';

const text = (key: 'hydrationEnabled' | 'hydrationInterval' | 'hydrationDuration' | 'hydrationPreview' | 'hydrationTitle'): Localized =>
  ({ en: strings('en', 'win')[key], 'zh-CN': strings('zh-CN', 'win')[key] });

export const FEATURE_CATALOG: ModuleManifest[] = [{
  id: 'hydration', api: 1, name: text('hydrationEnabled'), description: text('hydrationTitle'), changes: text('hydrationTitle'),
  capabilities: ['timers', 'storage', 'overlay', 'audio'],
  settings: [
    { key: 'enabled', type: 'boolean', label: text('hydrationEnabled'), default: false },
    { key: 'intervalMin', type: 'number', label: text('hydrationInterval'), default: 30, min: 5, max: 180, step: 1 },
    { key: 'durationS', type: 'number', label: text('hydrationDuration'), default: 8, min: 3, max: 30, step: 1 },
  ],
  actions: [{ key: 'preview', label: text('hydrationPreview') }],
  texts: { hydrationTitle: text('hydrationTitle') },
}, gamePack(), tabletopPack()];

function gamePack(): ModuleManifest {
  const en = strings('en', 'win'); const zh = strings('zh-CN', 'win');
  const label = (key: keyof typeof en): Localized => {
    const a = en[key]; const b = zh[key];
    if (typeof a !== 'string' || typeof b !== 'string') throw new Error('Invalid game text');
    return { en: a, 'zh-CN': b };
  };
  const stages: GameDefinition['stages'] = [
    { id: 'reaction', name: label('gameReaction'), unit: 'ms' },
    { id: 'aim', name: label('gameAim'), unit: 'ms' },
    { id: 'clicks', name: label('gameClicks'), unit: 'cps' },
    { id: 'sequence', name: label('gameSequence'), unit: 'level' },
  ];
  const games: GameDefinition[] = [
    { id: 'talent', name: label('gameTalent'), description: label('arcadeTalentDesc'), cover: 'builtin:ping', accent: 'cyan', stages: stages.slice(0, 4) },
  ];
  const keys = ['gameStartTest', 'gameReactionGo', 'gameReactionWait', 'gameReactionEarly', 'gameReactionRetry',
    'gameClickHere', 'gameSequenceWatch', 'gameSequenceRepeat', 'arcadeRoundText', 'arcadeStatsText',
    'arcadeSecondsText'] as const;
  return { id: 'arcade', api: 1, name: label('gameTitle'), description: label('arcadeTalentDesc'),
    changes: label('arcadeCatalog'), capabilities: ['games'], settings: [], actions: [], games,
    texts: Object.fromEntries(keys.map((key) => [key, label(key)])) };
}

function tabletopPack(): ModuleManifest {
  const en = strings('en', 'win'); const zh = strings('zh-CN', 'win');
  const label = (key: keyof typeof en): Localized => {
    const a = en[key]; const b = zh[key];
    if (typeof a !== 'string' || typeof b !== 'string') throw new Error('Invalid tabletop text');
    return { en: a, 'zh-CN': b };
  };
  const games: GameDefinition[] = [
    { id: 'paintjob', name: label('gamePaintjob'), description: label('gamePaintjobDesc'), cover: 'paintjob.webp',
      accent: 'coral', session: 'draw', stages: [{ id: 'match', name: label('gamePaintjob'), unit: 'points' }] },
    { id: 'tictactoe', name: label('gameTictactoe'), description: label('gameTictactoeDesc'), cover: 'tictactoe.webp',
      accent: 'cyan', session: 'grid', stages: [{ id: 'match', name: label('gameTictactoe'), unit: 'points' }] },
    { id: 'connectfour', name: label('gameConnectfour'), description: label('gameConnectfourDesc'), cover: 'connectfour.webp',
      accent: 'coral', session: 'grid', stages: [{ id: 'match', name: label('gameConnectfour'), unit: 'points' }] },
    { id: 'chess', name: label('gameChess'), description: label('gameChessDesc'), cover: 'chess.webp',
      accent: 'lime', session: 'grid', stages: [{ id: 'match', name: label('gameChess'), unit: 'points' }] },
  ];
  return { id: 'tabletop', api: 1, name: label('gameTabletop'), description: label('gameSessionNote'),
    changes: label('gameTabletop'), capabilities: ['games'], settings: [], actions: [], games,
    texts: { gameWords: label('gameWords') } };
}
