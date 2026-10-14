export interface ChatKey {
  key: string;
  keyCode: number;
  isComposing: boolean;
  repeat: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** IME confirmation stays with the input method; it must never send a half-written message. */
export function chatKeyAction(event: ChatKey): 'send' | 'close' | 'ignore' {
  if (event.isComposing || event.keyCode === 229 || event.repeat) return 'ignore';
  if (event.key === 'Escape') return 'close';
  if (event.key !== 'Enter' || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return 'ignore';
  return 'send';
}
