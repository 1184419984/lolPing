import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModuleStage } from '../../src/renderer/overlay/moduleFx';
import type { ModuleFrame } from '../../src/shared/hotUpdate';

class Element {
  className = '';
  textContent = '';
  src = '';
  alt = '';
  children: Element[] = [];
  parent: Element | null = null;
  style: Record<string, string | ((key: string, value: string) => void)> = {
    setProperty: (key: string, value: string) => { this.style[key] = value; },
  };
  append(child: Element): void { child.parent = this; this.children.push(child); }
  prepend(child: Element): void { child.parent = this; this.children.unshift(child); }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
}
const frame: ModuleFrame = { module: 'hydration', generation: 'a'.repeat(40), lang: 'en',
  assets: { 'builtin:hydration': '../textures/drink_water_akali.png' }, scene: {
    key: 'water', display: 'all', durationS: 8, width: 0.8, x: 0.5, y: 0.5, dim: true, animation: 'fullscreen',
    elements: [{ type: 'image', asset: 'builtin:hydration', height: 0.7 },
      { type: 'text', text: { en: '<b>Water</b>', 'zh-CN': 'Water' }, size: 32, color: '#ffffff' }],
  } };
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('document', { createElement: () => new Element() }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('ModuleStage', () => {
  it('renders the supplied full-viewport image with safe localized text without hidden measurements', () => {
    const layer = new Element();
    const stage = new ModuleStage(layer as unknown as HTMLElement);
    stage.show(frame);
    const scene = layer.children[0];
    expect(scene.className).toContain('fullscreen');
    expect(scene.style.width).toBeUndefined();
    expect(scene.children[0].src).toBe('../textures/drink_water_akali.png');
    expect(scene.children[1].children[0].textContent).toBe('<b>Water</b>');
    vi.advanceTimersByTime(8150); expect(layer.children).toEqual([]);
  });
  it('replaces an earlier preview and cancels its timeout', () => {
    const layer = new Element(); const stage = new ModuleStage(layer as unknown as HTMLElement);
    stage.show(frame); vi.advanceTimersByTime(4000); stage.show(frame);
    expect(layer.children).toHaveLength(1);
    vi.advanceTimersByTime(4150); expect(layer.children).toHaveLength(1);
    stage.clear(); expect(layer.children).toEqual([]);
  });
  it('lays out multiple captions in a shared content flow and clears only a requested module', () => {
    const layer = new Element(); const stage = new ModuleStage(layer as unknown as HTMLElement);
    stage.show({ ...frame, scene: { ...frame.scene, elements: [...frame.scene.elements, frame.scene.elements[1]] } });
    stage.show({ ...frame, module: 'another' });
    expect(layer.children[0].children[1].children).toHaveLength(2);
    stage.clear('hydration'); expect(layer.children).toHaveLength(1);
    stage.clear(); expect(layer.children).toEqual([]);
  });
});
