import { describe, expect, it, vi } from 'vitest';
import { serveAppScheme } from '../../src/main/appProtocol';
import { ModuleAssets } from '../../src/main/moduleAssets';
import { FEATURE_CATALOG } from '../../src/features/catalog';
import type { ModulePayload } from '../../src/shared/modules';

const bridge = vi.hoisted(() => ({ handler: null as ((request: { url: string }) => Response | Promise<Response>) | null }));
vi.mock('electron', () => ({ net: {}, protocol: {
  handle: (_scheme: string, handler: typeof bridge.handler) => { bridge.handler = handler; },
} }));

describe('serveAppScheme', () => {
  it('serves bounded local media with its declared type and retires it after a generation switch', async () => {
    const modules = new ModuleAssets();
    const payload: ModulePayload = { format: 1, manifest: FEATURE_CATALOG[0], script: 'script',
      assets: [{ name: 'water.png', mime: 'image/png', data: Buffer.from('image').toString('base64') }] };
    const url = modules.register(payload)['water.png'];
    serveAppScheme({ rendererRoot: null, emoteDirs: () => [], modules });
    const handler = bridge.handler;
    if (!handler) throw new Error('Missing protocol handler');
    const response = await handler({ url });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect(await response.text()).toBe('image');
    for (const address of [url.replace('water.png', 'script.js'), url.replace('water.png', '%2e%2e/water.png'),
      url.replace('modules', 'unknown'), 'lolping://modules/../../package.json']) {
      expect((await handler({ url: address })).status).toBe(404);
    }
    modules.clear(); expect((await handler({ url })).status).toBe(404);
  });
});
