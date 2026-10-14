import { CHAT_HISTORY_LIMIT, type ChatEntry, type ChatSendResult } from '../../shared/chat';
import { strings } from '../../shared/i18n';
import type { ChatApi, ChatState } from '../../shared/ipc';
import { pingById, textureUrl } from '../../shared/pings';
import { TAG_COLORS } from '../../shared/roomColors';
import { chatTimestamp } from './chatHistory';
import { chatKeyAction } from './chatLogic';

declare global {
  interface Window {
    chatApi: ChatApi;
  }
}

const api = window.chatApi;
const root = document.getElementById('chat-root');
if (!root) throw new Error('chat root is missing');

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  return el;
}

const hud = element('section', 'chatHud');
const history = element('div', 'chatHistory');
history.setAttribute('role', 'log');
history.setAttribute('aria-live', 'polite');
history.setAttribute('aria-relevant', 'additions');
const composer = element('div', 'chatComposer');
composer.hidden = true;
const inputRow = element('div', 'chatInputRow');
const channel = element('span', 'chatInputChannel');
const input = element('input', 'chatInput');
input.type = 'text';
input.autocomplete = 'off';
input.spellcheck = false;
inputRow.append(channel, input);
const errorLabel = element('div', 'chatError');
errorLabel.setAttribute('role', 'status');
errorLabel.hidden = true;
composer.append(errorLabel, inputRow);
hud.append(history, composer);
root.append(hud);

let state: ChatState | null = null;
let error: Extract<ChatSendResult, { ok: false }>['error'] | 'unknown' | null = null;
let sending = false;
let inputGeneration = 0;
let renderedHistory = '';
let lastHeight = 0;
let resizeFrame: number | null = null;

function scheduleResize(): void {
  if (!state || resizeFrame !== null) return;
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = null;
    const height = Math.max(34, Math.min(320, Math.ceil(hud.getBoundingClientRect().height + 6)));
    if (height === lastHeight) return;
    lastHeight = height;
    void api.resize(height).catch(() => { if (lastHeight === height) lastHeight = 0; });
  });
}

const resizeObserver = new ResizeObserver(scheduleResize);
resizeObserver.observe(hud);

function renderDraft(): void {
  input.disabled = !state?.enabled || !state.roomCode;
  if (!state) return;
  const t = strings(state.lang, state.platform);
  errorLabel.textContent = error === 'unknown' ? t.chatErrorUnknown : error ? t.chatErrors[error] : '';
  errorLabel.hidden = error === null;
}

function messageRow(message: ChatEntry, current: ChatState): HTMLElement {
  const t = strings(current.lang, current.platform);
  const row = element('div', `chatMessage${message.self ? ' self' : ''}${message.kind === 'ping' ? ' signal' : ''}`);
  const time = element('time', 'chatTime');
  time.textContent = `${chatTimestamp(message.ts, current.lang)} `;
  time.dateTime = new Date(message.ts).toISOString();
  const label = element('span', 'chatChannel');
  label.textContent = `${t.chatChannel} `;
  const name = element('span', 'chatName');
  name.style.color = TAG_COLORS[message.color] ?? TAG_COLORS[0];
  name.textContent = `${message.name}: `;
  const text = element('span', 'chatText');
  row.append(time, label, name);
  if (message.kind === 'ping') {
    const ping = pingById(message.ping);
    if (ping) {
      const icon = element('img', 'chatPingIcon');
      icon.src = textureUrl(ping.icon);
      icon.alt = '';
      icon.setAttribute('aria-hidden', 'true');
      icon.title = t.pingNames[message.ping];
      icon.draggable = false;
      row.append(icon);
    }
    text.textContent = t.chatPing(t.pingNames[message.ping]);
  } else {
    text.textContent = message.text;
  }
  row.append(text);
  return row;
}

function renderHistory(current: ChatState, entering: boolean): void {
  const messages = current.composing ? current.messages.slice(-CHAT_HISTORY_LIMIT) : current.messages.slice(-5);
  const key = JSON.stringify([current.composing, current.lang, messages.map((message) => message.id)]);
  if (key === renderedHistory) return;
  renderedHistory = key;
  const oldScrollTop = history.scrollTop;
  const atBottom = history.scrollHeight - history.clientHeight - oldScrollTop < 28;
  history.replaceChildren(...messages.map((message) => messageRow(message, current)));
  if (!current.composing || entering || atBottom) history.scrollTop = history.scrollHeight;
  else history.scrollTop = oldScrollTop;
}

function applyState(next: ChatState): void {
  const entering = next.composing && !state?.composing;
  if (next.composing !== state?.composing || next.roomCode !== state?.roomCode) {
    inputGeneration++;
    sending = false;
  }
  if (state && next.roomCode !== state.roomCode) {
    input.value = '';
    error = null;
  }
  state = next;
  const t = strings(next.lang, next.platform);
  document.documentElement.lang = next.lang;
  document.title = t.chatTitle;
  hud.classList.toggle('composing', next.composing);
  composer.hidden = !next.composing;
  channel.textContent = t.chatChannel;
  input.setAttribute('aria-label', t.chatPlaceholder);
  history.setAttribute('aria-label', t.chatTitle);
  renderHistory(next, entering);
  renderDraft();
  scheduleResize();
  if (entering && !input.disabled) input.focus({ preventScroll: true });
}

async function send(): Promise<void> {
  if (!state?.composing || sending || !input.value.trim() || input.disabled) return;
  const text = input.value;
  const generation = inputGeneration;
  sending = true;
  error = null;
  renderDraft();
  try {
    const result = await api.send(text);
    if (generation !== inputGeneration) return;
    if (result.ok) {
      if (input.value === text) {
        input.value = '';
        await api.close();
      }
    } else {
      error = result.error;
    }
  } catch {
    if (generation === inputGeneration) error = 'unknown';
  } finally {
    if (generation === inputGeneration) {
      sending = false;
      renderDraft();
    }
  }
}

input.addEventListener('input', () => {
  error = null;
  renderDraft();
});
window.addEventListener('keydown', (event) => {
  if (!state?.composing) return;
  const action = chatKeyAction(event);
  if (action === 'ignore') return;
  event.preventDefault();
  if (action === 'close') void api.close();
  else void send();
});

let receivedState = false;
const unsubscribe = api.onState((next) => {
  receivedState = true;
  applyState(next);
});
void api.getState().then((next) => {
  if (!receivedState) applyState(next);
});
window.addEventListener('unload', () => {
  unsubscribe();
  resizeObserver.disconnect();
  if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
}, { once: true });
