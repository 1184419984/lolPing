import { rankGameParticipants, type GameState, type GameResult, type GameActionResult } from '../../shared/game';
import type { GameEntry, GameFrame, GameInput } from '../../shared/gameSurface';
import { strings } from '../../shared/i18n';
import { GameSurface } from './surface';
import { foonyRoomUrl } from '../../shared/webGame';
import { SessionSurface } from './session';
import type { SessionAction, SessionFrame } from '../../shared/gameSession';

declare global {
  interface Window {
    gameApi: {
      get(): Promise<GameState | null>;
      onState(cb: (state: GameState) => void): () => void;
      start(selection: unknown, multiplayer: boolean): Promise<GameActionResult>;
      accept(): Promise<GameActionResult>;
      decline(): Promise<void>;
      begin(): Promise<GameActionResult>;
      cancel(): Promise<void>;
      openStage(now: number): Promise<GameFrame | null>;
      input(input: GameInput): Promise<GameFrame | null>;
      stopStage(): Promise<void>;
      openWeb(): Promise<GameActionResult>;
      inviteWeb(): Promise<GameActionResult>;
      session(): Promise<SessionFrame | null>;
      sessionAction(action: SessionAction): Promise<boolean>;
      onSession(cb: (frame: SessionFrame | null) => void): () => void;
    };
  }
}

const root = document.getElementById('game') as HTMLElement;
const covers: Record<string, string> = { 'builtin:ping': 'pingwheel_basicpingrender', 'builtin:target': 'pingwheel_targetrender',
  'builtin:caution': 'pingwheel_cautionrender', 'builtin:vision': 'pingwheel_enemyvisionrender',
  'builtin:push': 'pingwheel_pushrender', 'builtin:allin': 'pingwheel_allin_render_01' };
let state: GameState | null = null;
let oldView = '';
let surface: GameSurface | null = null;
let sessionSurface: SessionSurface | null = null;
let interrupted = false;
const webRooms = new Map<string, string>();
const t = () => strings(state?.lang ?? 'zh-CN', state?.platform ?? 'win');
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
const local = (v: { en: string; 'zh-CN': string }): string => v[state?.lang ?? 'zh-CN'];
const testName = (id: string): string => {
  const stage = state?.selection?.definition.stages.find((s) => s.id === id);
  return stage ? local(stage.name) : id;
};
const gameName = (): string => state?.selection ? local(state.selection.definition.name) : t().gameTitle;
const cover = (entry: GameEntry): string => covers[entry.definition.cover]
  ? `../textures/${covers[entry.definition.cover]}.png` : entry.assets[entry.definition.cover] ?? '';

function shell(content: string): string {
  const status = state?.roomActive ? `${t().gameInviteMembers} · ${state.invitation.members.length + 1}`
    : state?.selection?.definition.web ? t().gameWebActive
    : !state?.selection || state.selection.definition.session ? t().gameLocalMode : t().gameSolo;
  const note = state?.selection?.definition.session ? t().gameSessionNote
    : state?.selection?.definition.web ? t().gameWebPrivacy : t().gameResultNote;
  return `<div class="shell"><header class="masthead"><div><div class="eyebrow">lolPing</div><h1>${esc(state?.phase === 'idle' ? t().gameTitle : gameName())}</h1></div><div class="status">${esc(status)}</div></header>${content}<p class="footnote">${esc(note)}</p></div>`;
}

function render(): void {
  if (!state) return;
  const key = state.phase === 'playing' && !state.selection?.definition.web
    ? `${state.gameId}:${state.currentTest}:${state.lang}:${interrupted}` : JSON.stringify(state);
  if (key === oldView) { refreshInviteControls(); return; }
  oldView = key; surface?.destroy(); surface = null;
  sessionSurface?.destroy(); sessionSurface = null;
  if (state.phase === 'invited') renderInvite();
  else if (state.phase === 'lobby') renderLobby();
  else if (state.phase === 'playing') { if (state.selection?.definition.web) renderWeb(); else if (state.selection?.definition.session) renderSession(); else renderStage(); }
  else if (state.phase === 'results') renderResults();
  else renderHome();
}

