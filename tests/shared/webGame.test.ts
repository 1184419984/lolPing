import { describe, expect, it } from 'vitest';
import { FOONY_PAINTJOB, foonyGameUrl, foonyNavigation, foonyRoomUrl } from '../../src/shared/webGame';
import { FEATURE_CATALOG } from '../../src/features/catalog';
import { moduleManifest } from '../../src/shared/modules';
import { validateGamePacket } from '../../src/shared/game';

describe('webGame', () => {
  const room = FOONY_PAINTJOB + '#r=kessfvk5';
  it('keeps legacy URL validation without exposing web games in the current local catalog', () => {
    const games = FEATURE_CATALOG.flatMap((m) => m.games ?? []);
    expect(games.map((g) => g.id)).toEqual(['talent', 'paintjob', 'tictactoe', 'connectfour', 'chess']);
    expect(games[0].stages.map((s) => s.id)).toEqual(['reaction', 'aim', 'clicks', 'sequence']);
    expect(games[1]).toMatchObject({ name: { 'zh-CN': '你画我猜' }, session: 'draw' });
    expect(games.some((g) => g.web)).toBe(false);
    expect(moduleManifest(FEATURE_CATALOG[1])).toEqual(FEATURE_CATALOG[1]);
  });
  it('normalizes the supplied invitation to Chinese without losing its room ID', () => {
    expect(foonyRoomUrl(room)).toBe(room);
    expect(foonyRoomUrl(' https://foony.com/en/games/paintjob/#r=kessfvk5 ')).toBe(room);
    expect(foonyGameUrl('https://foony.com/games/paintjob')).toBe(FOONY_PAINTJOB);
    expect(foonyRoomUrl(FOONY_PAINTJOB)).toBeNull();
  });
  it('refuses credentials, spoofed hosts, protocols, parameters and malformed room IDs', () => {
    for (const raw of [null, {}, 'javascript:alert(1)', 'file:///a', 'http://foony.com/zh/games/paintjob',
      'https://foony.com.evil.test/zh/games/paintjob', 'https://evil.test/zh/games/paintjob',
      'https://user:password@foony.com/zh/games/paintjob', 'https://foony.com:8443/zh/games/paintjob',
      FOONY_PAINTJOB + '?redirect=evil', FOONY_PAINTJOB + '#r=', FOONY_PAINTJOB + '#r=abc&url=evil',
      FOONY_PAINTJOB + '#r=' + 'x'.repeat(33), 'https://foony.com/zh/games/chess']) {
      expect(foonyGameUrl(raw)).toBeNull();
    }
    expect(foonyNavigation(room)).toBe(true); expect(foonyNavigation('https://example.com')).toBe(false);
  });
  it('accepts room links only for empty-stage web invitations and strips extra fields', () => {
    const selection = { module: 'arcade', game: 'paintjob', digest: 'f'.repeat(64) };
    const packet = { gameId: 'a'.repeat(16), kind: 'invite', data: { tests: [], selection, webUrl: room, script: 'bad' } };
    expect(validateGamePacket(packet)).toEqual({ ...packet, data: { tests: [], selection, webUrl: room } });
    expect(validateGamePacket({ ...packet, data: { ...packet.data, webUrl: 'https://evil.test' } })).toBeNull();
    expect(validateGamePacket({ ...packet, data: { ...packet.data, tests: ['reaction'] } })).toBeNull();
    expect(validateGamePacket({ ...packet, data: { tests: [], selection } })).toBeNull();
  });
});
