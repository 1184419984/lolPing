import type { Lang } from './i18n';
import { imageSize, sniffImage } from './imageSniff';
import type { GameDefinition } from './gameSurface';
import { foonyGameUrl } from './webGame';

export const MODULE_API = 1;
export const MAX_MODULES = 8;
export const MAX_MODULE_BYTES = 4 * 1024 * 1024;
export const MAX_SCRIPT_BYTES = 256 * 1024;
export const MAX_MODULE_STATE_BYTES = 16 * 1024;
export const MODULE_ID = /^(?!constructor$|prototype$)[a-z][a-z0-9.-]{1,63}$/;
export const MODULE_HASH = /^[0-9a-f]{64}$/;
export const MODULE_KEY = /^(?!constructor$|prototype$)[a-z][a-zA-Z0-9_]{0,39}$/;
export const MODULE_ASSET = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}\.(png|jpg|webp|wav|ogg)$/;
export const MODULE_CAPABILITIES = ['timers', 'storage', 'overlay', 'audio', 'room.receive', 'room.send', 'games'] as const;
export type ModuleCapability = typeof MODULE_CAPABILITIES[number];
export type Localized = Record<Lang, string>;
export type ModuleValue = boolean | number | string;
export type ModuleValues = Record<string, ModuleValue>;

export interface ModuleSetting {
  key: string;
  label: Localized;
  type: 'boolean' | 'number' | 'text' | 'color' | 'select';
  default: ModuleValue;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: Localized }[];
}
export interface ModuleAction { key: string; label: Localized }
export interface ModuleManifest {
  id: string;
  api: 1;
  name: Localized;
  description: Localized;
  changes: Localized;
  capabilities: ModuleCapability[];
  settings: ModuleSetting[];
  actions: ModuleAction[];
  texts: Record<string, Localized>;
  games?: GameDefinition[];
}
export interface ModuleAsset { name: string; mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'audio/wav' | 'audio/ogg'; data: string }
export interface ModulePayload { format: 1; manifest: ModuleManifest; script: string; assets: ModuleAsset[] }
export interface InstalledModule {
  manifest: ModuleManifest;
  digest: string;
  commit: string;
  enabled: boolean;
  phase: 'running' | 'paused' | 'disabled' | 'error';
  settings: ModuleValues;
  error?: ModuleError;
}
export type ModuleError = 'invalid' | 'incompatible' | 'limit' | 'disk' | 'runtime' | 'network' | 'notNewer'
  | 'wrongRemote' | 'dirty' | 'notPushed' | 'notBuilt' | 'rateLimited'
  | 'timeout' | 'notInRoom' | 'paused' | 'noPeers' | 'busy' | 'cancelled' | 'missing' | 'denied';
export type ModuleResult = { ok: true } | { ok: false; error: ModuleError };
export type ModuleEvent = 'activate' | 'tick' | 'settings' | 'action' | 'room.message';

export const moduleObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function localized(raw: unknown, max = 160): Localized | null {
  if (!moduleObject(raw)) return null;
  const en = raw.en;
  const zh = raw['zh-CN'];
  if (typeof en !== 'string' || typeof zh !== 'string' || en.length > max || zh.length > max) return null;
  if (!en.trim() || !zh.trim() || /[\u0000-\u0008\u000b-\u001f\u202a-\u202e\u2066-\u2069]/.test(en + zh)) return null;
  return { en, 'zh-CN': zh };
}

export const moduleText = (value: Localized, lang: Lang): string => value[lang];

function capabilities(raw: unknown): ModuleCapability[] | null {
  if (!Array.isArray(raw) || raw.length > MODULE_CAPABILITIES.length) return null;
  const out: ModuleCapability[] = [];
  for (const value of raw) {
    if (!(MODULE_CAPABILITIES as readonly unknown[]).includes(value) || out.includes(value as ModuleCapability)) return null;
    out.push(value as ModuleCapability);
  }
  return out;
}

