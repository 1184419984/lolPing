import type { ModuleFrame } from '../../shared/hotUpdate';
import { moduleText } from '../../shared/modules';

/** Declarative DOM only: guest code cannot access this renderer or insert HTML/CSS. */
export class ModuleStage {
  private items = new Map<string, { element: HTMLElement; timer: ReturnType<typeof setTimeout> }>();
  constructor(private readonly layer: HTMLElement) {}
  show(frame: ModuleFrame): void {
    const { scene, module } = frame;
    this.clear(module, scene.key);
    if (this.items.size >= 16) return;
    const element = document.createElement('div');
    element.className = `featureScene ${scene.animation}${scene.dim ? ' dimmed' : ''}`;
    element.style.setProperty('--dur', `${scene.durationS}s`);
    const content = document.createElement('div');
    content.className = 'featureContent';
    element.append(content);
    if (scene.animation !== 'fullscreen') {
      element.style.width = `${scene.width * 100}%`;
      element.style.left = `${scene.x * 100}%`;
      element.style.top = `${scene.y * 100}%`;
    }
    for (const node of scene.elements) {
      if (node.type === 'image') {
        const image = document.createElement('img');
        image.alt = ''; image.src = frame.assets[node.asset] ?? '';
        if (scene.animation !== 'fullscreen') image.style.maxHeight = `${node.height * 100}vh`;
        if (scene.animation === 'fullscreen') element.prepend(image);
        else content.append(image);
      } else if (node.type === 'text') {
        const text = document.createElement('div');
        text.className = 'featureText'; text.textContent = moduleText(node.text, frame.lang);
        text.style.fontSize = `${node.size}px`; text.style.color = node.color;
        content.append(text);
      } else {
        const bar = document.createElement('div');
        bar.className = 'featureBar'; bar.style.height = `${node.height}px`;
        const fill = document.createElement('div');
        fill.style.width = `${node.value * 100}%`; fill.style.backgroundColor = node.color;
        bar.append(fill); content.append(bar);
      }
    }
    this.layer.append(element);
    const timer = setTimeout(() => this.clear(module, scene.key), scene.durationS * 1000 + 150);
    this.items.set(`${module}:${scene.key}`, { element, timer });
  }
  clear(module?: string, key?: string): void {
    for (const [id, item] of this.items) {
      if (module && !id.startsWith(`${module}:`) || key && id !== `${module}:${key}`) continue;
      clearTimeout(item.timer); item.element.remove(); this.items.delete(id);
    }
  }
}
