import { describe, expect, it } from 'vitest';
import { gameInput, gameView } from '../../src/shared/gameSurface';
import { moduleManifest, modulePayload } from '../../src/shared/modules';
import { FEATURE_CATALOG } from '../../src/features/catalog';

describe('gameSurface', () => {
  const view = { layout: 'grid', tone: 'neutral', columns: 3, nodes: [{ id: 'tile', type: 'tile', text: '1' }] };
  it('rebuilds bounded surface nodes and never forwards executable attributes', () => {
    expect(gameView({ ...view, html: '<script/>', nodes: [{ ...view.nodes[0], onclick: 'run()', style: 'position:fixed' }] }, []))
      .toEqual(view);
    for (const raw of [{ ...view, columns: 99 }, { ...view, nodes: Array(65).fill(view.nodes[0]) },
      { ...view, nodes: [view.nodes[0], view.nodes[0]] }, { ...view, nodes: [{ id: 'x', type: 'html' }] },
      { ...view, nodes: [{ id: 'x', type: 'image', asset: 'https://evil.test/a.png' }] },
      { ...view, nodes: [{ id: 'x', type: 'text', text: 'x'.repeat(301) }] },
      { ...view, nodes: [{ id: 'x', type: 'target', text: 'X', x: NaN, y: 50 }] }]) expect(gameView(raw, [])).toBeNull();
  });
  it('validates input tokens, revisions and monotonic timestamp bounds', () => {
    const raw = { token: 'a'.repeat(32), revision: 1, event: 'input', now: 1200, control: 'tile' };
    expect(gameInput(raw)).toEqual(raw);
    for (const change of [{ token: '../a' }, { revision: -1 }, { now: Infinity }, { control: '__proto__' }, { event: 'exec' }]) {
      expect(gameInput({ ...raw, ...change })).toBeNull();
    }
  });
  it('supports new catalog games without host keys but requires bilingual bounded definitions and local media', () => {
    const manifest = FEATURE_CATALOG[1];
    expect(moduleManifest(manifest)).toEqual(manifest);
    const game = manifest.games?.[0];
    if (!game) throw new Error('Missing game');
    for (const change of [{ games: [game, game] }, { capabilities: [] }, { games: [{ ...game, name: { en: 'Missing' } }] },
      { games: [{ ...game, stages: [] }] }, { games: [{ ...game, cover: 'https://evil.test/a.png' }] }]) {
      expect(moduleManifest({ ...manifest, ...change })).toBeNull();
    }
    expect(modulePayload({ format: 1, manifest: { ...manifest, games: [{ ...game, cover: 'missing.png' }] },
      script: 'feature={}', assets: [] })).toBeNull();
  });
});