function setting(raw: unknown): ModuleSetting | null {
  if (!moduleObject(raw) || typeof raw.key !== 'string' || !MODULE_KEY.test(raw.key)) return null;
  const label = localized(raw.label, 80);
  if (!label) return null;
  const base = { key: raw.key, label };
  switch (raw.type) {
    case 'boolean': return typeof raw.default === 'boolean' ? { ...base, type: raw.type, default: raw.default } : null;
    case 'number': {
      const { min, max, step, default: value } = raw;
      if (!finite(min) || !finite(max) || !finite(step) || !finite(value) || min > max || step <= 0 || step > max - min) return null;
      if (Math.abs(min) > 1e9 || Math.abs(max) > 1e9 || value < min || value > max) return null;
      return { ...base, type: raw.type, default: value, min, max, step };
    }
    case 'text': return typeof raw.default === 'string' && raw.default.length <= 256 ? { ...base, type: raw.type, default: raw.default } : null;
    case 'color': return typeof raw.default === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.default) ? { ...base, type: raw.type, default: raw.default } : null;
    case 'select': {
      if (!Array.isArray(raw.options) || raw.options.length < 1 || raw.options.length > 12) return null;
      const options: { value: string; label: Localized }[] = [];
      for (const item of raw.options) {
        if (!moduleObject(item) || typeof item.value !== 'string' || !MODULE_KEY.test(item.value)) return null;
        const text = localized(item.label, 80);
        if (!text || options.some((o) => o.value === item.value)) return null;
        options.push({ value: item.value, label: text });
      }
      if (typeof raw.default !== 'string' || !options.some((o) => o.value === raw.default)) return null;
      return { ...base, type: raw.type, default: raw.default, options };
    }
    default: return null;
  }
}
export function moduleManifest(raw: unknown): ModuleManifest | null {
  if (!moduleObject(raw) || typeof raw.id !== 'string' || !MODULE_ID.test(raw.id) || raw.api !== MODULE_API) return null;
  const name = localized(raw.name, 60);
  const description = localized(raw.description, 500);
  const changes = localized(raw.changes, 1000);
  const caps = capabilities(raw.capabilities);
  if (!name || !description || !changes || !caps || !Array.isArray(raw.settings) || raw.settings.length > 16) return null;
  const settings: ModuleSetting[] = [];
  for (const value of raw.settings) {
    const s = setting(value);
    if (!s || settings.some((old) => old.key === s.key)) return null;
    settings.push(s);
  }
  if (!Array.isArray(raw.actions) || raw.actions.length > 12) return null;
  const actions: ModuleAction[] = [];
  for (const value of raw.actions) {
    if (!moduleObject(value) || typeof value.key !== 'string' || !MODULE_KEY.test(value.key)) return null;
    const label = localized(value.label, 80);
    if (!label || actions.some((old) => old.key === value.key)) return null;
    actions.push({ key: value.key, label });
  }
  if (!moduleObject(raw.texts) || Object.keys(raw.texts).length > 64) return null;
  const texts: Record<string, Localized> = Object.create(null) as Record<string, Localized>;
  for (const [key, value] of Object.entries(raw.texts)) {
    const text = localized(value, 300);
    if (!MODULE_KEY.test(key) || !text) return null;
    texts[key] = text;
  }
  const games: GameDefinition[] = [];
  if (raw.games !== undefined) {
    if (!caps.includes('games') || !Array.isArray(raw.games) || raw.games.length > 12) return null;
    for (const g of raw.games) {
      if (!moduleObject(g) || typeof g.id !== 'string' || !MODULE_KEY.test(g.id) || games.some((old) => old.id === g.id)) return null;
      const title = localized(g.name, 60); const desc = localized(g.description, 300);
      const web = g.web === undefined ? undefined : foonyGameUrl(g.web);
      if (web === null) return null;
      if (g.session !== undefined && (web || !['grid', 'draw'].includes(String(g.session)))) return null;
      if (!title || !desc || typeof g.cover !== 'string' || !(MODULE_ASSET.test(g.cover) || /^builtin:(ping|target|caution|vision|push|allin)$/.test(g.cover))
        || !['cyan', 'coral', 'lime'].includes(String(g.accent)) || !Array.isArray(g.stages)
        || (web ? g.stages.length !== 0 : g.stages.length < 1 || g.stages.length > 8)) return null;
      const stages: GameDefinition['stages'] = [];
      for (const s of g.stages) {
        if (!moduleObject(s) || typeof s.id !== 'string' || !MODULE_KEY.test(s.id) || stages.some((old) => old.id === s.id)) return null;
        const label = localized(s.name, 60);
        if (!label || !['ms', 'cps', 'level', 'points'].includes(String(s.unit))) return null;
        stages.push({ id: s.id, name: label, unit: s.unit as GameDefinition['stages'][number]['unit'] });
      }
      games.push({ id: g.id, name: title, description: desc, cover: g.cover, accent: g.accent as GameDefinition['accent'], stages,
        ...(web ? { web } : {}), ...(g.session ? { session: g.session as 'grid' | 'draw' } : {}) });
    }
  }
  return { id: raw.id, api: 1, name, description, changes, capabilities: caps, settings, actions, texts,
    ...(raw.games !== undefined ? { games } : {}) };
}