function renderHome(): void {
  if (!state) return;
  root.innerHTML = shell(`${state.notice ? `<p class="notice" role="status">${esc(t().arcadeUpdated)}</p>` : ''}${inviteMembers()}<section class="library"><div class="section-head"><h2>${esc(t().arcadeCatalog)}</h2><span class="muted">${state.catalog.length}</span></div><div class="game-library">${state.catalog.map((entry, i) => `<article class="game-card accent-${entry.definition.accent}"><div class="game-art"><img src="${esc(cover(entry))}" alt=""/></div><div class="game-copy"><h2>${esc(local(entry.definition.name))}</h2><p>${esc(local(entry.definition.description))}</p><span class="muted">${esc(entry.definition.session ? t().gameRoomPlay : entry.definition.web ? t().gameWebProvider : t().gameSelected(entry.definition.stages.length))}</span>${entry.definition.web ? `<label class="web-room-label" for="webRoom${i}">${esc(t().gameWebRoom)}</label><input class="web-room" id="webRoom${i}" data-room="${i}" type="url" maxlength="200" spellcheck="false" autocomplete="off" placeholder="${esc(t().gameWebRoomPlaceholder)}" value="${esc(webRooms.get(entry.game) ?? '')}"/><p class="web-privacy">${esc(t().gameWebPrivacy)}</p>` : ''}<div class="actions"><button class="primary" data-solo="${i}">${esc(entry.definition.session === 'grid' ? t().gameLocal : entry.definition.web ? t().gameWebOpen : t().gamePractice)}</button>${inviteButton(`data-invite="${i}"`)}</div></div></article>`).join('')}</div>${state.catalog.length ? '' : `<p class="notice">${esc(t().arcadeEmpty)}</p>`}</section>`);
  root.querySelectorAll<HTMLInputElement>('[data-room]').forEach((input) => input.addEventListener('input', () => {
    const entry = state?.catalog[Number(input.dataset.room)];
    if (entry) webRooms.set(entry.game, input.value);
  }));
  root.querySelectorAll<HTMLButtonElement>('[data-solo],[data-invite]').forEach((button) => button.addEventListener('click', () => {
    const multiplayer = button.dataset.invite !== undefined;
    const entry = state?.catalog[Number(multiplayer ? button.dataset.invite : button.dataset.solo)];
    if (entry) void startGame(entry, multiplayer);
  }));
}

function inviteButton(attributes: string): string {
  const error = state?.invitation.error ?? null;
  return `<button class="secondary" data-invite-control ${attributes} ${error ? 'disabled' : ''}
    title="${esc(error ? t().gameErrors[error] : t().gameInvite)}">${esc(t().gameInvite)}</button>`;
}

function inviteMembers(): string {
  if (!state?.roomActive) return `<p class="invite-hint muted" role="status">${esc(t().gameNoRoom)}</p>`;
  const error = state.invitation.error;
  return `<section class="invite-members"><div class="section-head"><h2>${esc(t().gameInviteMembers)}</h2></div>
    ${error ? `<p class="invite-hint" role="status">${esc(t().gameErrors[error])}</p>` : ''}
    ${state.invitation.members.length ? state.invitation.members.map((m) => `<div class="invite-member" data-invite-peer="${esc(m.peer)}">
      <span>${esc(m.name)}</span><span class="invite-status ${m.status}">${esc(t().gameInviteStatus[m.status])}</span></div>`).join('')
      : `<p class="muted" role="status">${esc(t().gameInviteEmpty)}</p>`}</section>`;
}

function refreshInviteControls(): void {
  const error = state?.invitation.error;
  root.querySelectorAll<HTMLButtonElement>('[data-invite-control]').forEach((b) => {
    b.disabled = Boolean(error); b.title = error ? t().gameErrors[error] : t().gameInvite;
  });
  const hint = root.querySelector<HTMLElement>('#currentInviteHint');
  if (hint) { hint.textContent = error ? t().gameErrors[error] : ''; hint.hidden = !error; }
}

function inviteCurrent(): string {
  return state?.organizer === state?.self && state?.participants.length === 1
    ? `${inviteButton('id="inviteCurrent"')}<span class="muted" id="currentInviteHint" role="status" ${state?.invitation.error ? '' : 'hidden'}>${esc(state?.invitation.error ? t().gameErrors[state.invitation.error] : '')}</span>` : '';
}

function bindCurrentInvite(): void {
  root.querySelector('#inviteCurrent')?.addEventListener('click', () => {
    if (state?.selection) void startGame(state.selection, true);
  });
}

function stageList(): string {
  return `<ul class="stage-list">${(state?.tests ?? []).map((id) => `<li>${esc(testName(id))}</li>`).join('')}</ul>`;
}
function renderInvite(): void {
  root.innerHTML = shell(`<section class="panel"><h2>${esc(t().gameInvited(state?.organizerName ?? ''))}</h2>${state?.webUrl ? `<p class="muted">${esc(t().gameWebProvider)}</p><p class="web-url">${esc(state.webUrl)}</p>` : stageList()}<div class="actions"><button class="primary" id="accept">${esc(t().gameAccept)}</button><button class="secondary" id="decline">${esc(t().gameDecline)}</button></div></section>`);
  root.querySelector('#accept')?.addEventListener('click', () => void action(async () => {
    const web = Boolean(state?.webUrl); const result = await window.gameApi.accept();
    return result.ok && web ? window.gameApi.openWeb() : result;
  }));
  root.querySelector('#decline')?.addEventListener('click', () => void window.gameApi.decline());
}

