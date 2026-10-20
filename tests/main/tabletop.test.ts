import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ModuleVm } from '../../src/main/moduleVm';
import { moduleManifest, modulePayload } from '../../src/shared/modules';
import type { SessionAction } from '../../src/shared/gameSession';
import { tabletopContext as context, tabletopPayload as payload } from './fixtures/tabletop';

describe('tabletop', () => {
  const peers = ['a'.repeat(16), 'b'.repeat(16), 'c'.repeat(16)];
  async function setup(game: string, roster = peers) {
    const vm = await ModuleVm.create(payload);
    let reply = vm.session('start', { game, peers: roster, self: peers[0], host: peers[0], seed: 42, now: 1000 }, context, null);
    const run = (action: SessionAction, actor = peers[0], now = 1100, self = peers[0]) => {
      reply = vm.session('action', { action, actor, now, self }, context, reply.state); return reply;
    };
    const move = (to: number, actor: string, from = 0) => run({ type: 'move', round: reply.view.round,
      ply: reply.view.ply, to, from, promotion: 'q' }, actor);
    return { vm, run, move, get: () => reply };
  }
  it('ships valid bilingual local definitions and exact reproducible script bytes', async () => {
    expect(moduleManifest(payload.manifest)).toEqual(payload.manifest);
    expect(modulePayload(payload)).toEqual(payload);
    expect(payload.manifest.games?.map((g) => g.id)).toEqual(['paintjob', 'tictactoe', 'connectfour', 'chess']);
    const bundled = await build({ entryPoints: ['src/features/tabletop.source.js'], bundle: true, format: 'iife',
      platform: 'browser', target: 'es2020', minify: true, legalComments: 'inline', write: false,
      banner: { js: '/*!\n' + readFileSync('docs/tabletop-licenses.txt', 'utf8').replace(/\r\n/g, '\n') + '\n*/' } });
    expect(new TextDecoder().decode(bundled.outputFiles[0].contents)).toBe(readFileSync('src/features/tabletop.js', 'utf8').replace(/\r\n/g, '\n'));
  });
  it('rejects out-of-turn and spectator moves and detects a tic-tac-toe win', async () => {
    const h = await setup('tictactoe');
    try {
      expect(h.move(0, peers[1]).accepted).toBe(false);
      expect(h.move(0, peers[2]).accepted).toBe(false);
      for (const [i, cell] of [0, 3, 1, 4, 2].entries()) expect(h.move(cell, peers[i % 2]).accepted).toBe(true);
      expect(h.get().view).toMatchObject({ status: 'won', winner: peers[0], ply: 5 });
      expect(h.move(5, peers[1]).accepted).toBe(false);
      expect(h.run({ type: 'rematch', round: 0 }, peers[0]).view.round).toBe(0);
      expect(h.run({ type: 'rematch', round: 0 }, peers[1]).view).toMatchObject({ round: 1, status: 'turn', ply: 0 });
    } finally { h.vm.dispose(); }
  });
  it('drops discs to the lowest space and detects a vertical four-in-a-row', async () => {
    const h = await setup('connectfour');
    try {
      for (const [i, col] of [0, 1, 0, 1, 0, 1, 0].entries()) expect(h.move(col, peers[i % 2]).accepted).toBe(true);
      expect(h.get().view).toMatchObject({ status: 'won', winner: peers[0] });
      expect([14, 21, 28, 35].map((i) => h.get().view.cells[i])).toEqual(['X', 'X', 'X', 'X']);
    } finally { h.vm.dispose(); }
  });
  it('validates chess moves and detects fools mate using chess.js', async () => {
    const h = await setup('chess');
    try {
      expect(h.get().view.cells).toHaveLength(64);
      expect(h.move(36, peers[0], 60).accepted).toBe(false);
      for (const [i, [from, to]] of [[53, 45], [12, 28], [54, 38], [3, 39]].entries()) {
        expect(h.move(to, peers[i % 2], from).accepted).toBe(true);
      }
      expect(h.get().view).toMatchObject({ status: 'won', winner: peers[1], check: true });
    } finally { h.vm.dispose(); }
  });
  it('hides the chosen word from guesser views, restricts artists and awards each correct guess once', async () => {
    const h = await setup('paintjob');
    try {
      const choices = h.get().view.choices; expect(choices).toHaveLength(3);
      expect(h.run({ type: 'choose', round: 0, index: 0 }, peers[1]).accepted).toBe(false);
      const chosen = h.run({ type: 'choose', round: 0, index: 0 }, peers[0], 1100, peers[1]);
      expect(chosen.view).toMatchObject({ word: '', choices: [], status: 'drawing' });
      const stroke: SessionAction = { type: 'stroke', round: 0, color: 1, width: 4, points: [100, 100, 900, 900] };
      expect(h.run(stroke, peers[1]).accepted).toBe(false);
      expect(h.run(stroke, peers[0]).view.strokes).toHaveLength(1);
      expect(h.run({ type: 'guess', round: 0, text: choices[0] }, peers[1], 1200).view.scores[1].score).toBeGreaterThan(50);
      expect(h.run({ type: 'guess', round: 0, text: choices[0] }, peers[1], 1201).accepted).toBe(false);
      expect(h.run({ type: 'guess', round: 0, text: choices[0] }, peers[2], 1202).view).toMatchObject({ status: 'reveal', word: choices[0] });
      expect(h.run({ type: 'next', round: 0 }, peers[1]).accepted).toBe(false);
      expect(h.run({ type: 'next', round: 0 }, peers[0]).view).toMatchObject({ round: 1, turn: peers[1], status: 'choose' });
      expect(h.run(stroke, peers[0]).accepted).toBe(false);
    } finally { h.vm.dispose(); }
  });
  it('supports castling, en passant and knight underpromotion through normal chess moves', async () => {
    for (const scenario of [
      { moves: [[52, 36], [12, 28], [62, 45], [1, 18], [61, 34], [6, 21], [60, 62]],
        expected: { 62: 'wk', 61: 'wr', 60: '', 63: '' } },
      { moves: [[52, 36], [8, 16], [36, 28], [11, 27], [28, 19]], expected: { 19: 'wp', 27: '' } },
      { moves: [[48, 32], [15, 31], [32, 24], [31, 39], [24, 16], [39, 47], [16, 9], [47, 54], [9, 0]],
        expected: { 0: 'wn' }, promotion: 'n' as const },
    ]) {
      const h = await setup('chess');
      try {
        for (const [i, [from, to]] of scenario.moves.entries()) {
          expect(h.run({ type: 'move', round: 0, ply: i, from, to, promotion: scenario.promotion ?? 'q' }, peers[i % 2]).accepted).toBe(true);
        }
        for (const [cell, piece] of Object.entries(scenario.expected)) expect(h.get().view.cells[Number(cell)]).toBe(piece);
      } finally { h.vm.dispose(); }
    }
  });
  it('advances selection, drawing and reveal on host deadlines without accepting guest clocks', async () => {
    const h = await setup('paintjob', peers.slice(0, 2));
    try {
      expect(h.run({ type: 'clock', round: 0 }, peers[1], 17000).accepted).toBe(false);
      expect(h.run({ type: 'clock', round: 0 }, peers[0], 17000).view.status).toBe('drawing');
      expect(h.run({ type: 'clock', round: 0 }, peers[0], 98000).view.status).toBe('reveal');
      expect(h.run({ type: 'clock', round: 0 }, peers[0], 107000).view).toMatchObject({ round: 1, status: 'choose' });
    } finally { h.vm.dispose(); }
  });
});
