import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HydrationStage } from '../../src/renderer/overlay/hydrationFx';
import { HYDRATION_TEXTURE } from '../../src/shared/hydration';

class FakeElement {
  className = '';
  textContent = '';
  src = '';
  clientWidth = 1920;
  clientHeight = 1080;
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  readonly classes = new Set<string>();
  readonly classList = { add: (s: string) => this.classes.add(s), remove: (s: string) => this.classes.delete(s) };
  readonly style: Record<string, unknown> & { setProperty(k: string, v: string): void } = {
    setProperty: (k, v) => { this.style[k] = v; },
  };
  get childElementCount(): number { return this.children.length; }
  get firstElementChild(): FakeElement | null { return this.children[0] ?? null; }
  append(...elements: FakeElement[]): void {
    for (const el of elements) { el.parent = this; this.children.push(el); }
  }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((el) => el !== this);
    this.parent = null;
  }
  replaceChildren(): void {
    for (const el of this.children) el.parent = null;
    this.children = [];
  }
  descendants(): FakeElement[] {
    return this.children.flatMap((el) => [el, ...el.descendants()]);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('document', { createElement: () => new FakeElement() });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('HydrationStage', () => {
  it('renders the supplied image and safe text with the configured duration', () => {
    const layer = new FakeElement();
    layer.clientWidth = 0;
    layer.clientHeight = 0;
    const stage = new HydrationStage(layer as unknown as HTMLElement);
    stage.show('<b>Water</b>', 8);
    expect(layer.classes.has('visible')).toBe(true);
    expect(layer.style['--dur']).toBe('8s');
    expect(layer.descendants().some((el) => el.src === `../textures/${HYDRATION_TEXTURE}.png`)).toBe(true);
    expect(layer.children.at(-1)?.textContent).toBe('<b>Water</b>');
    vi.advanceTimersByTime(8150);
    expect(layer.classes.has('visible')).toBe(false);
    expect(layer.children).toEqual([]);
  });

  it('replaces a preview and keeps an old timeout from clearing the new reminder', () => {
    const layer = new FakeElement();
    const stage = new HydrationStage(layer as unknown as HTMLElement);
    stage.show('First', 8);
    vi.advanceTimersByTime(4000);
    stage.show('Second', 8);
    expect(layer.children.filter((el) => el.className === 'hydrationImage')).toHaveLength(1);
    vi.advanceTimersByTime(4150);
    expect(layer.classes.has('visible')).toBe(true);
    expect(layer.children.at(-1)?.textContent).toBe('Second');
    stage.clear();
    expect(layer.children).toEqual([]);
  });
});
