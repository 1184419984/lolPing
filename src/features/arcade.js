'use strict';

// This file and catalog.ts ship in the Git feature bundle, not in the installed game renderer.
globalThis.feature = {
  handle() { return { commands: [], state: null }; },
  game(input) {
    const { event, data, context } = input;
    const now = data.now;
    let s = input.state;
    const text = (key, vars = {}) => {
      let value = context.texts[key][context.lang];
      for (const [key, v] of Object.entries(vars)) value = value.replaceAll('{' + key + '}', String(v));
      return value;
    };
    const node = (id, type, value, extra = {}) => ({ id, type, text: value, ...extra });
    const button = () => node('start', 'button', text('gameStartTest'));
    const clamp = (n) => Math.round(Math.max(0, Math.min(100, n)) * 100) / 100;
    const random = () => { s.random = (Math.imul(s.random, 1664525) + 1013904223) >>> 0; return s.random / 4294967296; };
    const finish = (score, metric, accuracy = 1) => { s.result = { test: s.test, score: clamp(score), metric: Math.min(60000, Math.max(0, metric)), accuracy }; };
    if (event === 'start') {
      s = { test: data.stage, phase: 'ready', random: data.seed >>> 0, trial: 0, early: 0, values: [],
        hits: 0, misses: 0, started: null, marked: null, level: 0, input: 0, step: 0 };
      s.points = Array.from({ length: 20 }, () => [12 + random() * 76, 16 + random() * 68]);
      s.sequence = Array.from({ length: 8 }, () => Math.floor(random() * 9));
    }
    let wakeAfter = null;
    let view = { layout: 'stack', tone: 'neutral', columns: 1, nodes: [button()] };
    const shown = event === 'shown'; const click = event === 'input'; const timer = event === 'timer';
    if (s.test === 'reaction') {
      if (click && data.control === 'pad') {
        if (s.phase === 'ready' || s.phase === 'early') { s.phase = 'wait'; s.marked = null; }
        else if (s.phase === 'wait') { s.phase = 'early'; s.early++; }
        else if (s.phase === 'go' && s.marked !== null) {
          s.values.push(Math.min(60000, now - s.marked)); s.trial++; s.phase = 'ready';
          if (s.trial === 5) { const a = s.values.slice().sort((a, b) => a - b); const ms = a[2]; finish(100 - Math.max(0, ms - 150) / 8 - s.early * 3, ms, 5 / (5 + s.early)); }
        }
      }
      if (timer && s.phase === 'wait') { s.phase = 'go'; s.marked = null; }
      if (shown && s.marked === null && (s.phase === 'go' || s.phase === 'wait')) {
        s.marked = now;
        if (s.phase === 'wait') wakeAfter = 650 + random() * 1200;
      }
      view = { layout: 'pad', tone: s.phase === 'go' ? 'success' : s.phase === 'wait' ? 'danger' : 'neutral', columns: 1,
        nodes: [node('pad', 'button', text(s.phase === 'go' ? 'gameReactionGo' : s.phase === 'wait' ? 'gameReactionWait' : s.phase === 'early' ? 'gameReactionEarly' : 'gameStartTest')),
          node('round', 'text', text('arcadeRoundText', { n: Math.min(5, s.trial + 1), total: 5 }))] };
    } else if (s.test === 'aim') {
      if (click && data.control === 'start') s.phase = 'run';
      if (shown && s.phase === 'run' && s.started === null) s.started = now;
      if (click && s.phase === 'run' && s.started !== null) {
        if (data.control === 'target') s.hits++; else if (data.control === 'miss') s.misses++;
      }
      if (s.phase === 'run') {
        const elapsed = s.started === null ? 0 : now - s.started;
        if (!shown && (s.hits >= 20 || elapsed >= 45000)) {
          const ms = s.hits === 20 ? elapsed / 20 : 2250; const accuracy = s.hits / Math.max(1, s.hits + s.misses);
          finish((100 - Math.max(0, ms - 180) / 10) * (.65 + .35 * accuracy) * s.hits / 20, ms, accuracy);
        }
        const point = s.points[Math.min(19, s.hits)];
        view = { layout: 'arena', tone: 'neutral', columns: 1, backgroundAction: 'miss', nodes: [
          node('target', 'target', text('gameClickHere'), { x: point[0], y: point[1] }),
          node('stats', 'text', text('arcadeStatsText', { n: s.hits, total: 20, misses: s.misses }))] };
        wakeAfter = Math.max(16, 45000 - elapsed);
      }
    } else if (s.test === 'clicks') {
      if (click && data.control === 'start') s.phase = 'run';
      if (shown && s.phase === 'run' && s.started === null) s.started = now;
      if (s.phase === 'run') {
        const elapsed = s.started === null ? 0 : now - s.started;
        if (click && data.control === 'pad' && elapsed < 5000) s.hits++;
        if (!shown && elapsed >= 5000) finish(s.hits * 2, s.hits / 5);
        view = { layout: 'pad', tone: 'accent', columns: 1, nodes: [node('pad', 'button', text('gameClickHere') + ' · ' + s.hits),
          node('clock', 'text', text('arcadeSecondsText', { n: Math.max(0, 5 - elapsed / 1000).toFixed(1) }))] };
        wakeAfter = Math.max(16, Math.min(100, 5000 - elapsed));
      }
    } else if (s.test === 'sequence') {
      const next = () => { s.phase = 'watch'; s.step = 0; s.input = 0; s.marked = null; };
      if (click && data.control === 'start') next();
      if (timer && s.phase === 'watch') { s.step++; if (s.step >= (s.level + 1) * 2) { s.phase = 'repeat'; s.marked = null; } }
      else if (timer && s.phase === 'repeat') finish(s.level * 13, s.level, s.level / 8);
      if (click && s.phase === 'repeat' && data.control.startsWith('tile')) {
        const tile = Number(data.control.slice(4));
        if (tile !== s.sequence[s.input]) finish(s.level * 13, s.level, s.level / 8);
        else if (++s.input >= s.level + 1) { s.level++; if (s.level === 8) finish(100, 8); else next(); }
      }
      if (s.phase !== 'ready') {
        const lit = s.phase === 'watch' && s.step % 2 === 0 ? s.sequence[Math.floor(s.step / 2)] : -1;
        view = { layout: 'grid', tone: 'neutral', columns: 3, nodes: [
          ...Array.from({ length: 9 }, (_, i) => node('tile' + i, 'tile', String(i + 1), { tone: lit === i ? 'success' : 'neutral', disabled: s.phase === 'watch' })),
          node('stats', 'text', text(s.phase === 'watch' ? 'gameSequenceWatch' : 'gameSequenceRepeat') + ' · ' + (s.level + 1) + ' / 8')] };
        if (shown && s.phase === 'watch') wakeAfter = s.step % 2 === 0 ? 260 : 180;
        if (shown && s.phase === 'repeat' && s.marked === null) s.marked = now;
        if (s.phase === 'repeat') wakeAfter = Math.max(16, 15000 - (now - (s.marked ?? now)));
      }
    } else throw Error('Unknown stage');
    return { state: s, view, wakeAfter, ...(s.result ? { result: s.result } : {}) };
  },
};
