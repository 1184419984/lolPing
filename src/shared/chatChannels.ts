/** Separate from other preload channels so sandboxed preloads stay self-contained. */
export const CHAT_CH = {
  get: 'chat:get',
  changed: 'chat:changed',
  send: 'chat:send',
  close: 'chat:close',
  resize: 'chat:resize',
} as const;
