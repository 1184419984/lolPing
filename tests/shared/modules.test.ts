import { describe, expect, it } from 'vitest';
import { FEATURE_CATALOG } from '../../src/features/catalog';
import { moduleCommand, moduleManifest, modulePayload, moduleValues } from '../../src/shared/modules';

const manifest = FEATURE_CATALOG[0];
describe('modules', () => {
  it('normalizes old or broken settings and clamps live values', () => {
    expect(moduleValues(manifest.settings, { enabled: true, intervalMin: -10, durationS: 999, unknown: 'bad' }))
      .toEqual({ enabled: true, intervalMin: 5, durationS: 30 });
    expect(moduleValues(manifest.settings, null)).toEqual({ enabled: false, intervalMin: 30, durationS: 8 });
  });
  it('rejects unsafe identifiers, missing translations and unknown capabilities', () => {
    expect(moduleManifest(manifest)).toEqual(manifest);
    expect(moduleManifest({ ...manifest, id: 'constructor' })).toBeNull();
    expect(moduleManifest({ ...manifest, name: { en: 'Only English' } })).toBeNull();
    expect(moduleManifest({ ...manifest, capabilities: ['filesystem'] })).toBeNull();
    expect(moduleManifest({ ...manifest, settings: [manifest.settings[0], manifest.settings[0]] })).toBeNull();
  });
  it('refuses undeclared capabilities, remote assets, HTML and unbounded scenes', () => {
    const sound = { op: 'sound', asset: 'builtin:Base', volume: 1 };
    expect(moduleCommand(sound, manifest, [])).toEqual(sound);
    expect(moduleCommand(sound, { ...manifest, capabilities: [] }, [])).toBeNull();
    expect(moduleCommand({ ...sound, asset: 'https://evil.test/a.wav' }, manifest, [])).toBeNull();
    expect(moduleCommand({ op: 'html', html: '<script>bad()</script>' }, manifest, [])).toBeNull();
    expect(moduleCommand({ op: 'publish', topic: 'x', data: {} }, manifest, [])).toBeNull();
  });
  it('rejects script limits, mismatched media types and path traversal assets', () => {
    const p = { format: 1, manifest, script: 'globalThis.feature={};', assets: [] };
    expect(modulePayload(p)).toEqual(p);
    expect(modulePayload({ ...p, script: 'x'.repeat(256 * 1024 + 1) })).toBeNull();
    expect(modulePayload({ ...p, assets: [{ name: '../a.png', mime: 'image/png', data: 'YWJj' }] })).toBeNull();
    expect(modulePayload({ ...p, assets: [{ name: 'a.png', mime: 'text/html', data: 'YWJj' }] })).toBeNull();
  });
  it('checks media magic bytes, dimensions, canonical encoding and decoded byte limits', () => {
    const p = { format: 1, manifest, script: 'globalThis.feature={};', assets: [] };
    const image = (width: number): string => {
      const bytes = Buffer.alloc(24); bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
      bytes.write('IHDR', 12); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(1, 20);
      return bytes.toString('base64');
    };
    const media = (name: string, mime: string, data: string) => modulePayload({ ...p, assets: [{ name, mime, data }] });
    expect(media('a.png', 'image/png', image(2048))).not.toBeNull();
    expect(media('a.png', 'image/png', image(2049))).toBeNull();
    expect(media('a.png', 'image/png', image(0))).toBeNull();
    expect(media('a.jpg', 'image/jpeg', image(10))).toBeNull();
    expect(media('a.png', 'image/png', 'YWJj')).toBeNull();
    expect(media('a.png', 'image/png', 'Zh==')).toBeNull();
    expect(media('a.wav', 'audio/wav', Buffer.from('RIFF0000WAVE').toString('base64'))).not.toBeNull();
    expect(media('a.wav', 'audio/wav', Buffer.from('RIFF0000WEBP').toString('base64'))).toBeNull();
    expect(media('a.ogg', 'audio/ogg', Buffer.from('OggS0000').toString('base64'))).not.toBeNull();
    expect(media('a.ogg', 'audio/ogg', Buffer.from('not-ogg!').toString('base64'))).toBeNull();
    expect(media('a.ogg', 'audio/ogg', Buffer.alloc(1024 * 1024 + 1).toString('base64'))).toBeNull();
  });
});