function renderWeb(): void {
  const entry = state?.selection;
  if (!entry) return;
  root.innerHTML = shell(`<section class="web-session"><img src="${esc(cover(entry))}" alt=""/><h2>${esc(t().gameWebProvider)}</h2><p class="web-url">${esc(state?.webUrl ?? '')}</p><div class="actions"><button class="primary" id="openWeb">${esc(t().gameWebReopen)}</button><button class="secondary" id="inviteWeb" ${state?.roomActive && state.roomPeers ? '' : 'disabled'}>${esc(t().gameInvite)}</button><button class="secondary" id="leaveWeb">${esc(t().gameBack)}</button></div></section>`);
  root.querySelector('#openWeb')?.addEventListener('click', () => void openWeb());
  root.querySelector('#leaveWeb')?.addEventListener('click', () => void window.gameApi.cancel());
  root.querySelector('#inviteWeb')?.addEventListener('click', () => void action(window.gameApi.inviteWeb));
}

async function startGame(entry: GameEntry, multiplayer: boolean): Promise<void> {
  const webUrl = webRooms.get(entry.game)?.trim() || entry.definition.web;
  if (entry.definition.web && multiplayer && !foonyRoomUrl(webUrl)) { showError(t().gameWebRoomRequired); return; }
  await action(async () => {
    const result = await window.gameApi.start({ module: entry.module, game: entry.game, digest: entry.digest,
      ...(entry.definition.web ? { webUrl } : {}) }, multiplayer);
    if (result.ok && entry.definition.web) await openWeb();
    return result;
  });
}

async function openWeb(): Promise<void> {
  const gameId = state?.gameId;
  const button = root.querySelector<HTMLButtonElement>('#openWeb');
  if (button) { button.disabled = true; button.textContent = t().gameWebOpening; }
  try {
    const result = await window.gameApi.openWeb();
    if (!result.ok && state?.gameId === gameId) showError(t().gameWebError);
  } catch { if (state?.gameId === gameId) showError(t().gameWebError); }
  finally { if (button?.isConnected) { button.disabled = false; button.textContent = t().gameWebReopen; } }
}
function renderLobby(): void {
  root.innerHTML = shell(`<section class="panel"><h2>${esc(t().gameWaiting)}</h2>${stageList()}<div class="participants">${(state?.participants ?? []).map((p) => `<div class="participant"><span>${esc(p.name)}</span><span class="status">${esc(t().gameReady)}</span></div>`).join('')}</div><div class="actions">${state?.organizer === state?.self ? `<button class="primary" id="begin" ${(state?.participants.length ?? 0) > 1 ? '' : 'disabled'}>${esc(t().gameBegin)}</button>` : ''}<button class="secondary" id="leave">${esc(t().gameLeave)}</button></div></section>${inviteMembers()}`);
  root.querySelector('#begin')?.addEventListener('click', () => void action(window.gameApi.begin));
  root.querySelector('#leave')?.addEventListener('click', () => void window.gameApi.cancel());
}
function renderStage(): void {
  if (!state?.currentTest || !state.selection) return;
  root.innerHTML = shell(`<section class="panel"><div class="test-head"><div><h2>${esc(testName(state.currentTest))}</h2><span class="muted">${esc(t().gameRound(state.tests.indexOf(state.currentTest) + 1, state.tests.length))}</span></div><div class="session-nav">${inviteCurrent()}<button class="secondary" id="quit">${esc(t().gameLeave)}</button></div></div><div id="board" class="test-board"><div class="test-center">${esc(t().arcadeLoading)}</div></div></section>`);
  root.querySelector('#quit')?.addEventListener('click', () => void window.gameApi.cancel());
  bindCurrentInvite();
  const board = root.querySelector<HTMLElement>('#board');
  if (!board) return;
  if (interrupted) {
    board.innerHTML = `<div class="test-center"><div><h2>${esc(t().gameFocusLost)}</h2><div class="actions"><button class="primary" id="restartTest">${esc(t().gameResumeTest)}</button></div></div></div>`;
    root.querySelector('#restartTest')?.addEventListener('click', () => { interrupted = false; render(); });
    return;
  }
  surface = new GameSurface(board, window.gameApi, state.selection.assets, () => {
    showError(t().gameErrors.runtime);
    interrupted = true; oldView = ''; render();
  });
  void surface.start();
}

function renderSession(): void {
  if (!state) return;
  root.innerHTML = shell(`<section class="local-session"><div class="session-nav">${inviteCurrent()}<button class="secondary" id="quit">${esc(t().gameBack)}</button></div><div id="liveSession"><p class="muted">${esc(t().arcadeLoading)}</p></div></section>`);
  root.querySelector('#quit')?.addEventListener('click', () => void window.gameApi.cancel());
  bindCurrentInvite();
  const node = root.querySelector<HTMLElement>('#liveSession');
  if (node) sessionSurface = new SessionSurface(node, state, window.gameApi);
}

