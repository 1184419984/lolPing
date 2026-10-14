import { describe, expect, it } from 'vitest';
import { chatKeyAction, type ChatKey } from '../../src/renderer/chat/chatLogic';

const key = (key: string, patch: Partial<ChatKey> = {}): ChatKey => ({
  key, keyCode: 0, isComposing: false, repeat: false,
  ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...patch,
});

describe('chatKeyAction', () => {
  it('sends with Enter and closes with Escape', () => {
    expect(chatKeyAction(key('Enter'))).toBe('send');
    expect(chatKeyAction(key('Escape'))).toBe('close');
    expect(chatKeyAction(key('a'))).toBe('ignore');
  });

  it('lets the input method finish or cancel composing without sending or closing', () => {
    expect(chatKeyAction(key('Enter', { isComposing: true }))).toBe('ignore');
    expect(chatKeyAction(key('Escape', { isComposing: true }))).toBe('ignore');
    expect(chatKeyAction(key('Enter', { keyCode: 229 }))).toBe('ignore');
  });

  it('ignores a held Enter so one key press cannot send repeatedly', () => {
    expect(chatKeyAction(key('Enter', { repeat: true }))).toBe('ignore');
  });

  it('does not send when the chat-opening shortcut or another modifier is held', () => {
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey'] as const) {
      expect(chatKeyAction(key('Enter', { [modifier]: true }))).toBe('ignore');
    }
  });
});
