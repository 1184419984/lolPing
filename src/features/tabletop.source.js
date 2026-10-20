import { Chess } from 'chess.js';
import TicTacToe from 'tic-tac-toe-minimax/src/AIHelpers.js';
import ConnectFour from 'connect-four';

// Bundle this source with tools/build-tabletop.mjs before committing a feature update.
let chessCache = null;
let chessKey = '';
const square = (i) => 'abcdefgh'[i % 8] + (8 - Math.floor(i / 8));
const index = (s) => (8 - Number(s[1])) * 8 + 'abcdefgh'.indexOf(s[0]);
const chessFor = (s) => {
  const key = s.moves.join(',');
  if (!chessCache || chessKey !== key) {
    chessCache = new Chess();
    for (const move of s.moves) chessCache.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] || 'q' });
    chessKey = key;
  }
  return chessCache;
};
const fourFor = (s) => {
  const game = new ConnectFour();
  s.moves.forEach((col, i) => game.play(i % 2 ? 'O' : 'X', col));
  return game;
};
const nextRound = (s, now) => {
  s.round++;
  s.strokes = []; s.messages = []; s.hits = [];
  if (s.round >= s.endRound) { s.status = 'finished'; s.deadline = 0; return; }
  s.status = 'choose'; s.turn = s.peers[s.round % s.peers.length];
  if (s.departed.includes(s.turn)) { nextRound(s, now); return; }
  s.choices = [];
  for (let i = 0; i < 3; i++) {
    s.random = (Math.imul(s.random, 1664525) + 1013904223) >>> 0;
    let at = s.random % s.words.length;
    while (s.choices.includes(s.words[at])) at = (at + 1) % s.words.length;
    s.choices.push(s.words[at]);
  }
  s.word = ''; s.deadline = now + 15000;
};
const choose = (s, i, now) => { s.word = s.choices[i]; s.status = 'drawing'; s.deadline = now + 80000; };

function fresh(data, context, round = 0) {
  const s = { game: data.game, peers: data.peers, host: data.host, random: data.seed >>> 0, round,
    status: 'turn', turn: data.peers[0], winner: null, moves: [], cells: [], ply: 0,
    strokes: [], messages: [], hits: [], scores: data.peers.map((peer) => ({ peer, score: 0 })),
    choices: [], word: '', words: [], deadline: 0, votes: [], departed: [], endRound: round + data.peers.length * 2 };
  if (s.game === 'paintjob') {
    s.words = context.texts.gameWords['zh-CN'].split('|');
    s.round = round - 1; nextRound(s, data.now);
    if (data.now === 0) s.deadline = 0;
  } else if (s.game === 'tictactoe') s.cells = Array(9).fill('');
  else if (s.game === 'connectfour') s.cells = Array(42).fill('');
  else if (s.game !== 'chess') throw Error('Unknown session game');
  return s;
}

