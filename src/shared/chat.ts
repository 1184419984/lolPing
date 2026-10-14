import type { PingId } from './pings';

export const CHAT_MAX_LENGTH = 256;
/** The JSON string, including escapes, must leave room for the sealed room packet's other fields. */
export const CHAT_MAX_ENCODED_BYTES = 800;
export const CHAT_HISTORY_LIMIT = 100;

export interface ChatEntryBase {
  id: string;
  peer: string;
  name: string;
  color: number;
  ts: number;
  self: boolean;
}

export type ChatEntry = ChatEntryBase & ({ kind: 'message'; text: string } | { kind: 'ping'; ping: PingId });

export type ChatSendResult =
  | { ok: true }
  | { ok: false; error: 'notInRoom' | 'paused' | 'empty' | 'tooLong' | 'rateLimited' | 'failed' };

export type ChatTextResult =
  | { ok: true; text: string }
  | { ok: false; error: 'empty' | 'tooLong' };

const UNSAFE_CHARS =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u180e\u200b\u200e\u200f\u2028-\u202e\u2060-\u2069\u3164\ufeff\uffa0]/g;

/** Single-line plain text; markup stays text, while hidden controls cannot reorder the sender or nearby messages. */
export function validateChatText(raw: unknown): ChatTextResult {
  if (typeof raw !== 'string') return { ok: false, error: 'empty' };
  const text = raw.replace(/[\r\n\t\u2028\u2029]+/g, ' ').replace(UNSAFE_CHARS, '').trim();
  if (!text.replace(/[\u200c\u200d\ufe00-\ufe0f]/g, '').trim()) return { ok: false, error: 'empty' };
  if ([...text].length > CHAT_MAX_LENGTH || new TextEncoder().encode(JSON.stringify(text)).length > CHAT_MAX_ENCODED_BYTES) {
    return { ok: false, error: 'tooLong' };
  }
  return { ok: true, text };
}
