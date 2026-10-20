import { describe, expect, it } from 'vitest';
import { sessionAction, sessionView, sessionWire, type SessionView } from '../../src/shared/gameSession';

describe('gameSession', () => {
  const view: SessionView = { kind: 'grid', board: 'marks', status: 'turn', round: 0, ply: 0,
    turn: 'a'.repeat(16), winner: null, columns: 3, cells: Array(9).fill(''), legal: [], check: false,
    moves: [], choices: [], word: '', hint: '', deadline: 0, strokes: [], messages: [], scores: [] };
  it('rebuilds public views without executable or private fields and detaches nested data', () => {
    const raw = { ...view, secret: 'answer', html: '<script/>', scores: [{ peer: 'a'.repeat(16), score: 5, secret: 'answer' }] };
    const result = sessionView(raw);
    expect(result).toEqual({ ...view, scores: [{ peer: 'a'.repeat(16), score: 5 }] });
    raw.scores[0].score = 9; expect(result?.scores[0].score).toBe(5);
  });
  it('bounds every board, stroke, chat, score and control value', () => {
    for (const change of [{ columns: 9 }, { board: 'html' }, { cells: Array(65).fill('') }, { cells: ['x'] },
      { legal: [100] }, { turn: 'fake' }, { round: 65 }, { deadline: Infinity }, { word: 'x'.repeat(61) },
      { strokes: [Array(28).fill(1)] }, { messages: [{ peer: 'a'.repeat(16), text: '\u202e', hit: false }] },
      { scores: [{ peer: 'a'.repeat(16), score: -1 }] }]) expect(sessionView({ ...view, ...change })).toBeNull();
    expect(sessionAction({ type: 'stroke', round: 0, color: 0, width: 4, points: [1, 1, 1025, 100] })).toBeNull();
    expect(sessionAction({ type: 'move', round: 0, ply: 0, from: 0, to: 1, promotion: 'script' })).toBeNull();
    expect(sessionWire({ op: 'event', to: '../path', event: {} })).toBeNull();
  });
  it('lets compatible scripts choose grid presentation without a hard-coded game ID', () => {
    expect(sessionView({ ...view, columns: 4, cells: Array(16).fill('Go') })?.cells).toHaveLength(16);
    expect(sessionView({ ...view, board: 'discs', columns: 8, cells: Array(48).fill('X') })?.board).toBe('discs');
    expect(sessionView({ ...view, board: 'chess', columns: 8, cells: Array(64).fill('wp') })?.board).toBe('chess');
    expect(sessionView({ ...view, board: 'chess' })).toBeNull();
  });
});