export function modulePayload(raw: unknown): ModulePayload | null {
  if (!moduleObject(raw) || raw.format !== 1 || typeof raw.script !== 'string' || !raw.script.trim()) return null;
  if (new TextEncoder().encode(raw.script).length > MAX_SCRIPT_BYTES || moduleJson(raw, MAX_MODULE_BYTES) === null) return null;
  const manifest = moduleManifest(raw.manifest);
  if (!manifest || !Array.isArray(raw.assets) || raw.assets.length > 24) return null;
  const assets: ModuleAsset[] = [];
  const mimes: Record<string, ModuleAsset['mime']> = {
    png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', wav: 'audio/wav', ogg: 'audio/ogg',
  };
  for (const a of raw.assets) {
    if (!moduleObject(a) || typeof a.name !== 'string' || !MODULE_ASSET.test(a.name)) return null;
    if (assets.some((old) => old.name === a.name) || a.mime !== mimes[a.name.split('.').at(-1) ?? '']) return null;
    if (typeof a.data !== 'string' || a.data.length < 4 || a.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(a.data)) return null;
    const decoded = atob(a.data);
    if (btoa(decoded) !== a.data || decoded.length > 1024 * 1024) return null;
    const bytes = Uint8Array.from(decoded, (ch) => ch.charCodeAt(0));
    if (String(a.mime).startsWith('image/')) {
      const size = imageSize(bytes);
      if (!size || size.width > 2048 || size.height > 2048 || `image/${sniffImage(bytes)}` !== a.mime) return null;
    } else {
      const header = decoded.slice(0, 12);
      if (a.mime === 'audio/wav' && (!header.startsWith('RIFF') || header.slice(8) !== 'WAVE')) return null;
      if (a.mime === 'audio/ogg' && !header.startsWith('OggS')) return null;
    }
    assets.push({ name: a.name, mime: a.mime as ModuleAsset['mime'], data: a.data });
  }
  if (manifest.games?.some((g) => !g.cover.startsWith('builtin:') && !assets.some((a) => a.name === g.cover && a.mime.startsWith('image/')))) return null;
  return { format: 1, manifest, script: raw.script, assets };
}

export function moduleValues(schema: readonly ModuleSetting[], raw: unknown): ModuleValues {
  const values = moduleObject(raw) ? raw : {};
  const out: ModuleValues = Object.create(null) as ModuleValues;
  for (const s of schema) {
    const value = values[s.key];
    if (s.type === 'boolean') out[s.key] = typeof value === 'boolean' ? value : s.default;
    else if (s.type === 'number' && s.min !== undefined && s.max !== undefined && s.step !== undefined && finite(value)) {
      out[s.key] = Math.min(s.max, Math.max(s.min, Number((s.min + Math.round((value - s.min) / s.step) * s.step).toFixed(6))));
    } else if (s.type === 'text') out[s.key] = typeof value === 'string' ? value.slice(0, 256) : s.default;
    else if (s.type === 'color') out[s.key] = typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : s.default;
    else if (s.type === 'select') out[s.key] = typeof value === 'string' && s.options?.some((o) => o.value === value) ? value : s.default;
    else out[s.key] = s.default;
  }
  return out;
}

export function moduleJson(raw: unknown, max = MAX_MODULE_STATE_BYTES): string | null {
  try {
    const text = JSON.stringify(raw);
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > max) return null;
    return text;
  } catch { return null; }
}

