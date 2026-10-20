import type { Localized } from './modules';
import type { GameResult } from './game';

export interface GameDefinition {
  id: string;
  name: Localized;
  description: Localized;
  cover: string;
  accent: 'cyan' | 'coral' | 'lime';
  stages: { id: string; name: Localized; unit: 'ms' | 'cps' | 'level' | 'points' }[];
  web?: string;
  session?: 'grid' | 'draw';
}
export interface GameRef { module: string; game: string; digest: string }
export interface GameEntry extends GameRef { definition: GameDefinition; assets: Record<string, string> }
export type GameTone = 'neutral' | 'accent' | 'danger' | 'success';
export interface GameNode {
  id: string;
  type: 'text' | 'button' | 'target' | 'tile' | 'image' | 'bar';
  text?: string;
  tone?: GameTone;
  disabled?: boolean;
  x?: number;
  y?: number;
  value?: number;
  asset?: string;
}
export interface GameView {
  layout: 'stack' | 'pad' | 'arena' | 'grid';
  tone: GameTone;
  columns: number;
  backgroundAction?: string;
  nodes: GameNode[];
}
export interface GameInput { token: string; revision: number; event: 'shown' | 'input' | 'timer'; now: number; control?: string }
export interface GameFrame { token: string; revision: number; view: GameView; wakeAfter: number | null; ready: boolean }
export interface GameReply { state: unknown; view: GameView; wakeAfter: number | null; result?: GameResult }
export const GAME_KEY = /^(?!constructor$|prototype$)[a-z][a-zA-Z0-9_]{0,39}$/;
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const tone = (v: unknown): v is GameTone => ['neutral', 'accent', 'danger', 'success'].includes(String(v));

/** A bounded vocabulary, never HTML, CSS, URLs or renderer-side JavaScript. */
export function gameView(raw: unknown, images: readonly string[]): GameView | null {
  if (!object(raw) || !['stack', 'pad', 'arena', 'grid'].includes(String(raw.layout)) || !tone(raw.tone)
    || !Number.isInteger(raw.columns) || Number(raw.columns) < 1 || Number(raw.columns) > 8
    || !Array.isArray(raw.nodes) || raw.nodes.length < 1 || raw.nodes.length > 64) return null;
  if (raw.backgroundAction !== undefined && (typeof raw.backgroundAction !== 'string' || !GAME_KEY.test(raw.backgroundAction))) return null;
  const nodes: GameNode[] = [];
  for (const v of raw.nodes) {
    if (!object(v) || typeof v.id !== 'string' || !GAME_KEY.test(v.id) || nodes.some((n) => n.id === v.id)
      || !['text', 'button', 'target', 'tile', 'image', 'bar'].includes(String(v.type))) return null;
    const node: GameNode = { id: v.id, type: v.type as GameNode['type'] };
    if (v.text !== undefined) {
      if (typeof v.text !== 'string' || v.text.length > 300 || /[\u0000-\u0008\u000b-\u001f\u202a-\u202e\u2066-\u2069]/.test(v.text)) return null;
      node.text = v.text;
    }
    if (v.tone !== undefined) { if (!tone(v.tone)) return null; node.tone = v.tone; }
    if (v.disabled !== undefined) { if (typeof v.disabled !== 'boolean') return null; node.disabled = v.disabled; }
    if (v.x !== undefined || v.y !== undefined) {
      if (!number(v.x) || !number(v.y) || v.x < 8 || v.x > 92 || v.y < 12 || v.y > 88) return null;
      node.x = v.x; node.y = v.y;
    }
    if (v.type === 'target' && (node.x === undefined || raw.layout !== 'arena')) return null;
    if (v.type === 'bar') {
      if (!number(v.value) || v.value < 0 || v.value > 1) return null;
      node.value = v.value;
    }
    if (v.type === 'image') {
      if (typeof v.asset !== 'string' || !images.includes(v.asset)) return null;
      node.asset = v.asset;
    }
    if (['button', 'target', 'tile'].includes(node.type) && !node.text?.trim()) return null;
    nodes.push(node);
  }
  return { layout: raw.layout as GameView['layout'], tone: raw.tone, columns: Number(raw.columns), nodes,
    ...(raw.backgroundAction ? { backgroundAction: String(raw.backgroundAction) } : {}) };
}

export function gameInput(raw: unknown): GameInput | null {
  if (!object(raw) || typeof raw.token !== 'string' || !/^[0-9a-f]{32}$/.test(raw.token)
    || !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 1 || !number(raw.now) || raw.now < 0 || raw.now > 1e12
    || !['shown', 'input', 'timer'].includes(String(raw.event))) return null;
  if (raw.event === 'input' && (typeof raw.control !== 'string' || !GAME_KEY.test(raw.control))) return null;
  return { token: raw.token, revision: Number(raw.revision), event: raw.event as GameInput['event'], now: raw.now,
    ...(raw.event === 'input' ? { control: String(raw.control) } : {}) };
}

export const sameGame = (a: GameRef | null, b: GameRef | null): boolean => !!a && !!b
  && a.module === b.module && a.game === b.game && a.digest === b.digest;

/** Updating counters must not interrupt a burst of clicks on an otherwise unchanged surface. */
export function sameGameControls(a: GameView, b: GameView): boolean {
  const shape = (view: GameView) => ({ ...view, nodes: view.nodes.map(({ text: _text, value: _value, ...node }) => node) });
  return JSON.stringify(shape(a)) === JSON.stringify(shape(b));
}
