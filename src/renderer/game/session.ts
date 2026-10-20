import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArrowUndo20Regular, Delete20Regular, Eraser20Regular, Pen20Regular, Send20Regular,
  Flag20Regular, ArrowSync20Regular, ChevronRight20Regular } from '@fluentui/react-icons';
import type { GameState } from '../../shared/game';
import type { SessionAction, SessionFrame } from '../../shared/gameSession';
import { strings } from '../../shared/i18n';

interface Api {
  session(): Promise<SessionFrame | null>;
  sessionAction(action: SessionAction): Promise<boolean>;
  onSession(cb: (frame: SessionFrame | null) => void): () => void;
}
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
const colors = ['#20252c', '#e85458', '#3587d8', '#339d72', '#f2cf56', '#ab73cc', '#ef8b83', '#ffffff'];
const icons = { brush: Pen20Regular, eraser: Eraser20Regular, undo: ArrowUndo20Regular, clear: Delete20Regular,
  send: Send20Regular, resign: Flag20Regular, rematch: ArrowSync20Regular, next: ChevronRight20Regular };
const icon = (key: keyof typeof icons): string => renderToStaticMarkup(createElement(icons[key]));
const symbols: Record<string, string> = { wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙',
  bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟', X: '×', O: '○' };

/** This surface draws validated data only; all rules and shared state run outside the renderer. */
export class SessionSurface {
  private frame: SessionFrame | null = null;
  private off: () => void;
  private timer: ReturnType<typeof setInterval>;
  private dead = false;
  private selected = -1;
  private color = 0;
  private width = 6;
  private points: number[] = [];
  private pointer: number | null = null;
  private lastFlush = 0;
  private round = -1;
  private votes = false;
  private optimistic: number[][] = [];
  private observedStrokes = 0;
  constructor(private readonly root: HTMLElement, private readonly game: GameState, private readonly api: Api) {
    this.off = api.onSession((frame) => this.update(frame));
    this.timer = setInterval(() => { this.flush(); this.countdown(); }, 150);
    void api.session().then((frame) => this.update(frame));
  }
  destroy(): void { this.dead = true; this.off(); clearInterval(this.timer); this.pointer = null; }
  private t() { return strings(this.game.lang, this.game.platform); }
  private name(peer: string | null): string { return this.game.participants.find((p) => p.peer === peer)?.name ?? ''; }
  private button(id: keyof typeof icons, title: string): string {
    const label = id === 'next' ? this.t().gameNextRound : title;
    return `<button class="icon-button" id="${id}" title="${esc(label)}" aria-label="${esc(label)}">${icon(id)}</button>`;
  }
  private send(action: SessionAction): void { void this.api.sessionAction(action); }
  private command(type: 'clear' | 'undo' | 'resign' | 'next' | 'rematch'): void {
    if (this.frame) this.send({ type, round: this.frame.view.round });
  }
  private update(frame: SessionFrame | null): void {
    if (this.dead || !frame || frame.gameId !== this.game.gameId || this.frame && frame.revision < this.frame.revision) return;
    if (frame.view.strokes.length < this.observedStrokes) this.optimistic = [];
    const added = frame.view.strokes.slice(this.observedStrokes);
    for (const stroke of added) {
      const i = this.optimistic.findIndex((s) => s.length === stroke.length && s.every((v, at) => v === stroke[at]));
      if (i >= 0) this.optimistic.splice(i, 1);
    }
    this.observedStrokes = frame.view.strokes.length;
    this.frame = frame;
    if (frame.view.status !== 'drawing') this.optimistic = [];
    if (this.round !== frame.view.round) {
      this.round = frame.view.round; this.votes = false; this.points = []; this.pointer = null; this.optimistic = [];
    }
    if (!this.root.querySelector('.session-content')) this.mount(frame.view.kind);
    const v = frame.view;
    const text = this.root.querySelector<HTMLElement>('.session-status');
    if (text) text.textContent = v.status === 'won' ? this.t().gameWon(this.name(v.winner)) : v.status === 'draw' ? this.t().gameDraw
      : v.status === 'choose' ? this.t().gameChoosing(this.name(v.turn)) : v.status === 'drawing' ? this.t().gameDrawing(this.name(v.turn))
      : v.status === 'reveal' ? this.t().gameRevealWord(v.word) : v.status === 'finished' ? this.t().gameReveal
      : `${this.t().gameTurn(this.name(v.turn))}${v.check ? ` · ${this.t().gameChessCheck}` : ''}`;
    const pending = this.root.querySelector<HTMLElement>('.session-pending');
    if (pending) pending.textContent = frame.pending ? this.t().gameSessionPending : '';
    if (v.kind === 'grid') this.board(); else this.drawing();
    const end = ['won', 'draw', 'finished'].includes(v.status);
    const rematch = this.root.querySelector<HTMLButtonElement>('#rematch');
    if (rematch) {
      rematch.hidden = !end || v.kind === 'grid' && this.game.participants.findIndex((p) => p.peer === this.game.self) >= 2;
      rematch.disabled = this.votes; rematch.title = this.votes ? this.t().gameRematchWait : this.t().gameRematch;
    }
    const resign = this.root.querySelector<HTMLButtonElement>('#resign');
    if (resign) resign.hidden = end || this.game.participants.findIndex((p) => p.peer === this.game.self) >= 2;
    this.countdown();
  }
  private mount(kind: string): void {
    this.root.innerHTML = `<div class="session-head"><h2 class="session-status"></h2><span class="session-clock"></span><span class="session-pending muted"></span><div class="session-commands">${kind === 'grid' ? this.button('resign', this.t().gameResign) : ''}${this.button('rematch', this.t().gameRematch)}</div></div><div class="session-content ${kind === 'draw' ? 'draw-content' : 'board-content'}">${kind === 'draw'
      ? `<div class="draw-main"><div class="draw-word"></div><div class="drawing-tools">${this.button('brush', this.t().gameBrush)}${this.button('eraser', this.t().gameEraser)}<div class="swatches">${colors.slice(0, 7).map((c, i) => `<button class="swatch" style="--swatch:${c}" data-color="${i}" aria-label="${esc(this.t().gameColor)} ${i + 1}" title="${esc(this.t().gameColor)} ${i + 1}"></button>`).join('')}</div><input type="range" id="brushWidth" min="1" max="24" value="6" aria-label="${esc(this.t().gameBrushWidth)}"/>${this.button('undo', this.t().gameUndo)}${this.button('clear', this.t().gameClear)}</div><canvas id="drawing" width="1024" height="768"></canvas><div class="word-choices"></div><div class="draw-round muted"></div></div><aside class="draw-sidebar"><div class="draw-scores"></div><div class="guess-messages" role="log" aria-live="polite"></div><form id="guessForm"><input id="guess" maxlength="60" autocomplete="off" placeholder="${esc(this.t().gameGuess)}" aria-label="${esc(this.t().gameGuess)}"/>${this.button('send', this.t().gameGuessSend)}</form>${this.button('next', this.t().gameNext)}</aside>`
      : `<div class="board-main"><div id="squares"></div><div class="board-options"><label for="promotion">${esc(this.t().gamePromotion)}</label><select id="promotion">${['q', 'r', 'b', 'n'].map((p, i) => `<option value="${p}">${esc(this.t().gamePromotionOptions[i])}</option>`).join('')}</select><span class="spectator muted"></span></div></div><aside class="board-sidebar"><div class="board-players"></div><ol class="move-history"></ol></aside>`}</div>`;
    this.root.querySelector('#rematch')?.addEventListener('click', () => { this.votes = true; this.command('rematch'); this.update(this.frame); });
    this.root.querySelector('#resign')?.addEventListener('click', () => this.command('resign'));
    this.root.querySelector('#clear')?.addEventListener('click', () => this.command('clear'));
    this.root.querySelector('#undo')?.addEventListener('click', () => this.command('undo'));
    this.root.querySelector('#next')?.addEventListener('click', () => this.command('next'));
    this.root.querySelector('#brush')?.addEventListener('click', () => { this.color = 0; this.toolState(); });
    this.root.querySelector('#eraser')?.addEventListener('click', () => { this.color = 7; this.toolState(); });
    this.root.querySelectorAll<HTMLElement>('[data-color]').forEach((b) => b.addEventListener('click', () => { this.color = Number(b.dataset.color); this.toolState(); }));
    this.root.querySelector<HTMLInputElement>('#brushWidth')?.addEventListener('input', (e) => { this.width = Number((e.target as HTMLInputElement).value); });
    const form = this.root.querySelector<HTMLFormElement>('#guessForm');
    form?.addEventListener('submit', (e) => {
      e.preventDefault(); const input = this.root.querySelector<HTMLInputElement>('#guess');
      if (!this.frame || !input?.value.trim()) return;
      this.send({ type: 'guess', round: this.round, text: input.value }); input.value = '';
    });
    this.root.querySelector('#send')?.setAttribute('type', 'submit');
    const canvas = this.root.querySelector<HTMLCanvasElement>('#drawing');
    canvas?.addEventListener('pointerdown', (e) => {
      if (!this.canDraw() || e.button !== 0) return;
      this.pointer = e.pointerId; canvas.setPointerCapture(e.pointerId); this.points = this.point(e); this.points.push(...this.points);
      this.paint();
    });
    canvas?.addEventListener('pointermove', (e) => {
      if (this.pointer !== e.pointerId) return;
      this.points.push(...this.point(e));
      if (this.points.length >= 24) this.flush(true);
      this.paint();
    });
    const up = (e: PointerEvent): void => {
      if (this.pointer !== e.pointerId) return;
      this.flush(true); this.points = []; this.pointer = null; this.paint();
    };
    canvas?.addEventListener('pointerup', up); canvas?.addEventListener('pointercancel', up);
    this.toolState();
  }
  private board(): void {
    if (!this.frame) return;
    const v = this.frame.view; const chess = v.board === 'chess';
    const connect = v.board === 'discs';
    const container = this.root.querySelector<HTMLElement>('#squares');
    if (!container) return;
    const canMove = v.status === 'turn' && v.turn === this.game.self;
    if (!canMove) this.selected = -1;
    container.className = `squares ${chess ? 'chess' : connect ? 'connect' : 'tic'}`;
    container.style.setProperty('--columns', String(v.columns));
    container.style.aspectRatio = `${v.columns} / ${v.cells.length / v.columns}`;
    const flipped = chess && this.game.participants[1]?.peer === this.game.self;
    container.innerHTML = v.cells.map((_, position) => {
      const i = flipped ? 63 - position : position; const cell = v.cells[i];
      const coordinate = chess ? 'abcdefgh'[i % 8] + (8 - Math.floor(i / 8)) : String(i + 1);
      const edgeLabel = chess && position >= 56 ? coordinate[0] : chess && position % 8 === 0 ? coordinate[1] : '';
      const pieceAt = 'kqrbnp'.indexOf(cell[1] ?? '');
      const name = chess && cell ? this.t().gamePieceNames[pieceAt] : cell;
      return `<button class="square ${(Math.floor(i / v.columns) + i % v.columns) % 2 ? 'dark' : 'light'} ${cell[0] === 'w' || cell === 'X' ? 'white' : 'black'} ${i === this.selected ? 'selected' : ''}" data-cell="${i}" aria-label="${esc(coordinate + (name ? ' ' + name : ''))}" ${canMove && (!chess || this.selected >= 0 || v.legal.includes(i)) ? '' : 'disabled'}><span>${esc(symbols[cell] ?? cell)}</span>${edgeLabel ? `<small>${esc(edgeLabel)}</small>` : ''}</button>`;
    }).join('');
    container.querySelectorAll<HTMLButtonElement>('[data-cell]').forEach((b) => b.addEventListener('click', () => {
      const to = Number(b.dataset.cell);
      if (chess && (this.selected < 0 || v.legal.includes(to))) { this.selected = this.selected === to ? -1 : to; this.board(); return; }
      const promotion = this.root.querySelector<HTMLSelectElement>('#promotion')?.value;
      this.send({ type: 'move', round: v.round, ply: v.ply, from: Math.max(0, this.selected), to: connect ? to % v.columns : to,
        promotion: promotion === 'r' || promotion === 'b' || promotion === 'n' ? promotion : 'q' });
      this.selected = -1;
    }));
    const options = this.root.querySelector<HTMLElement>('.board-options');
    if (options) options.hidden = !chess;
    const players = this.root.querySelector<HTMLElement>('.board-players');
    if (players) players.innerHTML = this.game.participants.map((p, i) => `<div class="participant ${p.peer === v.turn ? 'active-player' : ''}"><span>${esc(p.name)}</span><span>${i < 2 ? chess ? i ? '♚' : '♔' : i ? '○' : '×' : esc(this.t().gameSpectating)}</span></div>`).join('');
    const history = this.root.querySelector<HTMLElement>('.move-history');
    if (history) { history.innerHTML = v.moves.slice(-100).map((m) => `<li>${esc(m)}</li>`).join(''); history.scrollTop = history.scrollHeight; }
  }
  private drawing(): void {
    if (!this.frame) return;
    const v = this.frame.view; const artist = v.turn === this.game.self;
    const word = this.root.querySelector<HTMLElement>('.draw-word');
    if (word) word.textContent = v.word || v.hint || this.t().gameChoose;
    const choices = this.root.querySelector<HTMLElement>('.word-choices');
    if (choices) {
      choices.innerHTML = v.choices.map((w, i) => `<button class="primary" data-word="${i}">${esc(w)}</button>`).join('');
      choices.querySelectorAll<HTMLElement>('[data-word]').forEach((b) => b.addEventListener('click', () => {
        this.send({ type: 'choose', round: v.round, index: Number(b.dataset.word) });
      }));
    }
    const tools = this.root.querySelector<HTMLElement>('.drawing-tools');
    if (tools) tools.hidden = !artist || v.status !== 'drawing';
    const canvas = this.root.querySelector<HTMLCanvasElement>('#drawing');
    if (canvas) canvas.style.cursor = this.canDraw() ? 'crosshair' : 'default';
    const form = this.root.querySelector<HTMLFormElement>('#guessForm');
    if (form) form.hidden = artist || v.status !== 'drawing';
    const scores = this.root.querySelector<HTMLElement>('.draw-scores');
    if (scores) scores.innerHTML = [...v.scores].sort((a, b) => b.score - a.score).map((p, i) => `<div class="participant ${p.peer === v.turn ? 'active-player' : ''}"><span>${i + 1}. ${esc(this.name(p.peer))}</span><strong>${p.score}</strong></div>`).join('');
    const messages = this.root.querySelector<HTMLElement>('.guess-messages');
    if (messages) {
      messages.innerHTML = v.messages.map((m) => `<p class="${m.hit ? 'hit' : ''}"><strong>${esc(this.name(m.peer))}</strong> ${esc(m.hit ? this.t().gameGuessed : m.text)}</p>`).join('');
      messages.scrollTop = messages.scrollHeight;
    }
    const next = this.root.querySelector<HTMLElement>('#next');
    if (next) next.hidden = v.status !== 'reveal' || this.game.self !== this.game.organizer;
    const round = this.root.querySelector<HTMLElement>('.draw-round');
    if (round) round.textContent = this.t().gameDrawRound(v.round + 1);
    this.paint();
  }
  private canDraw(): boolean { return this.frame?.view.status === 'drawing' && this.frame.view.turn === this.game.self; }
  private point(e: PointerEvent): number[] {
    const r = this.root.querySelector('#drawing')?.getBoundingClientRect();
    return r ? [Math.round(Math.max(0, Math.min(1024, (e.clientX - r.left) / r.width * 1024))),
      Math.round(Math.max(0, Math.min(1024, (e.clientY - r.top) / r.height * 1024)))] : [0, 0];
  }
  private flush(force = false): void {
    if (!this.canDraw() || this.points.length < 4 || !force && performance.now() - this.lastFlush < 150) return;
    if (this.optimistic.length >= 24 || (this.frame?.view.strokes.length ?? 0) + this.optimistic.length >= 400) {
      this.points = this.points.slice(-2); return;
    }
    const points = this.points.slice(0, 24);
    this.optimistic.push([this.color, this.width, ...points]);
    void this.api.sessionAction({ type: 'stroke', round: this.round, color: this.color, width: this.width, points }).then((ok) => {
      if (!ok) { this.optimistic = []; this.paint(); }
    });
    this.points = this.pointer === null ? [] : this.points.slice(-2); this.lastFlush = performance.now();
  }
  private paint(): void {
    const canvas = this.root.querySelector<HTMLCanvasElement>('#drawing'); const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const stroke of [...this.frame?.view.strokes ?? [], ...this.optimistic,
      ...(this.points.length > 2 ? [[this.color, this.width, ...this.points]] : [])]) {
      ctx.beginPath(); ctx.strokeStyle = colors[stroke[0]]; ctx.lineWidth = stroke[1]; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.moveTo(stroke[2], stroke[3] * .75);
      for (let i = 4; i < stroke.length; i += 2) ctx.lineTo(stroke[i], stroke[i + 1] * .75);
      ctx.stroke();
    }
  }
  private toolState(): void {
    this.root.querySelectorAll<HTMLElement>('[data-color]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.color) === this.color)));
    this.root.querySelector('#eraser')?.setAttribute('aria-pressed', String(this.color === 7));
    this.root.querySelector('#brush')?.setAttribute('aria-pressed', String(this.color !== 7));
  }
  private countdown(): void {
    const clock = this.root.querySelector<HTMLElement>('.session-clock');
    if (clock) clock.textContent = this.frame?.view.deadline ? this.t().gameTime(Math.max(0, Math.ceil((this.frame.view.deadline - Date.now()) / 1000))) : '';
  }
}
