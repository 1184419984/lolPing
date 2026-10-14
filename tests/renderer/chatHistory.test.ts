import { describe, expect, it } from 'vitest';
import { chatTimestamp } from '../../src/renderer/chat/chatHistory';

describe('chatTimestamp', () => {
  it('uses local 24-hour time with padded minutes in both languages', () => {
    const ts = new Date(2026, 9, 14, 21, 9).getTime();
    expect(chatTimestamp(ts, 'en')).toBe('[21:09]');
    expect(chatTimestamp(ts, 'zh-CN')).toBe('[21:09]');
  });

  it('shows midnight as 00 instead of 24', () => {
    const ts = new Date(2026, 9, 14, 0, 5).getTime();
    expect(chatTimestamp(ts, 'en')).toBe('[00:05]');
    expect(chatTimestamp(ts, 'zh-CN')).toBe('[00:05]');
  });
});