function renderResults(): void {
  if (!state) return;
  const s = state;
  const ranked = rankGameParticipants(s.participants, s.results, s.tests.length);
  const complete = ranked.filter((p) => p.completed === s.tests.length);
  const allDone = s.participants.every((p) => (s.results[p.peer]?.length ?? 0) === s.tests.length || !p.ready);
  const winners = complete.filter((p) => p.score === complete[0]?.score);
  const metric = (r: GameResult): string => {
    const unit = s.selection?.definition.stages.find((stage) => stage.id === r.test)?.unit;
    return unit === 'cps' ? t().gameCps(r.metric) : unit === 'level' ? `${t().gameLevel} ${r.metric}`
      : unit === 'ms' ? t().gameMilliseconds(r.metric) : String(r.metric);
  };
  root.innerHTML = shell(`<section class="ceremony ${allDone ? 'settled' : ''}"><div class="ceremony-title">${esc(allDone ? t().gameReveal : t().gameLive)}</div><img class="winner-mark" src="../textures/pingwheel_basicpingrender.png" alt=""/><h2>${esc(allDone && winners.length ? winners.map((p) => p.name).join(' · ') : t().gameWaiting)}</h2><div class="muted">${esc(allDone ? winners.length > 1 ? t().gameTie : t().gameChampion : t().gamePending)}</div><div class="confetti" aria-hidden="true">${Array.from({ length: 18 }, (_, i) => `<i style="--i:${i};--color:${['#52d6d8', '#ef8b83', '#c6e78a'][i % 3]}"></i>`).join('')}</div></section><div class="rankings">${ranked.map((p, i) => `<div class="rank" style="--index:${i}"><div class="rank-num">${p.completed === s.tests.length ? 1 + complete.filter((other) => other.score > p.score).length : '-'}</div><div><div class="rank-name">${esc(p.name)}</div><div class="muted">${esc(p.completed === s.tests.length ? t().gameFinish : !s.participants.find((player) => player.peer === p.peer)?.ready ? t().gameIncomplete : t().gameProgress(p.completed, s.tests.length))}</div><div class="bar"><i style="width:${p.score}%"></i></div></div><div class="rank-score">${p.completed === s.tests.length ? p.score.toFixed(1) : '-'}</div></div>`).join('')}</div><div class="all-results"><table class="result-table"><thead><tr><th>${esc(t().gamePlayer)}</th>${s.tests.map((id) => `<th>${esc(testName(id))}</th>`).join('')}<th>${esc(t().gameTotal)}</th></tr></thead><tbody>${ranked.map((p) => `<tr><td>${esc(p.name)}</td>${s.tests.map((id) => { const r = s.results[p.peer]?.find((entry) => entry.test === id); return `<td>${r ? `${r.score.toFixed(1)}<small>${esc(metric(r))}</small>` : '-'}</td>`; }).join('')}<td>${p.completed === s.tests.length ? p.score.toFixed(1) : '-'}</td></tr>`).join('')}</tbody></table></div><div class="actions"><button class="primary" id="back">${esc(t().gameBack)}</button>${allDone ? `<button class="secondary" id="replay">${esc(t().gameRevealAgain)}</button>` : ''}</div><p class="footnote">${esc(t().gameFairNote)}</p>`);
  root.querySelector('#back')?.addEventListener('click', () => void window.gameApi.cancel());
  root.querySelector('#replay')?.addEventListener('click', () => {
    const node = root.querySelector('.ceremony'); node?.classList.remove('settled');
    requestAnimationFrame(() => node?.classList.add('settled'));
  });
}

async function action(run: () => Promise<GameActionResult>): Promise<void> {
  try { const result = await run(); if (!result.ok) showError(t().gameErrors[result.error]); }
  catch { showError(t().gameErrors.network); }
}
function showError(message: string): void {
  root.querySelector('.notice')?.remove();
  root.querySelector('.shell')?.insertAdjacentHTML('beforeend', `<div class="notice" role="status">${esc(message)}</div>`);
}
void window.gameApi.get().then((value) => { state = value; render(); });
window.gameApi.onState((value) => {
  if (state?.phase !== value.phase || state?.currentTest !== value.currentTest || state?.gameId !== value.gameId) interrupted = false;
  state = value; render();
});
window.addEventListener('blur', () => {
  if (state?.phase !== 'playing' || state.selection?.definition.web || state.selection?.definition.session) return;
  surface?.destroy(); surface = null; void window.gameApi.stopStage();
  interrupted = true; render();
});
