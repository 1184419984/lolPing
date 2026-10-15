import type { Settings } from '../shared/settings';

type ReminderSettings = Pick<Settings, 'hydrationEnabled' | 'hydrationIntervalMin'>;

/** One reminder per interval, with no catch-up burst after sleep or a blocked gesture. */
export class HydrationReminder {
  private enabled = false;
  private intervalMs = 0;
  private paused = false;
  private nextAt: number | null = null;
  private lastNow = 0;

  constructor(private readonly now: () => number) {}

  configure(s: ReminderSettings): void {
    const intervalMs = s.hydrationIntervalMin * 60_000;
    if (s.hydrationEnabled === this.enabled && intervalMs === this.intervalMs) return;
    this.enabled = s.hydrationEnabled;
    this.intervalMs = intervalMs;
    this.reset();
  }

  setPaused(on: boolean): void {
    if (on === this.paused) return;
    this.paused = on;
    this.reset();
  }

  reset(): void {
    this.lastNow = this.now();
    this.nextAt = this.enabled && !this.paused ? this.lastNow + this.intervalMs : null;
  }

  /** A busy wheel or composer defers the due reminder without starting another interval. */
  tick(canShow: boolean): boolean {
    const now = this.now();
    if (now < this.lastNow) this.reset();
    this.lastNow = now;
    if (!canShow || this.nextAt === null || now < this.nextAt) return false;
    this.nextAt = now + this.intervalMs;
    return true;
  }
}