function action(s, d) {
  const a = d.action;
  if (a.round !== s.round || !s.peers.includes(d.actor)) return false;
  const player = s.peers.indexOf(d.actor);
  if (a.type === 'depart' && d.actor === s.host && s.peers.includes(a.peer) && !s.departed.includes(a.peer)) {
    s.departed.push(a.peer);
    if (s.game === 'paintjob') {
      if (s.peers.filter((p) => !s.departed.includes(p)).length < 2) { s.status = 'finished'; s.deadline = 0; }
      else if (s.turn === a.peer) { s.status = 'reveal'; s.deadline = d.now + 3000; }
    } else if (s.peers.indexOf(a.peer) < 2 && s.status === 'turn') {
      s.status = 'won'; s.winner = s.peers[a.peer === s.peers[0] ? 1 : 0] || null;
    }
    return true;
  }
  if (s.departed.includes(d.actor)) return false;
  if (a.type === 'rematch' && ['won', 'draw', 'finished'].includes(s.status)) {
    if (!s.votes.includes(d.actor)) s.votes.push(d.actor);
    return true;
  }
  if (s.game === 'paintjob') {
    if (a.type === 'clock' && d.actor === s.host && s.status === 'choose' && s.deadline === 0) {
      s.deadline = d.now + 15000; return true;
    }
    if (a.type === 'clock' && d.actor === s.host && d.now >= s.deadline && s.deadline) {
      if (s.status === 'choose') choose(s, 0, d.now);
      else if (s.status === 'drawing') { s.status = 'reveal'; s.deadline = d.now + 8000; }
      else if (s.status === 'reveal') nextRound(s, d.now);
      else return false;
      return true;
    }
    if (a.type === 'next' && s.status === 'reveal' && d.actor === s.host) { nextRound(s, d.now); return true; }
    if (a.type === 'choose' && s.status === 'choose' && d.actor === s.turn) { choose(s, a.index, d.now); return true; }
    if (s.status !== 'drawing' || d.now > s.deadline) return false;
    if (d.actor === s.turn) {
      if (a.type === 'stroke' && s.strokes.length < 400) { s.strokes.push([a.color, a.width, ...a.points]); return true; }
      if (a.type === 'clear') { s.strokes = []; return true; }
      if (a.type === 'undo' && s.strokes.length) { s.strokes.pop(); return true; }
    } else if (a.type === 'guess' && !s.hits.includes(d.actor)) {
      const hit = a.text.normalize('NFKC').trim().toLowerCase() === s.word.normalize('NFKC').toLowerCase();
      s.messages.push({ peer: d.actor, text: hit ? '' : a.text, hit }); s.messages = s.messages.slice(-24);
      if (hit) {
        s.hits.push(d.actor);
        s.scores.find((p) => p.peer === d.actor).score += 50 + Math.max(0, Math.floor((s.deadline - d.now) / 1600));
        s.scores.find((p) => p.peer === s.turn).score += 25;
        if (s.hits.length === s.peers.filter((p) => !s.departed.includes(p)).length - 1) { s.status = 'reveal'; s.deadline = d.now + 8000; }
      }
      return true;
    }
    return false;
  }
  if (s.status !== 'turn' || player >= 2) return false;
  if (a.type === 'resign') { s.winner = s.peers[player ? 0 : 1] || null; s.status = 'won'; return true; }
  if (a.type !== 'move' || a.ply !== s.ply || s.peers.length > 1 && d.actor !== s.turn) return false;
  const token = s.ply % 2 ? 'O' : 'X';
  if (s.game === 'tictactoe') {
    if (a.to >= 9 || s.cells[a.to]) return false;
    s.cells[a.to] = token;
    const board = s.cells.map((v, i) => v || i);
    if (TicTacToe.playerWon(board, token)) { s.status = 'won'; s.winner = s.turn; }
    else if (!TicTacToe.isMovesLeft(board, { huPlayer: 'X', aiPlayer: 'O' })) s.status = 'draw';
    s.moves.push(String(a.to + 1));
  } else if (s.game === 'connectfour') {
    const game = fourFor(s);
    if (!game.validMove(a.to)) return false;
    game.play(token, a.to); s.moves.push(a.to);
    s.cells = Array.from({ length: 42 }, (_, i) => game.get(i % 7, 5 - Math.floor(i / 7)) || '');
    if (game.ended) { s.status = game.winner ? 'won' : 'draw'; s.winner = game.winner ? s.turn : null; }
  } else {
    const game = chessFor(s);
    try { game.move({ from: square(a.from), to: square(a.to), promotion: a.promotion }); } catch { return false; }
    s.moves.push(square(a.from) + square(a.to) + a.promotion); chessKey = s.moves.join(',');
    if (game.isCheckmate()) { s.status = 'won'; s.winner = s.turn; }
    else if (game.isDraw() || s.moves.length >= 500) s.status = 'draw';
  }
  s.ply++;
  if (s.status === 'turn') s.turn = s.peers[s.ply % 2] || s.peers[0];
  return true;
}

function view(s, self) {
  const v = { kind: s.game === 'paintjob' ? 'draw' : 'grid', board: s.game === 'chess' ? 'chess' : s.game === 'connectfour' ? 'discs' : 'marks', status: s.status, round: s.round,
    ply: s.ply, turn: s.turn, winner: s.winner, columns: s.game === 'tictactoe' ? 3 : s.game === 'connectfour' ? 7 : 8,
    cells: s.cells, legal: [], check: false, moves: s.moves.map(String), choices: [], word: '', hint: '',
    deadline: s.deadline, strokes: s.strokes, messages: s.messages, scores: s.scores };
  if (s.game === 'paintjob') {
    if (self === s.turn && s.status === 'choose') v.choices = s.choices;
    if (self === s.turn || ['reveal', 'finished'].includes(s.status)) v.word = s.word;
    v.hint = s.word ? Array.from(s.word).map(() => '_').join(' ') : '';
  } else if (s.game === 'chess') {
    const game = chessFor(s);
    v.cells = game.board().flat().map((p) => p ? p.color + p.type : '');
    v.legal = [...new Set(game.moves({ verbose: true }).map((m) => index(m.from)))];
    v.moves = game.history(); v.check = game.isCheck();
  }
  return v;
}

globalThis.feature = {
  handle() { return { commands: [], state: null }; },
  session({ event, data, state, context }) {
    let s = state;
    let accepted = true;
    if (event === 'start') s = fresh(data, context);
    else {
      accepted = action(s, data);
      if (accepted && data.action.type === 'rematch' && s.peers.slice(0, s.game === 'paintjob' ? 8 : 2).every((p) => s.votes.includes(p))) {
        if (s.departed.length || s.round + s.peers.length * 2 + 1 > 64) return { state: s, accepted: false, view: view(s, data.self) };
        s = fresh({ game: s.game, peers: s.peers, host: s.host, seed: s.random, now: data.now }, context, s.round + 1);
      }
    }
    return { state: s, accepted, view: view(s, data.self) };
  },
};
