import type { Lang } from '../../shared/i18n';

/** In-game timestamps use local 24-hour time, including 00 rather than 24 at midnight. */
export function chatTimestamp(ts: number, lang: Lang): string {
  const time = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ts);
  return `[${time}]`;
}
