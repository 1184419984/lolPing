import type { GameFrame, GameInput } from '../../shared/gameSurface';

const images: Record<string, string> = { 'builtin:ping': '../textures/pingwheel_basicpingrender.png' };
interface SurfaceBridge {
  openStage(now: number): Promise<GameFrame | null>;
  input(input: GameInput): Promise<GameFrame | null>;
  stopStage(): Promise<void>;
}

/** Render validated data only. Measurements originate here, before IPC or worker scheduling. */
export class GameSurface {
  private frame: GameFrame | null = null;
  private timer: number | null = null;
  private generation = 0;
  private busy = false;
  private shown = false;
  private pending: { control: string; now: number }[] = [];
  constructor(private readonly board: HTMLElement, private readonly bridge: SurfaceBridge,
    private readonly assets: Record<string, string>, private readonly failed: () => void) {}

  async start(): Promise<void> {
    const generation = ++this.generation;
    try {
      const frame = await this.bridge.openStage(performance.now());
      if (generation !== this.generation) return;
      if (!frame) { this.failed(); return; }
      this.paint(frame);
    } catch { if (generation === this.generation) this.failed(); }
  }

  destroy(): void {
    this.generation++; this.clearTimer(); this.frame = null;
    this.pending = [];
    this.board.onpointerdown = null;
  }

  private paint(frame: GameFrame): void {
    this.clearTimer(); this.frame = frame; this.shown = false;
    this.board.setAttribute('aria-busy', 'true');
    const v = frame.view;
    this.board.className = `test-board surface surface-${v.layout} tone-${v.tone}`;
    this.board.style.setProperty('--columns', String(v.columns));
    const fragment = document.createDocumentFragment();
    for (const node of v.nodes) {
      const interactive = ['button', 'tile', 'target'].includes(node.type);
      const el = document.createElement(node.type === 'image' ? 'img' : interactive ? 'button' : 'div');
      el.className = `surface-${node.type} tone-${node.tone ?? 'neutral'}`;
      el.dataset.node = node.id;
      if (node.text) el.textContent = node.text;
      if (el instanceof HTMLButtonElement) { el.disabled = node.disabled ?? false; el.setAttribute('aria-label', node.text ?? ''); }
      if (el instanceof HTMLImageElement) { el.src = images[node.asset ?? ''] ?? this.assets[node.asset ?? ''] ?? ''; el.alt = node.text ?? ''; }
      if (node.x !== undefined) { el.style.left = `${node.x}%`; el.style.top = `${node.y}%`; }
      if (node.value !== undefined) {
        el.setAttribute('role', 'progressbar'); el.setAttribute('aria-valuenow', String(Math.round(node.value * 100)));
        const fill = document.createElement('i'); fill.style.width = `${node.value * 100}%`; el.append(fill);
      }
      fragment.append(el);
    }
    this.board.replaceChildren(fragment);
    this.board.onpointerdown = (event) => {
      if (event.button !== 0 || !this.shown) return;
      const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-node]') : null;
      if (target?.disabled) return;
      const control = target?.dataset.node ?? v.backgroundAction;
      if (control) {
        const now = performance.now();
        if (this.busy) { if (this.pending.length < 64) this.pending.push({ control, now }); }
        else void this.send('input', control, now);
      }
    };
    const generation = this.generation;
    // A separate animation frame lets the changed surface reach a display frame before its clock starts.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (generation === this.generation && this.frame === frame) void this.send('shown');
    }));
  }

  private async send(event: GameInput['event'], control?: string, captured = performance.now()): Promise<void> {
    const frame = this.frame;
    if (!frame || this.busy) return;
    this.busy = true; this.clearTimer();
    this.board.setAttribute('aria-busy', 'true');
    const generation = this.generation;
    try {
      const next = await this.bridge.input({ token: frame.token, revision: frame.revision, event, now: captured,
        ...(control ? { control } : {}) });
      if (generation !== this.generation || !next) return;
      if (next.ready) {
        this.frame = next; this.shown = true;
        for (const node of next.view.nodes) {
          const el = [...this.board.querySelectorAll<HTMLElement>('[data-node]')].find((el) => el.dataset.node === node.id);
          if (el && node.text !== undefined && el.textContent !== node.text) el.textContent = node.text;
          if (el && node.type === 'bar') {
            const fill = el.querySelector('i'); if (fill) fill.style.width = `${(node.value ?? 0) * 100}%`;
          }
        }
        this.board.setAttribute('aria-busy', 'false');
        if (next.wakeAfter !== null) this.timer = window.setTimeout(() => void this.send('timer'),
          Math.max(1, next.wakeAfter - (performance.now() - captured) + 1));
      } else { this.pending = []; this.paint(next); }
    } catch { if (generation === this.generation) this.failed(); }
    finally {
      this.busy = false;
      if (generation === this.generation && this.shown) {
        const pending = this.pending.shift();
        if (pending) void this.send('input', pending.control, pending.now);
      }
    }
  }
  private clearTimer(): void { if (this.timer !== null) window.clearTimeout(this.timer); this.timer = null; }
}
