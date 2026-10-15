import { describe, expect, it } from 'vitest';
import { HydrationReminder } from '../../src/main/hydrationReminder';

describe('HydrationReminder', () => {
  function setup() {
    let now = 1000;
    const reminder = new HydrationReminder(() => now);
    reminder.configure({ hydrationEnabled: true, hydrationIntervalMin: 30 });
    return { reminder, advance: (ms: number) => { now += ms; } };
  }

  it('waits for the full interval and never emits twice at the same time', () => {
    const { reminder, advance } = setup();
    advance(30 * 60_000 - 1);
    expect(reminder.tick(true)).toBe(false);
    advance(1);
    expect(reminder.tick(true)).toBe(true);
    expect(reminder.tick(true)).toBe(false);
  });

  it('defers a due reminder while a wheel or composer is busy', () => {
    const { reminder, advance } = setup();
    advance(30 * 60_000);
    expect(reminder.tick(false)).toBe(false);
    advance(1000);
    expect(reminder.tick(true)).toBe(true);
  });

  it('starts a fresh interval after pause or sleep instead of catching up', () => {
    const { reminder, advance } = setup();
    advance(29 * 60_000);
    reminder.setPaused(true);
    advance(10 * 60 * 60_000);
    expect(reminder.tick(true)).toBe(false);
    reminder.setPaused(false);
    expect(reminder.tick(true)).toBe(false);
    advance(30 * 60_000);
    expect(reminder.tick(true)).toBe(true);
  });

  it('emits at most one reminder after a long clock jump', () => {
    const { reminder, advance } = setup();
    advance(4 * 60 * 60_000);
    expect(reminder.tick(true)).toBe(true);
    expect(reminder.tick(true)).toBe(false);
    advance(30 * 60_000 - 1);
    expect(reminder.tick(true)).toBe(false);
  });

  it('does not postpone a reminder when unrelated settings are saved', () => {
    const { reminder, advance } = setup();
    advance(29 * 60_000);
    reminder.configure({ hydrationEnabled: true, hydrationIntervalMin: 30 });
    reminder.setPaused(false);
    advance(60_000);
    expect(reminder.tick(true)).toBe(true);
  });

  it('resets the interval when its length changes and stops when disabled', () => {
    const { reminder, advance } = setup();
    advance(29 * 60_000);
    reminder.configure({ hydrationEnabled: true, hydrationIntervalMin: 5 });
    advance(5 * 60_000);
    expect(reminder.tick(true)).toBe(true);
    reminder.configure({ hydrationEnabled: false, hydrationIntervalMin: 5 });
    advance(60 * 60_000);
    expect(reminder.tick(true)).toBe(false);
  });

  it('starts a fresh interval if the clock moves backwards', () => {
    const { reminder, advance } = setup();
    advance(-1000);
    expect(reminder.tick(true)).toBe(false);
    advance(30 * 60_000);
    expect(reminder.tick(true)).toBe(true);
  });
});