export interface ModuleContext {
  now: number;
  lang: Lang;
  settings: ModuleValues;
  paused: boolean;
  busy: boolean;
  room: boolean;
  texts: Record<string, Localized>;
}
export type SceneElement =
  | { type: 'text'; text: Localized; size: number; color: string }
  | { type: 'image'; asset: string; height: number }
  | { type: 'bar'; value: number; color: string; height: number };
export interface ModuleScene {
  key: string;
  display: 'all' | 'primary';
  durationS: number;
  width: number;
  x: number;
  y: number;
  dim: boolean;
  animation: 'fade' | 'pop' | 'ping' | 'fullscreen';
  elements: SceneElement[];
}
export type ModuleCommand =
  | { op: 'show'; scene: ModuleScene }
  | { op: 'clear'; key: string }
  | { op: 'sound'; asset: string; volume: number }
  | { op: 'publish'; topic: string; data: unknown };

export function moduleCommand(raw: unknown, manifest: ModuleManifest, assets: readonly ModuleAsset[]): ModuleCommand | null {
  if (!moduleObject(raw)) return null;
  const has = (cap: ModuleCapability) => manifest.capabilities.includes(cap);
  const asset = (name: unknown, prefix: string): name is string => typeof name === 'string'
    && ((prefix === 'image/' && name === 'builtin:hydration') || assets.some((a) => a.name === name && a.mime.startsWith(prefix)));
  switch (raw.op) {
    case 'clear': return has('overlay') && typeof raw.key === 'string' && MODULE_KEY.test(raw.key) ? { op: 'clear', key: raw.key } : null;
    case 'sound': {
      if (!has('audio') || !finite(raw.volume) || raw.volume < 0 || raw.volume > 1) return null;
      if (raw.asset !== 'builtin:Base' && !asset(raw.asset, 'audio/')) return null;
      return { op: 'sound', asset: String(raw.asset), volume: raw.volume };
    }
    case 'publish': {
      if (!has('room.send') || typeof raw.topic !== 'string' || !MODULE_KEY.test(raw.topic)) return null;
      const data = moduleJson(raw.data, 400);
      return data !== null ? { op: 'publish', topic: raw.topic, data: JSON.parse(data) as unknown } : null;
    }
    case 'show': {
      if (!has('overlay') || !moduleObject(raw.scene)) return null;
      const s = raw.scene;
      if (typeof s.key !== 'string' || !MODULE_KEY.test(s.key) || (s.display !== 'all' && s.display !== 'primary')) return null;
      if (!finite(s.durationS) || s.durationS < 0.5 || s.durationS > 60 || !finite(s.width) || s.width < 0.05 || s.width > 0.9) return null;
      if (!finite(s.x) || !finite(s.y) || s.x < 0 || s.x > 1 || s.y < 0 || s.y > 1 || typeof s.dim !== 'boolean') return null;
      if (s.animation !== 'fade' && s.animation !== 'pop' && s.animation !== 'ping' && s.animation !== 'fullscreen') return null;
      if (!Array.isArray(s.elements) || s.elements.length < 1 || s.elements.length > 16) return null;
      const elements: SceneElement[] = [];
      for (const node of s.elements) {
        if (!moduleObject(node)) return null;
        const color = typeof node.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(node.color) ? node.color : null;
        if (node.type === 'text') {
          const text = localized(node.text, 300);
          if (!text || !finite(node.size) || node.size < 10 || node.size > 48 || !color) return null;
          elements.push({ type: node.type, text, size: node.size, color });
        } else if (node.type === 'image' && asset(node.asset, 'image/') && finite(node.height) && node.height >= 0.05 && node.height <= 0.7) {
          elements.push({ type: node.type, asset: node.asset, height: node.height });
        } else if (node.type === 'bar' && finite(node.value) && node.value >= 0 && node.value <= 1 && color
          && finite(node.height) && node.height >= 2 && node.height <= 30) {
          elements.push({ type: node.type, value: node.value, color, height: node.height });
        } else return null;
      }
      if (s.animation === 'fullscreen' && elements.filter((e) => e.type === 'image').length > 1) return null;
      return { op: 'show', scene: { key: s.key, display: s.display, durationS: s.durationS, width: s.width,
        x: s.x, y: s.y, dim: s.dim, animation: s.animation, elements } };
    }
    default: return null;
  }
}
