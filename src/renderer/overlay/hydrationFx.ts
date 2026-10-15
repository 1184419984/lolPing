import { HYDRATION_TEXTURE } from '../../shared/hydration';
import { textureUrl } from '../../shared/pings';

/** A single click-through reminder, replaced rather than stacked by another preview. */
export class HydrationStage {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly layer: HTMLElement) {}

  show(title: string, durationS: number): void {
    this.clear();
    this.layer.style.setProperty('--dur', `${durationS}s`);
    this.layer.classList.add('visible');
    const image = document.createElement('img');
    image.className = 'hydrationImage';
    image.src = textureUrl(HYDRATION_TEXTURE);
    image.alt = '';
    this.layer.append(image);
    const caption = document.createElement('div');
    caption.className = 'hydrationCaption';
    caption.textContent = title;
    this.layer.append(caption);
    this.timer = setTimeout(() => this.clear(), durationS * 1000 + 150);
  }

  clear(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.layer.replaceChildren();
    this.layer.classList.remove('visible');
  }
}
