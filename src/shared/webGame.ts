export const FOONY_PAINTJOB = 'https://foony.com/zh/games/paintjob';

/** Room messages can select a Foony room, never a download, script or arbitrary website. */
export function foonyGameUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 200) return null;
  try {
    const url = new URL(raw.trim());
    if (url.origin !== 'https://foony.com' || url.username || url.password || url.search
      || !/^\/(?:zh\/|en\/)?games\/paintjob\/?$/.test(url.pathname)
      || url.hash && !/^#r=[a-zA-Z0-9_-]{1,32}$/.test(url.hash)) return null;
    return FOONY_PAINTJOB + url.hash;
  } catch { return null; }
}

export function foonyRoomUrl(raw: unknown): string | null {
  const url = foonyGameUrl(raw);
  return url?.includes('#r=') ? url : null;
}

export const foonyNavigation = (raw: string): boolean => foonyGameUrl(raw) !== null;
